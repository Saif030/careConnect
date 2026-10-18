import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";

loadEnv({ path: path.resolve(process.cwd(), "../.env") });
loadEnv();

import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { evaluateVitals, isVitalsPacket } from "./alerts.js";
import { handleAlertEscalation, acknowledgeAlert } from "./escalation.js";
import { analyzeDrugInteractions } from "./ddiEngine.js";
import {
  runMigrations,
  getAuditTrail,
  saveAlert,
  getAlerts,
  savePatient,
  getPatient,
  getAllPatients,
  savePatientMedications,
  getPatientMedications,
  recordDataAccessAudit,
} from "./db/index.js";
import { FusionEngine } from "./fusionEngine.js";
import {
  writeVitalsToInflux,
  getLatestVitals,
  queryVitalsHistory,
} from "./influx.js";
import {
  authenticateToken,
  requireRoles,
  socketAuthMiddleware,
  signToken,
  verifyPassword,
  DEMO_USERS,
  type AuthenticatedRequest,
  type AuthUser,
} from "./auth.js";
import { DEMO_PATIENTS, DEMO_MEDICATIONS_PT001, DEMO_MEDICATIONS_PT002 } from "./db/seed.js";
import { sendTwilioSms, sendTwilioWhatsApp } from "./notifications/twilio.js";
import type { Alert, Medication, VitalsPacket } from "./types.js";

const PORT = Number(process.env.BACKEND_PORT ?? 4000);
const DISCLAIMER = "Decision support only. Consult a pharmacist or doctor.";

const app = express();
app.use(cors());
app.use(express.json());

// Global safety disclaimer middleware
app.use((_req, res, next) => {
  res.setHeader("X-Decision-Support", DISCLAIMER);
  next();
});

const latestVitals = new Map<string, VitalsPacket>();
const alerts: Alert[] = [];
const medications = new Map<string, Medication[]>();
const escalationTimers = new Map<string, NodeJS.Timeout>();

// Preload demo patients & medications in-memory for instant startup
for (const p of DEMO_PATIENTS) {
  savePatient(p).catch(() => {});
}
medications.set("pt_001", DEMO_MEDICATIONS_PT001);
medications.set("pt_002", DEMO_MEDICATIONS_PT002);
savePatientMedications("pt_001", DEMO_MEDICATIONS_PT001).catch(() => {});
savePatientMedications("pt_002", DEMO_MEDICATIONS_PT002).catch(() => {});

const fusionEngine = new FusionEngine();
fusionEngine.updateMedications("pt_001", DEMO_MEDICATIONS_PT001);

// HTTPS support in deployment; fallback to HTTP for development
let server: http.Server | https.Server;
const SSL_KEY_PATH = process.env.SSL_KEY_PATH;
const SSL_CERT_PATH = process.env.SSL_CERT_PATH;
if (
  SSL_KEY_PATH &&
  SSL_CERT_PATH &&
  fs.existsSync(SSL_KEY_PATH) &&
  fs.existsSync(SSL_CERT_PATH)
) {
  server = https.createServer(
    {
      key: fs.readFileSync(SSL_KEY_PATH),
      cert: fs.readFileSync(SSL_CERT_PATH),
    },
    app,
  );
  console.log("[Security] HTTPS server initialized with SSL certificate.");
} else {
  server = http.createServer(app);
}

// Secure Socket.io with JWT token authentication
const io = new Server(server, {
  cors: { origin: "*" },
});
io.use(socketAuthMiddleware);

function handleCriticalAlert(alert: Alert) {
  if (alert.severity === "RED") {
    // Emit alert:critical as specifically required for EmergencyModal
    io.emit("alert:critical", alert);

    // Stop existing timer if event_id already tracked
    if (escalationTimers.has(alert.event_id)) {
      clearTimeout(escalationTimers.get(alert.event_id)!);
    }

    // 60-second escalation timer
    const timer = setTimeout(() => {
      escalationTimers.delete(alert.event_id);
      console.warn(`[ESCALATION TRIGGERED] Alert ${alert.event_id} not acknowledged in 60s! Escalating.`);
      io.emit("alert:escalated", {
        event_id: alert.event_id,
        patient_id: alert.patient_id,
        timestamp: new Date().toISOString(),
        message: "Caregiver response timeout (60s). Escalating to emergency medical services.",
      });
    }, 60000);

    escalationTimers.set(alert.event_id, timer);
  }
}

// -----------------------------------------------------------------------------
// Auth Endpoints (JWT Login & Verification)
// -----------------------------------------------------------------------------
app.post(["/auth/login", "/api/auth/login"], (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }

  const user = DEMO_USERS.find((u) => u.username.toLowerCase() === String(username).toLowerCase());
  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: "Invalid username or credentials" });
    return;
  }

  const authUser: AuthUser = {
    id: user.id,
    username: user.username,
    role: user.role,
    patient_ids: user.patient_ids,
  };

  const token = signToken(authUser, "24h");
  recordDataAccessAudit({
    user_id: user.id,
    role: user.role,
    action: "USER_LOGIN",
    resource: "/api/auth/login",
  }).catch(() => {});

  res.json({
    ok: true,
    token,
    user: authUser,
    disclaimer: DISCLAIMER,
  });
});

app.get(["/auth/me", "/api/auth/me"], authenticateToken, (req: AuthenticatedRequest, res) => {
  res.json({ ok: true, user: req.user, disclaimer: DISCLAIMER });
});

// Health check
app.get(["/health", "/api/health"], (_req, res) => {
  res.json({ ok: true, service: "careconnect-backend", disclaimer: DISCLAIMER });
});

// -----------------------------------------------------------------------------
// Patients Endpoints
// -----------------------------------------------------------------------------
app.get(["/patients", "/api/patients"], authenticateToken, async (req: AuthenticatedRequest, res) => {
  const list = await getAllPatients();
  recordDataAccessAudit({
    user_id: req.user?.id,
    role: req.user?.role,
    action: "VIEW_PATIENTS_LIST",
    resource: req.path,
  }).catch(() => {});
  res.json({ patients: list, disclaimer: DISCLAIMER });
});

app.get(["/patients/:id", "/api/patients/:id"], authenticateToken, async (req: AuthenticatedRequest, res) => {
  const patientId = String(req.params.id);
  const patient = await getPatient(patientId);
  if (!patient) {
    res.status(404).json({ error: `Patient ${patientId} not found` });
    return;
  }
  recordDataAccessAudit({
    user_id: req.user?.id,
    role: req.user?.role,
    action: "VIEW_PATIENT_DETAILS",
    resource: req.path,
    patient_id: patientId,
  }).catch(() => {});
  res.json({ patient, disclaimer: DISCLAIMER });
});

// -----------------------------------------------------------------------------
// Vitals Endpoints (InfluxDB for Telemetry + PostgreSQL Alert Generation)
// -----------------------------------------------------------------------------
app.get(["/vitals/:patient_id", "/api/vitals/:patient_id"], authenticateToken, async (req: AuthenticatedRequest, res) => {
  const patientId = String(req.params.patient_id);
  const packet = (await getLatestVitals(patientId)) || latestVitals.get(patientId);
  if (!packet) {
    res.status(404).json({ error: "No vitals for patient" });
    return;
  }
  recordDataAccessAudit({
    user_id: req.user?.id,
    role: req.user?.role,
    action: "VIEW_VITALS_LATEST",
    resource: req.path,
    patient_id: patientId,
  }).catch(() => {});
  res.json(packet);
});

app.get(["/vitals/:patient_id/history", "/api/vitals/:patient_id/history"], authenticateToken, async (req: AuthenticatedRequest, res) => {
  const patientId = String(req.params.patient_id);
  const range = String(req.query.range || "-1h");
  const limit = Number(req.query.limit || 100);
  const history = await queryVitalsHistory(patientId, range, limit);
  recordDataAccessAudit({
    user_id: req.user?.id,
    role: req.user?.role,
    action: "VIEW_VITALS_HISTORY",
    resource: req.path,
    patient_id: patientId,
    details: { range, count: history.length },
  }).catch(() => {});
  res.json({ patient_id: patientId, vitals: history, count: history.length });
});

// Ingest vitals
app.post(["/vitals", "/api/vitals"], async (req: AuthenticatedRequest, res) => {
  if (!isVitalsPacket(req.body)) {
    res.status(400).json({ error: "Body must be a VitalsPacket" });
    return;
  }
  const packet = req.body;
  latestVitals.set(packet.patient_id, packet);
  // Write to InfluxDB time-series storage
  await writeVitalsToInflux(packet);

  const fusionResult = fusionEngine.processVitals(packet);
  const alert = fusionResult.alert ?? evaluateVitals(packet);

  // Deduplication: Check if an active (unresolved) alert with the same patient and message already exists
  const existingActive = alerts.find(
    (a) => !a.resolved && a.patient_id === alert.patient_id && a.message === alert.message,
  );

  // Check if a normal/silent interaction alert was already resolved for this patient
  const wasAlreadyResolved = alerts.find(
    (a) =>
      a.resolved &&
      a.patient_id === alert.patient_id &&
      a.message === alert.message &&
      (fusionResult.is_silent || alert.severity === "GREEN"),
  );

  let finalAlert = alert;
  if (existingActive) {
    // Preserve identical event_id so active queue does not rapidly churn or shift items
    existingActive.timestamp = alert.timestamp;
    if (alert.contributing_signals) existingActive.contributing_signals = alert.contributing_signals;
    if (alert.explanation) existingActive.explanation = alert.explanation;
    await saveAlert(existingActive);
    finalAlert = existingActive;
    io.emit("alert:updated", existingActive);
  } else if (!wasAlreadyResolved) {
    alerts.push(alert);
    await saveAlert(alert);
  }

  io.emit("vitals", packet);
  io.emit("alert", finalAlert);
  if (fusionResult.dashboard_card) {
    io.emit("dashboard:card", fusionResult.dashboard_card);
  }

  // Trigger escalation workflow on RED alerts (non-silent)
  if (!fusionResult.is_silent && alert.severity === "RED") {
    handleCriticalAlert(alert);
    handleAlertEscalation(alert, {
      vitals: packet,
      medications: medications.get(packet.patient_id),
    }).catch((err) => console.error("[Escalation] Error handling alert:", err));
  }

  res.status(201).json({ ok: true, alert, fusion: fusionResult, disclaimer: DISCLAIMER });
});

// -----------------------------------------------------------------------------
// Alerts & Escalation Endpoints
// -----------------------------------------------------------------------------
app.get(["/alerts", "/api/alerts"], authenticateToken, async (req: AuthenticatedRequest, res) => {
  const dbAlerts = await getAlerts(100);
  const result = dbAlerts.length > 0 ? dbAlerts : alerts.slice(-100);
  recordDataAccessAudit({
    user_id: req.user?.id,
    role: req.user?.role,
    action: "VIEW_ALERTS_LIST",
    resource: req.path,
    details: { count: result.length },
  }).catch(() => {});
  res.json(result);
});

app.post(["/alerts/:event_id/acknowledge", "/api/alerts/:event_id/acknowledge"], authenticateToken, async (req: AuthenticatedRequest, res) => {
  const alertId = String(req.params.event_id);
  const existingAlert = alerts.find((a) => a.event_id === alertId);

  // Stop escalation timer if active
  if (escalationTimers.has(alertId)) {
    clearTimeout(escalationTimers.get(alertId)!);
    escalationTimers.delete(alertId);
    console.log(`[ESCALATION STOPPED] Escalation timer stopped for alert ${alertId}`);
  }

  const result = await acknowledgeAlert(
    alertId,
    req.body,
    existingAlert?.patient_id,
  );

  if (existingAlert) {
    existingAlert.acknowledged = true;
    existingAlert.acknowledged_at = new Date().toISOString();
    await saveAlert(existingAlert);
  }

  recordDataAccessAudit({
    user_id: req.user?.id,
    role: req.user?.role,
    action: "ALERT_ACKNOWLEDGED",
    resource: req.path,
    patient_id: existingAlert?.patient_id,
    details: { event_id: alertId },
  }).catch(() => {});

  io.emit("alert_acknowledged", result);
  io.emit("alert:acknowledged", {
    event_id: alertId,
    acknowledged: true,
    acknowledged_at: new Date().toISOString(),
  });
  res.json({ ...result, stopped_escalation: true, disclaimer: DISCLAIMER });
});

app.post(["/alerts/:id/ack", "/api/alerts/:id/ack"], authenticateToken, async (req: AuthenticatedRequest, res) => {
  const eventId = String(req.params.id);
  const alert = alerts.find((a) => a.event_id === eventId);

  if (escalationTimers.has(eventId)) {
    clearTimeout(escalationTimers.get(eventId)!);
    escalationTimers.delete(eventId);
    console.log(`[ESCALATION STOPPED] Escalation timer stopped for alert ${eventId}`);
  }

  const now = new Date().toISOString();
  if (alert) {
    alert.acknowledged = true;
    alert.acknowledged_at = now;
    await saveAlert(alert);
    io.emit("alert:acknowledged", {
      event_id: alert.event_id,
      acknowledged: true,
      acknowledged_at: alert.acknowledged_at,
    });
    io.emit("alert:updated", alert);
  }

  recordDataAccessAudit({
    user_id: req.user?.id,
    role: req.user?.role,
    action: "ALERT_ACKNOWLEDGED",
    resource: req.path,
    patient_id: alert?.patient_id,
    details: { event_id: eventId },
  }).catch(() => {});

  res.json({
    ok: true,
    alert: alert ?? { event_id: eventId, acknowledged: true, acknowledged_at: now },
    stopped_escalation: true,
    disclaimer: DISCLAIMER,
  });
});

// Feedback on alert ("False alarm" / "Real problem" or "false_alarm" / "real_problem")
app.post(["/alerts/:id/feedback", "/api/alerts/:id/feedback"], authenticateToken, async (req: AuthenticatedRequest, res) => {
  const eventId = String(req.params.id);
  const rawFeedback = req.body?.feedback;

  const normalizedFeedback =
    rawFeedback === "False alarm" || rawFeedback === "false_alarm"
      ? "False alarm"
      : rawFeedback === "Real problem" || rawFeedback === "real_problem"
      ? "Real problem"
      : null;

  if (!normalizedFeedback) {
    res.status(400).json({ error: "Feedback must be 'False alarm' / 'false_alarm' or 'Real problem' / 'real_problem'" });
    return;
  }

  const alert = alerts.find((a) => a.event_id === eventId);
  const now = new Date().toISOString();
  if (alert) {
    alert.feedback = normalizedFeedback;
    alert.feedback_at = now;
    await saveAlert(alert);
    io.emit("alert:feedback", {
      event_id: alert.event_id,
      feedback: alert.feedback,
      feedback_at: alert.feedback_at,
    });
    io.emit("alert:updated", alert);
  }

  recordDataAccessAudit({
    user_id: req.user?.id,
    role: req.user?.role,
    action: "ALERT_FEEDBACK_RECORDED",
    resource: req.path,
    patient_id: alert?.patient_id,
    details: { event_id: eventId, feedback: normalizedFeedback },
  }).catch(() => {});

  res.json({ ok: true, alert, disclaimer: DISCLAIMER });
});

// Resolve triage alert with action, notes, and clinician signature
app.post(["/alerts/:id/resolve", "/api/alerts/:id/resolve"], authenticateToken, async (req: AuthenticatedRequest, res) => {
  const eventId = String(req.params.id);
  const { action, note, clinician } = req.body ?? {};

  // Stop escalation timer if active
  if (escalationTimers.has(eventId)) {
    clearTimeout(escalationTimers.get(eventId)!);
    escalationTimers.delete(eventId);
    console.log(`[ESCALATION RESOLVED] Escalation timer stopped for alert ${eventId}`);
  }

  const alert = alerts.find((a) => a.event_id === eventId);
  const now = new Date().toISOString();
  if (alert) {
    alert.resolved = true;
    alert.resolved_at = now;
    alert.resolved_by = clinician || req.user?.username || "Clinician";
    alert.resolution_action = action || "Clinical Review & Resolution Protocol Completed";
    alert.resolution_note = note || "";
    alert.acknowledged = true;
    if (!alert.acknowledged_at) alert.acknowledged_at = now;

    await saveAlert(alert);
    io.emit("alert:resolved", {
      event_id: alert.event_id,
      resolved: true,
      resolved_at: alert.resolved_at,
      resolved_by: alert.resolved_by,
      resolution_action: alert.resolution_action,
      resolution_note: alert.resolution_note,
    });
    io.emit("alert:updated", alert);
  }

  recordDataAccessAudit({
    user_id: req.user?.id,
    role: req.user?.role,
    action: "ALERT_RESOLVED",
    resource: req.path,
    patient_id: alert?.patient_id,
    details: { event_id: eventId, action, clinician },
  }).catch(() => {});

  res.json({
    ok: true,
    alert: alert ?? { event_id: eventId, resolved: true, resolved_at: now },
    disclaimer: DISCLAIMER,
  });
});

// -----------------------------------------------------------------------------
// Audit Trail Endpoints (Requirement 5)
// -----------------------------------------------------------------------------
app.get(["/alerts/:event_id/audit", "/api/alerts/:event_id/audit"], authenticateToken, async (req, res) => {
  const alertId = String(req.params.event_id);
  const trail = await getAuditTrail({ alert_id: alertId });
  res.json(trail);
});

app.get(["/audit", "/api/audit"], authenticateToken, async (req, res) => {
  const patientId = req.query.patient_id ? String(req.query.patient_id) : undefined;
  const alertId = req.query.alert_id ? String(req.query.alert_id) : undefined;
  const trail = await getAuditTrail({ patient_id: patientId, alert_id: alertId });
  res.json(trail);
});

// Twilio SMS Test & Dispatch Endpoint
app.post(["/notifications/sms", "/api/notifications/sms"], async (req, res) => {
  const to = req.body?.to || process.env.PRIMARY_CAREGIVER_PHONE || "+918076860402";
  const body = req.body?.body || req.body?.message || "CareConnect SMS Test: System active and monitoring.";

  try {
    const result = await sendTwilioSms(to, body);
    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Twilio WhatsApp Test & Dispatch Endpoint
app.post(["/notifications/whatsapp", "/api/notifications/whatsapp"], async (req, res) => {
  const to = req.body?.to || process.env.PRIMARY_CAREGIVER_PHONE || "+918076860402";
  const body = req.body?.body || req.body?.message || "CareConnect WhatsApp Test: System active and monitoring.";
  const contentSid = req.body?.contentSid;
  const contentVariables = req.body?.contentVariables;

  try {
    const result = await sendTwilioWhatsApp({
      to,
      body,
      contentSid,
      contentVariables,
    });
    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// Medications & DDI Engine Endpoints
// -----------------------------------------------------------------------------
app.get(["/medications/:patient_id", "/api/medications/:patient_id"], authenticateToken, async (req: AuthenticatedRequest, res) => {
  const patientId = String(req.params.patient_id);
  const dbMeds = await getPatientMedications(patientId);
  const list = dbMeds.length > 0 ? dbMeds : (medications.get(patientId) ?? DEMO_MEDICATIONS_PT001);
  recordDataAccessAudit({
    user_id: req.user?.id,
    role: req.user?.role,
    action: "VIEW_MEDICATIONS",
    resource: req.path,
    patient_id: patientId,
  }).catch(() => {});
  res.json(list);
});

function updatePatientMedications(patientId: string, list: Medication[]) {
  medications.set(patientId, list);
  savePatientMedications(patientId, list).catch(() => {});
  io.emit("medications", { patient_id: patientId, medications: list });

  const ddiResult = analyzeDrugInteractions(patientId, list);

  // If a CRITICAL drug interaction is detected, emit COMPOUND alert and trigger escalation
  if (ddiResult.critical_alert) {
    alerts.push(ddiResult.critical_alert);
    saveAlert(ddiResult.critical_alert).catch(() => {});
    io.emit("alert", ddiResult.critical_alert);

    handleAlertEscalation(ddiResult.critical_alert, {
      vitals: latestVitals.get(patientId),
      medications: list,
    }).catch((err) =>
      console.error("[DDI Escalation] Error escalating compound alert:", err),
    );
  }

  return ddiResult;
}

app.post(["/api/patients/:id/medications", "/patients/:id/medications"], authenticateToken, (req: AuthenticatedRequest, res) => {
  const body = req.body;
  const list = Array.isArray(body) ? body : body.medications;
  if (!Array.isArray(list)) {
    res.status(400).json({ error: "Body must be Medication[] or { medications: Medication[] }" });
    return;
  }
  const patientId = String(req.params.id);
  const result = updatePatientMedications(patientId, list as Medication[]);
  recordDataAccessAudit({
    user_id: req.user?.id,
    role: req.user?.role,
    action: "UPDATE_MEDICATIONS",
    resource: req.path,
    patient_id: patientId,
    details: { count: list.length, critical_interactions: result.critical_interactions.length },
  }).catch(() => {});
  res.status(201).json({ ...result, disclaimer: DISCLAIMER });
});

app.get(["/api/patients/:id/interactions", "/patients/:id/interactions"], authenticateToken, (req: AuthenticatedRequest, res) => {
  const patientId = String(req.params.id);
  const list = medications.get(patientId) || [];
  const result = analyzeDrugInteractions(patientId, list);
  recordDataAccessAudit({
    user_id: req.user?.id,
    role: req.user?.role,
    action: "VIEW_DRUG_INTERACTIONS",
    resource: req.path,
    patient_id: patientId,
  }).catch(() => {});
  res.json({ ...result, disclaimer: DISCLAIMER });
});

app.post(["/medications/:patient_id", "/api/medications/:patient_id"], authenticateToken, (req: AuthenticatedRequest, res) => {
  const list = req.body;
  if (!Array.isArray(list)) {
    res.status(400).json({ error: "Body must be Medication[]" });
    return;
  }
  const patientId = String(req.params.patient_id);
  medications.set(patientId, list as Medication[]);
  const ddiOutput = fusionEngine.updateMedications(patientId, list as Medication[]);
  const ddiResult = updatePatientMedications(patientId, list as Medication[]);
  io.emit("medications", { patient_id: patientId, medications: list });
  res.status(201).json({ ok: true, ddi: ddiResult, fusion: ddiOutput, disclaimer: DISCLAIMER });
});

// -----------------------------------------------------------------------------
// Simulator Scenarios (Demo Panel)
// -----------------------------------------------------------------------------
const scenarioHandler = async (req: express.Request, res: express.Response) => {
  const scenario = req.body?.scenario || req.params?.scenario;
  const patient_id = req.body?.patient_id || "pt_001";
  const now = new Date().toISOString();

  let packet: VitalsPacket;
  let customAlert: Alert | null = null;

  if (scenario === "stable" || scenario === "normal") {
    packet = {
      patient_id,
      timestamp: now,
      heart_rate: 74,
      spo2: 98.5,
      systolic_bp: 120,
      diastolic_bp: 78,
    };
  } else if (scenario === "watching" || scenario === "warning") {
    packet = {
      patient_id,
      timestamp: now,
      heart_rate: 114,
      spo2: 95,
      systolic_bp: 148,
      diastolic_bp: 94,
    };
  } else if (scenario === "crisis" || scenario === "critical") {
    packet = {
      patient_id,
      timestamp: now,
      heart_rate: 146,
      spo2: 83,
      systolic_bp: 74,
      diastolic_bp: 42,
    };
  } else if (scenario === "compound") {
    packet = {
      patient_id,
      timestamp: now,
      heart_rate: 46,
      spo2: 91,
      systolic_bp: 72,
      diastolic_bp: 40,
    };
    const patientMeds = medications.get(patient_id) ?? DEMO_MEDICATIONS_PT001;
    fusionEngine.updateMedications(patient_id, patientMeds);
    const fusionRes = fusionEngine.processVitals(packet);
    customAlert = fusionRes.alert ?? {
      event_id: randomUUID(),
      patient_id,
      timestamp: now,
      severity: "RED",
      type: "COMPOUND",
      message: "Profound hypotension and severe bradycardia. Additive beta-blocker and ACE-inhibitor hemodynamic crash.",
      instructions: [
        "Stay with the patient.",
        "Recheck vitals immediately.",
        "Escalate to a clinician.",
      ],
      contributing_signals: ["systolic_bp", "diastolic_bp", "heart_rate"],
      interaction: {
        drugs: ["Lisinopril 10mg", "Metoprolol 25mg"],
        mechanism: "Concurrent vasodilation and negative chronotropy exacerbating hypotensive shock",
        clinical_effect: "Severe hypoperfusion, bradyarrhythmia, acute dizziness/syncope",
      },
    };
  } else {
    res.status(400).json({ error: "Unknown scenario. Use 'stable', 'watching', 'crisis', or 'compound'" });
    return;
  }

  latestVitals.set(packet.patient_id, packet);
  await writeVitalsToInflux(packet);

  const alert = customAlert ?? evaluateVitals(packet);
  alerts.push(alert);
  await saveAlert(alert);

  io.emit("vitals", packet);
  io.emit("alert", alert);
  handleCriticalAlert(alert);

  // Trigger escalation workflow for RED alerts
  if (alert.severity === "RED") {
    handleAlertEscalation(alert, {
      vitals: packet,
      medications: medications.get(patient_id),
    }).catch((err) => console.error("[Escalation] Error handling alert:", err));
  }

  res.json({ ok: true, scenario, packet, alert, disclaimer: DISCLAIMER });
};

app.post("/api/simulator/scenario", scenarioHandler);
app.post("/simulator/scenario", scenarioHandler);
app.post("/api/simulator/:scenario", scenarioHandler);
app.post("/simulator/:scenario", scenarioHandler);

// Fusion risk state endpoint for dashboard
app.get(["/fusion/risk/:patient_id", "/api/fusion/risk/:patient_id"], (req, res) => {
  const patientId = String(req.params.patient_id);
  const state = fusionEngine.getRiskState(patientId);
  const ddi = fusionEngine.getDDIEngine().getLatestOutput(patientId);
  res.json({
    ok: true,
    risk_state: state,
    ddi,
  });
});

io.on("connection", (socket) => {
  socket.emit("hello", { service: "careconnect-backend", disclaimer: DISCLAIMER });
});

server.on("error", (err: any) => {
  if (err.code === "EADDRINUSE") {
    console.log(`[Server] Port ${PORT} already in use; reusing existing listener.`);
  } else {
    console.error("[Server] Error:", err);
  }
});

server.listen(PORT, async () => {
  console.log(`CareConnect backend listening on http://localhost:${PORT}`);
  try {
    await runMigrations();
  } catch (err) {
    console.warn("[PostgreSQL] Could not auto-apply migrations on startup:", err);
  }
});

export { app, server, io, alerts, latestVitals, escalationTimers, fusionEngine };
