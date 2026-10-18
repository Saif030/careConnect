import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), "../.env") });
loadEnv();

import type { Alert, Medication, VitalsPacket } from "./types.js";
import {
  recordAuditEvent,
  recordAcknowledgment,
  recordNotification,
  getAuditTrail,
} from "./db/index.js";
import {
  sendTwilioSms,
  sendTwilioVoiceCall,
  sendTwilioWhatsApp,
  TwilioNotificationResult,
} from "./notifications/twilio.js";
import { sendSupabasePush, SupabasePushResult } from "./notifications/supabase.js";

export interface CaregiverContact {
  name: string;
  phone: string;
}

export interface EscalationConfig {
  step1DelayMs: number;
  step2DelayMs: number;
  rateLimitWindowMs: number;
  primaryCaregiver: CaregiverContact;
  secondaryCaregiver: CaregiverContact;
  dashboardBaseUrl: string;
}

export interface EscalationContext {
  patientName?: string;
  vitals?: VitalsPacket;
  medications?: Medication[];
  primaryCaregiver?: CaregiverContact;
  secondaryCaregiver?: CaregiverContact;
}

export type EscalationState = "PENDING_STEP1" | "STEP1_SENT" | "PENDING_STEP2" | "STEP2_SENT" | "ACKNOWLEDGED" | "CANCELLED";

export interface ActiveEscalation {
  alertId: string;
  patientId: string;
  alertType: string;
  alert: Alert;
  context: EscalationContext;
  step1Timer: NodeJS.Timeout | null;
  step2Timer: NodeJS.Timeout | null;
  state: EscalationState;
  createdAt: number;
}

export interface AcknowledgmentRequest {
  acknowledged_by?: string;
  notes?: string;
}

export interface EscalationResult {
  status: "SCHEDULED" | "IGNORED" | "RATE_LIMITED";
  alert_id: string;
  patient_id: string;
  reason?: string;
  timer_ms?: number;
}

export function getEscalationConfig(overrides?: Partial<EscalationConfig>): EscalationConfig {
  const step1Delay =
    overrides?.step1DelayMs !== undefined
      ? overrides.step1DelayMs
      : process.env.STEP_1_DELAY_MS !== undefined
      ? Number(process.env.STEP_1_DELAY_MS)
      : (DEFAULT_CONFIG as any)._step1 !== undefined
      ? (DEFAULT_CONFIG as any)._step1
      : 0; // Default 0 for instant emergency alerts

  const step2Delay =
    overrides?.step2DelayMs !== undefined
      ? overrides.step2DelayMs
      : process.env.STEP_2_DELAY_MS !== undefined
      ? Number(process.env.STEP_2_DELAY_MS)
      : (DEFAULT_CONFIG as any)._step2 !== undefined
      ? (DEFAULT_CONFIG as any)._step2
      : 60_000;

  const rateLimitWindow =
    overrides?.rateLimitWindowMs !== undefined
      ? overrides.rateLimitWindowMs
      : process.env.RATE_LIMIT_WINDOW_MS !== undefined
      ? Number(process.env.RATE_LIMIT_WINDOW_MS)
      : (DEFAULT_CONFIG as any)._rateLimit !== undefined
      ? (DEFAULT_CONFIG as any)._rateLimit
      : 5_000;

  const primaryPhone =
    overrides?.primaryCaregiver?.phone ||
    process.env.PRIMARY_CAREGIVER_PHONE ||
    DEFAULT_CONFIG.primaryCaregiver?.phone ||
    "+918076860402";

  const primaryName =
    overrides?.primaryCaregiver?.name ||
    process.env.PRIMARY_CAREGIVER_NAME ||
    DEFAULT_CONFIG.primaryCaregiver?.name ||
    "Primary Caregiver";

  const secondaryPhone =
    overrides?.secondaryCaregiver?.phone ||
    process.env.SECONDARY_CAREGIVER_PHONE ||
    DEFAULT_CONFIG.secondaryCaregiver?.phone ||
    "+15559876543";

  const secondaryName =
    overrides?.secondaryCaregiver?.name ||
    process.env.SECONDARY_CAREGIVER_NAME ||
    DEFAULT_CONFIG.secondaryCaregiver?.name ||
    "Secondary Caregiver";

  return {
    step1DelayMs: step1Delay,
    step2DelayMs: step2Delay,
    rateLimitWindowMs: rateLimitWindow,
    primaryCaregiver: { name: primaryName, phone: primaryPhone },
    secondaryCaregiver: { name: secondaryName, phone: secondaryPhone },
    dashboardBaseUrl: overrides?.dashboardBaseUrl || process.env.DASHBOARD_URL || "http://localhost:5173",
  };
}

export const DEFAULT_CONFIG: EscalationConfig = {
  get step1DelayMs() {
    return (this as any)._step1 ?? (process.env.STEP_1_DELAY_MS !== undefined ? Number(process.env.STEP_1_DELAY_MS) : 0);
  },
  set step1DelayMs(val: number) {
    (this as any)._step1 = val;
  },
  get step2DelayMs() {
    return (this as any)._step2 ?? (process.env.STEP_2_DELAY_MS !== undefined ? Number(process.env.STEP_2_DELAY_MS) : 60_000);
  },
  set step2DelayMs(val: number) {
    (this as any)._step2 = val;
  },
  get rateLimitWindowMs() {
    return (this as any)._rateLimit ?? (process.env.RATE_LIMIT_WINDOW_MS !== undefined ? Number(process.env.RATE_LIMIT_WINDOW_MS) : 5_000);
  },
  set rateLimitWindowMs(val: number) {
    (this as any)._rateLimit = val;
  },
  get primaryCaregiver(): CaregiverContact {
    return {
      name: (this as any)._pName || process.env.PRIMARY_CAREGIVER_NAME || "Primary Caregiver",
      phone: (this as any)._pPhone || process.env.PRIMARY_CAREGIVER_PHONE || "+918076860402",
    };
  },
  set primaryCaregiver(val: CaregiverContact) {
    (this as any)._pName = val.name;
    (this as any)._pPhone = val.phone;
  },
  get secondaryCaregiver(): CaregiverContact {
    return {
      name: (this as any)._sName || process.env.SECONDARY_CAREGIVER_NAME || "Secondary Contact",
      phone: (this as any)._sPhone || process.env.SECONDARY_CAREGIVER_PHONE || "+15559876543",
    };
  },
  set secondaryCaregiver(val: CaregiverContact) {
    (this as any)._sName = val.name;
    (this as any)._sPhone = val.phone;
  },
  get dashboardBaseUrl() {
    return process.env.DASHBOARD_URL || "http://localhost:5173";
  },
};

// In-memory registry of active escalations keyed by alert_id
const activeEscalations = new Map<string, ActiveEscalation>();

// Rate limit store: `${patient_id}:${alert_type}` -> timestamp of last notification
const lastNotificationMap = new Map<string, number>();

/**
 * Message template containing:
 * - Patient name
 * - Time
 * - Plain-language summary
 * - Key vitals
 * - Active medication list
 * - Dashboard link
 */
export function formatEscalationMessage(
  alert: Alert,
  context: EscalationContext = {},
  dashboardBaseUrl: string = DEFAULT_CONFIG.dashboardBaseUrl,
): string {
  let patientName = context.patientName;
  if (!patientName) {
    if (alert.patient_id === "pt_001") patientName = "Eleanor Vance";
    else if (alert.patient_id === "pt_002") patientName = "Robert Chen";
    else patientName = `Patient ${alert.patient_id}`;
  }
  const time = alert.timestamp || new Date().toISOString();
  const summary = alert.message || "Critical alert triggered.";

  let vitalsStr = "Not available";
  if (context.vitals) {
    vitalsStr = `HR ${context.vitals.heart_rate} bpm, SpO2 ${context.vitals.spo2}%, BP ${context.vitals.systolic_bp}/${context.vitals.diastolic_bp} mmHg`;
  }

  let medsStr = "None recorded";
  if (context.medications && context.medications.length > 0) {
    medsStr = context.medications
      .map((m) => `${m.drug_name} (${m.strength}, ${m.frequency})`)
      .join(", ");
  }

  const dashboardLink = `${dashboardBaseUrl.replace(/\/$/, "")}/patient/${alert.patient_id}`;

  return [
    `CRITICAL ALERT: ${patientName}`,
    `Time: ${time}`,
    `Summary: ${summary}`,
    `Key Vitals: ${vitalsStr}`,
    `Active Medications: ${medsStr}`,
    `Dashboard: ${dashboardLink}`,
  ].join("\n");
}

export function formatVoiceMessage(
  alert: Alert,
  context: EscalationContext = {},
): string {
  let patientName = context.patientName;
  if (!patientName) {
    if (alert.patient_id === "pt_001") patientName = "Eleanor Vance";
    else if (alert.patient_id === "pt_002") patientName = "Robert Chen";
    else patientName = `Patient ${alert.patient_id}`;
  }
  let vitalsSpeech = "";
  if (context.vitals) {
    vitalsSpeech = `Heart rate is ${context.vitals.heart_rate} beats per minute, oxygen saturation is ${context.vitals.spo2} percent, blood pressure is ${context.vitals.systolic_bp} over ${context.vitals.diastolic_bp}.`;
  }
  return `Emergency alert for ${patientName}. ${alert.message}. ${vitalsSpeech} Immediate clinical attention is required.`;
}

/**
 * Checks if a notification is rate-limited:
 * Max 1 notification per patient per alert type per rateLimitWindowMs.
 */
export function isRateLimited(
  patientId: string,
  alertType: string,
  windowMs: number = DEFAULT_CONFIG.rateLimitWindowMs,
): boolean {
  if (process.env.DISABLE_RATE_LIMIT === "true" || windowMs <= 0) {
    return false;
  }
  const key = `${patientId}:${alertType}`;
  const lastTime = lastNotificationMap.get(key);
  if (!lastTime) {
    return false;
  }
  return Date.now() - lastTime < windowMs;
}

export function markNotificationSent(
  patientId: string,
  alertType: string,
  timestamp: number = Date.now(),
): void {
  const key = `${patientId}:${alertType}`;
  lastNotificationMap.set(key, timestamp);
}

export function resetRateLimits(): void {
  lastNotificationMap.clear();
}

/**
 * Main escalation handler for an Alert.
 * If severity is RED, initiates the multi-step escalation workflow.
 */
export async function handleAlertEscalation(
  alert: Alert,
  context: EscalationContext = {},
  overrides?: Partial<EscalationConfig>,
): Promise<EscalationResult> {
  if (alert.severity !== "RED") {
    return {
      status: "IGNORED",
      alert_id: alert.event_id,
      patient_id: alert.patient_id,
      reason: `Severity is ${alert.severity}, escalation only runs on RED alerts.`,
    };
  }

  const config: EscalationConfig = getEscalationConfig(overrides);

  const alertId = alert.event_id;
  const patientId = alert.patient_id;
  const alertType = alert.type;

  // Check rate limiting: max 1 notification per patient per alert type per rateLimitWindowMs
  if (isRateLimited(patientId, alertType, config.rateLimitWindowMs)) {
    const reason = `Rate limit exceeded: max 1 notification per patient per alert type per ${Math.round(
      config.rateLimitWindowMs / 60000,
    )} minutes.`;
    console.warn(`[Escalation] Alert ${alertId} throttled: ${reason}`);

    await recordAuditEvent({
      alert_id: alertId,
      patient_id: patientId,
      event_type: "ALERT_RATE_LIMITED",
      severity: alert.severity,
      alert_type: alertType,
      details: {
        reason,
        rateLimitWindowMs: config.rateLimitWindowMs,
      },
    });

    return {
      status: "RATE_LIMITED",
      alert_id: alertId,
      patient_id: patientId,
      reason,
    };
  }

  // Log alert event to audit trail
  await recordAuditEvent({
    alert_id: alertId,
    patient_id: patientId,
    event_type: "RED_ALERT_DETECTED",
    severity: alert.severity,
    alert_type: alertType,
    details: {
      message: alert.message,
      signals: alert.contributing_signals,
      timer_ms: config.step1DelayMs,
    },
  });

  const escalation: ActiveEscalation = {
    alertId,
    patientId,
    alertType,
    alert,
    context,
    step1Timer: null,
    step2Timer: null,
    state: "PENDING_STEP1",
    createdAt: Date.now(),
  };

  activeEscalations.set(alertId, escalation);

  if (config.step1DelayMs <= 0) {
    console.log(`[Escalation] RED alert ${alertId} detected for patient ${patientId}. Executing Step 1 immediately.`);
    executeStep1(escalation, config).catch((err) =>
      console.error("[Escalation] Error in executeStep1:", err),
    );
  } else {
    console.log(
      `[Escalation] RED alert ${alertId} detected for patient ${patientId}. Starting ${
        config.step1DelayMs / 1000
      }s timer for Step 1.`,
    );
    escalation.step1Timer = setTimeout(async () => {
      await executeStep1(escalation, config);
    }, config.step1DelayMs);
  }

  await recordAuditEvent({
    alert_id: alertId,
    patient_id: patientId,
    event_type: "TIMER_STARTED",
    severity: alert.severity,
    alert_type: alertType,
    details: {
      step: 1,
      delayMs: config.step1DelayMs,
    },
  });

  return {
    status: "SCHEDULED",
    alert_id: alertId,
    patient_id: patientId,
    timer_ms: config.step1DelayMs,
  };
}

/**
 * Step 1:
 * Sends SMS and a voice call to the primary caregiver via Twilio,
 * and sends an FCM push notification (stub if keys are missing).
 * Then starts a 60-second timer for Step 2.
 */
async function executeStep1(
  escalation: ActiveEscalation,
  config: EscalationConfig,
): Promise<void> {
  const { alertId, patientId, alertType, alert, context } = escalation;

  // Double check if acknowledged before executing
  if (escalation.state === "ACKNOWLEDGED" || escalation.state === "CANCELLED") {
    console.log(`[Escalation] Alert ${alertId} already ${escalation.state}. Skipping step 1.`);
    return;
  }

  escalation.state = "STEP1_SENT";
  markNotificationSent(patientId, alertType);

  let primaryPhone = context.primaryCaregiver?.phone;
  if (!primaryPhone) {
    primaryPhone =
      config.primaryCaregiver?.phone ||
      process.env.PRIMARY_CAREGIVER_PHONE ||
      "+918076860402";
  }
  if (primaryPhone === "+15551234567" && process.env.PRIMARY_CAREGIVER_PHONE) {
    primaryPhone = process.env.PRIMARY_CAREGIVER_PHONE;
  }

  const primary: CaregiverContact = {
    name: context.primaryCaregiver?.name || config.primaryCaregiver.name || "Primary Caregiver",
    phone: primaryPhone,
  };

  const messageBody = formatEscalationMessage(alert, context, config.dashboardBaseUrl);
  const voiceBody = formatVoiceMessage(alert, context);

  console.log(`[Escalation] Executing Step 1 for alert ${alertId} (Primary: ${primary.name} at ${primary.phone})...`);

  // 1. Send Twilio SMS to primary caregiver
  let smsResult: TwilioNotificationResult;
  try {
    smsResult = await sendTwilioSms(primary.phone, messageBody);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    smsResult = { sid: "", channel: "SMS", to: primary.phone, status: "FAILED", error: msg };
  }
  await recordNotification({
    alert_id: alertId,
    patient_id: patientId,
    step: 1,
    channel: "SMS",
    recipient: primary.phone,
    status: smsResult.status,
    message_body: messageBody,
    sid: smsResult.sid,
    details: { contactName: primary.name, error: smsResult.error },
  });

  // 2. Send Twilio Voice Call to primary caregiver
  let callResult: TwilioNotificationResult;
  try {
    callResult = await sendTwilioVoiceCall(primary.phone, voiceBody);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    callResult = { sid: "", channel: "VOICE", to: primary.phone, status: "FAILED", error: msg };
  }
  await recordNotification({
    alert_id: alertId,
    patient_id: patientId,
    step: 1,
    channel: "VOICE",
    recipient: primary.phone,
    status: callResult.status,
    message_body: voiceBody,
    sid: callResult.sid,
    details: { contactName: primary.name, error: callResult.error },
  });

  // 3. Send Supabase Realtime push notification
  let supabaseResult: SupabasePushResult;
  try {
    supabaseResult = await sendSupabasePush(
      { patientId },
      {
        title: `RED ALERT: ${context.patientName || `Patient ${patientId}`}`,
        body: alert.message,
        data: {
          alert_id: alertId,
          patient_id: patientId,
          severity: alert.severity,
        },
      },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    supabaseResult = { messageId: "", recipient: `channel:patient_${patientId}`, status: "FAILED", error: msg };
  }
  await recordNotification({
    alert_id: alertId,
    patient_id: patientId,
    step: 1,
    channel: "Supabase",
    recipient: supabaseResult.recipient,
    status: supabaseResult.status,
    message_body: `${alert.message}`,
    sid: supabaseResult.messageId,
    details: { error: supabaseResult.error },
  });

  // 4. Send Twilio WhatsApp to primary caregiver
  let whatsappResult: TwilioNotificationResult;
  try {
    whatsappResult = await sendTwilioWhatsApp({
      to: primary.phone,
      body: messageBody,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    whatsappResult = { sid: "", channel: "WHATSAPP", to: primary.phone, status: "FAILED", error: msg };
  }
  await recordNotification({
    alert_id: alertId,
    patient_id: patientId,
    step: 1,
    channel: "WHATSAPP",
    recipient: primary.phone,
    status: whatsappResult.status,
    message_body: messageBody,
    sid: whatsappResult.sid,
    details: { contactName: primary.name, error: whatsappResult.error },
  });

  await recordAuditEvent({
    alert_id: alertId,
    patient_id: patientId,
    event_type: "STEP_1_COMPLETED",
    severity: alert.severity,
    alert_type: alertType,
    details: {
      primaryPhone: primary.phone,
      smsStatus: smsResult.status,
      callStatus: callResult.status,
      supabaseStatus: supabaseResult.status,
      whatsappStatus: whatsappResult.status,
      nextStepDelayMs: config.step2DelayMs,
    },
  });

  // Step 2, after another 60 seconds, notifies the secondary contact
  const currentState = escalation.state as EscalationState;
  if (currentState === "ACKNOWLEDGED" || currentState === "CANCELLED" || !activeEscalations.has(alertId)) {
    console.log(`[Escalation] Alert ${alertId} was cancelled/acknowledged during Step 1. Skipping Step 2.`);
    return;
  }

  escalation.state = "PENDING_STEP2";
  console.log(
    `[Escalation] Alert ${alertId}: Step 1 finished. Starting ${
      config.step2DelayMs / 1000
    }s timer for Step 2.`,
  );

  escalation.step2Timer = setTimeout(async () => {
    await executeStep2(escalation, config);
  }, config.step2DelayMs);
}

/**
 * Step 2:
 * After another 60 seconds without acknowledgment, notifies the secondary contact.
 */
async function executeStep2(
  escalation: ActiveEscalation,
  config: EscalationConfig,
): Promise<void> {
  const { alertId, patientId, alertType, alert, context } = escalation;

  if (escalation.state === "ACKNOWLEDGED" || escalation.state === "CANCELLED") {
    console.log(`[Escalation] Alert ${alertId} already ${escalation.state}. Skipping step 2.`);
    return;
  }

  escalation.state = "STEP2_SENT";
  let secondaryPhone = context.secondaryCaregiver?.phone;
  if (!secondaryPhone || secondaryPhone === "+15559876543") {
    secondaryPhone =
      config.secondaryCaregiver?.phone ||
      process.env.SECONDARY_CAREGIVER_PHONE ||
      process.env.PRIMARY_CAREGIVER_PHONE ||
      "+918076860402";
  }
  const secondary: CaregiverContact = {
    name: context.secondaryCaregiver?.name || config.secondaryCaregiver?.name || "Backup Emergency Contact",
    phone: secondaryPhone,
  };
  const baseMessage = formatEscalationMessage(alert, context, config.dashboardBaseUrl);
  const messageBody = `🚨 URGENT ESCALATION (UNACKNOWLEDGED AFTER 60s) 🚨\nPrimary caregiver did not acknowledge alert within 60s!\n\n${baseMessage}`;
  const voiceBody = `Emergency escalation. Alert unacknowledged after sixty seconds. ${formatVoiceMessage(alert, context)}`;

  console.log(
    `[Escalation] Executing Step 2 for alert ${alertId} (Secondary: ${secondary.name} at ${secondary.phone})...`,
  );

  // 1. Send Twilio SMS to secondary contact
  let smsResult: TwilioNotificationResult;
  try {
    smsResult = await sendTwilioSms(secondary.phone, messageBody);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    smsResult = { sid: "", channel: "SMS", to: secondary.phone, status: "FAILED", error: msg };
  }
  await recordNotification({
    alert_id: alertId,
    patient_id: patientId,
    step: 2,
    channel: "SMS",
    recipient: secondary.phone,
    status: smsResult.status,
    message_body: messageBody,
    sid: smsResult.sid,
    details: { contactName: secondary.name, error: smsResult.error },
  });

  // 2. Send Twilio Voice Call to secondary contact
  let callResult: TwilioNotificationResult;
  try {
    callResult = await sendTwilioVoiceCall(secondary.phone, voiceBody);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    callResult = { sid: "", channel: "VOICE", to: secondary.phone, status: "FAILED", error: msg };
  }
  await recordNotification({
    alert_id: alertId,
    patient_id: patientId,
    step: 2,
    channel: "VOICE",
    recipient: secondary.phone,
    status: callResult.status,
    message_body: voiceBody,
    sid: callResult.sid,
    details: { contactName: secondary.name, error: callResult.error },
  });

  // 3. Send Twilio WhatsApp to secondary contact
  let whatsappResult: TwilioNotificationResult;
  try {
    whatsappResult = await sendTwilioWhatsApp({
      to: secondary.phone,
      body: messageBody,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    whatsappResult = { sid: "", channel: "WHATSAPP", to: secondary.phone, status: "FAILED", error: msg };
  }
  await recordNotification({
    alert_id: alertId,
    patient_id: patientId,
    step: 2,
    channel: "WHATSAPP",
    recipient: secondary.phone,
    status: whatsappResult.status,
    message_body: messageBody,
    sid: whatsappResult.sid,
    details: { contactName: secondary.name, error: whatsappResult.error },
  });

  await recordAuditEvent({
    alert_id: alertId,
    patient_id: patientId,
    event_type: "STEP_2_COMPLETED",
    severity: alert.severity,
    alert_type: alertType,
    details: {
      secondaryPhone: secondary.phone,
      smsStatus: smsResult.status,
      callStatus: callResult.status,
      whatsappStatus: whatsappResult.status,
    },
  });

  activeEscalations.delete(alertId);
}

/**
 * Acknowledges an alert.
 * If acknowledged: cancels active timers and logs it.
 */
export async function acknowledgeAlert(
  alertId: string,
  req: AcknowledgmentRequest = {},
  patientIdFallback?: string,
): Promise<{
  success: boolean;
  alert_id: string;
  timer_cancelled: boolean;
  acknowledged_by: string;
  message: string;
}> {
  const escalation = activeEscalations.get(alertId);
  const acknowledgedBy = req.acknowledged_by || "Clinician / Caregiver";
  const notes = req.notes || "Acknowledged via CareConnect dashboard";

  let timerCancelled = false;
  let patientId = patientIdFallback || "unknown";

  if (escalation) {
    patientId = escalation.patientId;
    if (escalation.step1Timer) {
      clearTimeout(escalation.step1Timer);
      escalation.step1Timer = null;
      timerCancelled = true;
    }
    if (escalation.step2Timer) {
      clearTimeout(escalation.step2Timer);
      escalation.step2Timer = null;
      timerCancelled = true;
    }
    escalation.state = "ACKNOWLEDGED";
    activeEscalations.delete(alertId);
  }

  console.log(
    `[Escalation] Alert ${alertId} ACKNOWLEDGED by ${acknowledgedBy}. Timer cancelled: ${timerCancelled}`,
  );

  // Write acknowledgment to PostgreSQL audit trail
  await recordAcknowledgment({
    alert_id: alertId,
    patient_id: patientId,
    acknowledged_by: acknowledgedBy,
    notes,
    details: {
      timer_cancelled: timerCancelled,
      timestamp: new Date().toISOString(),
    },
  });

  // Log cancellation event in audit trail if timer was active
  if (timerCancelled) {
    await recordAuditEvent({
      alert_id: alertId,
      patient_id: patientId,
      event_type: "TIMER_CANCELLED",
      details: {
        reason: "Alert acknowledged by caregiver",
        acknowledged_by: acknowledgedBy,
      },
    });
  }

  return {
    success: true,
    alert_id: alertId,
    timer_cancelled: timerCancelled,
    acknowledged_by: acknowledgedBy,
    message: timerCancelled
      ? `Alert ${alertId} acknowledged. Escalation timer cancelled.`
      : `Alert ${alertId} acknowledged. (No active timer was pending).`,
  };
}

export function getActiveEscalation(alertId: string): ActiveEscalation | undefined {
  return activeEscalations.get(alertId);
}

export function clearAllActiveEscalations(): void {
  for (const esc of activeEscalations.values()) {
    esc.state = "CANCELLED";
    if (esc.step1Timer) {
      clearTimeout(esc.step1Timer);
      esc.step1Timer = null;
    }
    if (esc.step2Timer) {
      clearTimeout(esc.step2Timer);
      esc.step2Timer = null;
    }
  }
  activeEscalations.clear();
}
