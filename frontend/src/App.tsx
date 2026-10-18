import React, { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { AlertsFeed } from "./components/AlertsFeed";
import { DemoController } from "./components/DemoController";
import { EmergencyModal } from "./components/EmergencyModal";
import { ActivityIcon, AlertTriangleIcon, CheckCircleIcon, PillIcon, ShieldAlertIcon, XIcon } from "./components/Icons";
import { MedicationsView } from "./components/MedicationsView";
import { Navbar } from "./components/Navbar";
import { PatientHeader } from "./components/PatientHeader";
import { TelemetryChart } from "./components/TelemetryChart";
import { VitalCard } from "./components/VitalCard";
import type { Alert, AlertSeverity, ChartPoint, DemoScenario, Medication, Patient, VitalsPacket } from "./types";
import {
  INITIAL_ALERTS,
  INITIAL_MEDICATIONS,
  PATIENTS,
  createInitialPacket,
  generateInitialHistory,
} from "./utils/mockData";

export default function App() {
  const [activePatient, setActivePatient] = useState<Patient>(PATIENTS[0]);
  const [connected, setConnected] = useState(false);
  const [vitals, setVitals] = useState<VitalsPacket | null>(() => createInitialPacket(PATIENTS[0].id));
  const [vitalsHistory, setVitalsHistory] = useState<ChartPoint[]>(() => generateInitialHistory(PATIENTS[0].id));
  const [alerts, setAlerts] = useState<Alert[]>(INITIAL_ALERTS);
  const [medications, setMedications] = useState<Medication[]>(INITIAL_MEDICATIONS);

  // Navigation & Control States
  const [activeTab, setActiveTab] = useState<"telemetry" | "alerts" | "medications">("telemetry");
  const [demoStudioOpen, setDemoStudioOpen] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isStreamingPaused, setIsStreamingPaused] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [selectedVitalMetric, setSelectedVitalMetric] = useState<"hr" | "spo2" | "sys" | "dia" | null>(null);
  const [criticalAlert, setCriticalAlert] = useState<Alert | null>(null);
  const [isEmergencyModalOpen, setIsEmergencyModalOpen] = useState(false);

  // Toast Notification State
  const [toast, setToast] = useState<{
    id: string;
    title: string;
    message: string;
    severity?: AlertSeverity | "info";
  } | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const autoSimIntervalRef = useRef<number | null>(null);

  const triggerToast = (
    title: string,
    message: string,
    severity: AlertSeverity | "info" = "info",
  ) => {
    const id = String(Date.now());
    setToast({ id, title, message, severity });
    setTimeout(() => {
      setToast((curr) => (curr?.id === id ? null : curr));
    }, 4500);
  };

  const playAudioChime = useCallback((severity: AlertSeverity) => {
    if (!audioEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (severity === "RED") {
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.35);
      } else if (severity === "YELLOW") {
        osc.frequency.setValueAtTime(587.33, ctx.currentTime);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.22);
      }
    } catch {
      // AudioContext blocked by browser autoplay policy before user gesture
    }
  }, [audioEnabled]);

  // Handle incoming vitals packet
  const handleVitalsPacket = useCallback((packet: VitalsPacket) => {
    setVitals(packet);

    if (!isStreamingPaused) {
      const time = new Date(packet.timestamp || Date.now());
      const newPoint: ChartPoint = {
        timestamp: packet.timestamp,
        timeLabel: time.toLocaleTimeString([], { hour12: false, minute: "2-digit", second: "2-digit" }),
        heart_rate: packet.heart_rate,
        spo2: packet.spo2,
        systolic_bp: packet.systolic_bp,
        diastolic_bp: packet.diastolic_bp,
      };

      setVitalsHistory((prev) => [...prev.slice(-35), newPoint]);
    }
  }, [isStreamingPaused]);

  // Handle incoming alert
  const handleAlertPacket = useCallback((alert: Alert) => {
    setAlerts((prev) => {
      // 1. Check by exact event_id
      const idIdx = prev.findIndex((a) => a.event_id === alert.event_id);
      if (idIdx >= 0) {
        const next = [...prev];
        next[idIdx] = {
          ...next[idIdx],
          ...alert,
          // Preserve local resolution and acknowledgment states
          resolved: next[idIdx].resolved || alert.resolved,
          acknowledged: next[idIdx].acknowledged || alert.acknowledged,
          resolved_at: next[idIdx].resolved_at || alert.resolved_at,
          resolved_by: next[idIdx].resolved_by || alert.resolved_by,
          resolution_action: next[idIdx].resolution_action || alert.resolution_action,
          resolution_note: next[idIdx].resolution_note || alert.resolution_note,
        };
        return next;
      }

      // 2. Check for deduplication by patient_id + message
      const msgIdx = prev.findIndex(
        (a) => a.patient_id === alert.patient_id && a.message === alert.message
      );
      if (msgIdx >= 0) {
        const existing = prev[msgIdx];
        if (existing.resolved && (alert.severity === "GREEN" || alert.silent)) {
          return prev;
        }
        const next = [...prev];
        next[msgIdx] = {
          ...next[msgIdx],
          ...alert,
          event_id: existing.event_id,
          resolved: existing.resolved || alert.resolved,
          acknowledged: existing.acknowledged || alert.acknowledged,
        };
        return next;
      }

      // 3. New incoming alert
      return [alert, ...prev].slice(0, 40);
    });

    if (alert.severity === "RED") {
      setCriticalAlert(alert);
      setIsEmergencyModalOpen(true);
    }

    if (alert.severity === "RED" || alert.severity === "YELLOW") {
      playAudioChime(alert.severity);
      triggerToast(
        alert.type === "COMPOUND" ? "⚡ Compound Drug Risk" : `${alert.severity} Clinical Alert`,
        alert.message,
        alert.severity,
      );
    }
  }, [playAudioChime]);

  // Connect socket and fetch initial resources
  useEffect(() => {
    const socket = io({ path: "/socket.io", transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      triggerToast("Socket Connected", "Realtime clinical telemetry stream active", "info");
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("vitals", (packet: VitalsPacket) => {
      handleVitalsPacket(packet);
    });

    socket.on("alert", (alert: Alert) => {
      handleAlertPacket(alert);
    });

    socket.on("alert:critical", (alert: Alert) => {
      setCriticalAlert(alert);
      setIsEmergencyModalOpen(true);
      handleAlertPacket(alert);
    });

    socket.on("alert_updated", (updated: Alert) => {
      setAlerts((prev) => prev.map((a) => (a.event_id === updated.event_id ? updated : a)));
    });

    socket.on("alert:updated", (updated: Alert) => {
      setAlerts((prev) => prev.map((a) => (a.event_id === updated.event_id ? updated : a)));
    });

    socket.on("alert:resolved", (payload: { event_id: string; resolved: boolean; resolved_at: string; resolved_by: string; resolution_action: string; resolution_note?: string }) => {
      setAlerts((prev) =>
        prev.map((a) =>
          a.event_id === payload.event_id
            ? {
                ...a,
                resolved: true,
                resolved_at: payload.resolved_at,
                resolved_by: payload.resolved_by,
                resolution_action: payload.resolution_action,
                resolution_note: payload.resolution_note,
                acknowledged: true,
              }
            : a
        )
      );
    });

    socket.on("medications", (payload: { patient_id: string; medications: Medication[] }) => {
      if (payload.patient_id === activePatient.id && Array.isArray(payload.medications)) {
        setMedications(payload.medications);
      }
    });

    // Fetch alerts from backend
    void fetch("/alerts")
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: Alert[]) => {
        if (Array.isArray(rows) && rows.length > 0) {
          setAlerts(rows.slice().reverse().slice(0, 30));
        }
      })
      .catch(() => undefined);

    // Fetch medications from backend
    void fetch(`/medications/${activePatient.id}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((list: Medication[]) => {
        if (Array.isArray(list) && list.length > 0) {
          setMedications(list);
        }
      })
      .catch(() => undefined);

    return () => {
      socket.close();
    };
  }, [activePatient.id, handleVitalsPacket, handleAlertPacket]);

  // Patient Switcher
  const handleSelectPatient = (patient: Patient) => {
    setActivePatient(patient);
    setVitals(createInitialPacket(patient.id));
    setVitalsHistory(generateInitialHistory(patient.id));
    triggerToast("Patient Switched", `Switched to ${patient.name} (${patient.room})`, "info");

    void fetch(`/medications/${patient.id}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((list: Medication[]) => {
        if (Array.isArray(list) && list.length > 0) {
          setMedications(list);
        } else {
          setMedications(INITIAL_MEDICATIONS);
        }
      })
      .catch(() => {
        setMedications(INITIAL_MEDICATIONS);
      });
  };

  // Evaluate packet locally as resilient fallback covering multiple clinical categories
  const evaluatePacketFallback = (packet: VitalsPacket): Alert => {
    const signals: string[] = [];
    if (packet.heart_rate < 50 || packet.heart_rate > 110) signals.push("heart_rate");
    if (packet.spo2 < 94) signals.push("spo2");
    if (packet.systolic_bp < 90 || packet.systolic_bp > 160) signals.push("systolic_bp");
    if (packet.diastolic_bp < 50 || packet.diastolic_bp > 100) signals.push("diastolic_bp");

    const now = packet.timestamp || new Date().toISOString();
    const eventId = `evt_sim_${Date.now()}`;

    // Inspect active patient medications for pharmacodynamic correlations
    const medNames = medications.map((m) => (m.drug_name || m.generic_name || "").toLowerCase());
    const hasAntihypertensives = medNames.some(
      (m) =>
        m.includes("lisinopril") ||
        m.includes("amlodipine") ||
        m.includes("losartan") ||
        m.includes("ramipril") ||
        m.includes("norvasc"),
    );
    const hasBetaBlockers = medNames.some(
      (m) =>
        m.includes("metoprolol") ||
        m.includes("atenolol") ||
        m.includes("carvedilol") ||
        m.includes("propranolol"),
    );

    // 1. Critical Hypoxia / Acute Respiratory Distress (P1)
    if (packet.spo2 < 90) {
      return {
        event_id: eventId,
        patient_id: packet.patient_id,
        timestamp: now,
        severity: "RED",
        type: "VITALS",
        triage_level: "P1",
        triage_category: "VITALS",
        message: `Acute Hypoxemic Desaturation: SpO2 critically low at ${packet.spo2}%. Respiratory triage required.`,
        instructions: [
          "Initiate supplemental high-flow O2 via nasal cannula or mask immediately.",
          "Place patient in upright high Fowler's position and clear airway.",
          "Notify Attending Physician; prepare stat arterial blood gas analysis.",
        ],
        contributing_signals: ["spo2", ...(packet.heart_rate > 110 ? ["heart_rate"] : [])],
        explanation: {
          signals: ["spo2"],
          duration: "Acute desaturation",
          duration_seconds: 60,
          thresholds: {
            spo2: { value: packet.spo2, threshold: 92, condition: "low" },
          },
          matched_rule: "Respiratory Emergency: Peripheral SpO2 below 90% indicates severe hypoxemia.",
          clinical_rationale: "Hypoxemic tissue perfusion deficit observed with secondary cardiac strain risk.",
          recommendation: "Immediate oxygen titration and pulmonary auscultation.",
        },
      };
    }

    // 2. Severe Bradycardia with Drug-Vital Contraindication check (P1)
    if (packet.heart_rate < 50) {
      const isContraindicated = hasBetaBlockers;
      return {
        event_id: eventId,
        patient_id: packet.patient_id,
        timestamp: now,
        severity: "RED",
        type: isContraindicated ? "COMPOUND" : "VITALS",
        triage_level: "P1",
        triage_category: isContraindicated ? "CONTRAINDICATION" : "VITALS",
        message: isContraindicated
          ? `Drug-Vital Contraindication: Severe Bradycardia (${packet.heart_rate} bpm) while active on Beta-Blocker therapy.`
          : `Profound Bradycardia: Heart rate critically depressed at ${packet.heart_rate} bpm.`,
        instructions: [
          isContraindicated
            ? "HOLD all scheduled beta-blocker and rate-limiting doses immediately."
            : "Verify peripheral pulse volume and initiate continuous 12-lead ECG monitor.",
          "Check patient responsiveness, mental clarity, and orthostatic symptoms.",
          "Prepare bedside atropine 0.5mg IV if hemodynamically compromised.",
        ],
        contributing_signals: ["heart_rate", ...(packet.systolic_bp < 90 ? ["systolic_bp"] : [])],
        interaction: isContraindicated
          ? {
              drugs: medications
                .filter(
                  (m) =>
                    (m.drug_name || m.generic_name).toLowerCase().includes("metoprolol") ||
                    (m.drug_name || m.generic_name).toLowerCase().includes("atenolol"),
                )
                .map((m) => m.drug_name),
              mechanism: "Negative chronotropic blockade exacerbating severe sinus bradycardia",
              clinical_effect: "Conduction block, cerebral hypoperfusion, syncope risk",
              affected_vitals: ["heart_rate", "systolic_bp"],
            }
          : undefined,
      };
    }

    // 3. Extreme Tachycardia (P1)
    if (packet.heart_rate > 130) {
      return {
        event_id: eventId,
        patient_id: packet.patient_id,
        timestamp: now,
        severity: "RED",
        type: "VITALS",
        triage_level: "P1",
        triage_category: "VITALS",
        message: `Extreme Tachycardia: Heart rate surging at ${packet.heart_rate} bpm. Hemodynamic strain.`,
        instructions: [
          "Obtain immediate 12-lead ECG to differentiate sinus tachycardia from supraventricular arrhythmia.",
          "Assess for underlying triggers: sepsis, hypovolemia, pulmonary embolism, or fever.",
          "Notify provider for urgent bedside evaluation and rate control.",
        ],
        contributing_signals: ["heart_rate"],
      };
    }

    // 4. Hypotensive Crisis / Compound Shock (P1)
    if (packet.systolic_bp < 85 && packet.diastolic_bp < 55) {
      const isCompound = hasAntihypertensives;
      return {
        event_id: eventId,
        patient_id: packet.patient_id,
        timestamp: now,
        severity: "RED",
        type: isCompound ? "COMPOUND" : "VITALS",
        triage_level: "P1",
        triage_category: isCompound ? "COMPOUND" : "VITALS",
        message: isCompound
          ? `Compound Hemodynamic Crash: Severe Hypotension (${packet.systolic_bp}/${packet.diastolic_bp} mmHg) with active vasodilatory regimen.`
          : `Acute Hypotensive Shock: Blood pressure collapsed to ${packet.systolic_bp}/${packet.diastolic_bp} mmHg.`,
        instructions: [
          "Place patient in Trendelenburg / supine position with lower extremities elevated.",
          isCompound
            ? "HOLD next dose of all antihypertensive and vasodilator medications."
            : "Initiate rapid crystalloid IV fluid bolus if clinically indicated.",
          "Recheck automated non-invasive BP every 3 minutes.",
        ],
        contributing_signals: ["systolic_bp", "diastolic_bp"],
        interaction: isCompound
          ? {
              drugs: medications
                .filter(
                  (m) =>
                    (m.drug_name || m.generic_name).toLowerCase().includes("lisinopril") ||
                    (m.drug_name || m.generic_name).toLowerCase().includes("amlodipine") ||
                    (m.drug_name || m.generic_name).toLowerCase().includes("norvasc"),
                )
                .map((m) => m.drug_name),
              mechanism: "Additive systemic vascular resistance reduction and arterial vasodilation",
              clinical_effect: "Severe hypoperfusion, orthostatic syncope, circulatory collapse",
              affected_vitals: ["systolic_bp", "diastolic_bp"],
            }
          : undefined,
      };
    }

    // 5. Hypertensive Crisis (P1)
    if (packet.systolic_bp > 180 || packet.diastolic_bp > 110) {
      return {
        event_id: eventId,
        patient_id: packet.patient_id,
        timestamp: now,
        severity: "RED",
        type: "VITALS",
        triage_level: "P1",
        triage_category: "VITALS",
        message: `Hypertensive Emergency: Severe blood pressure elevation (${packet.systolic_bp}/${packet.diastolic_bp} mmHg). Risk of end-organ compromise.`,
        instructions: [
          "Assess immediately for end-organ signs: acute headache, visual disturbance, chest pain, or dyspnea.",
          "Maintain calm resting environment and repeat manual blood pressure measurement.",
          "Stat physician notification for cautious intravenous antihypertensive titration.",
        ],
        contributing_signals: ["systolic_bp", "diastolic_bp"],
      };
    }

    // 6. Borderline / Warning Deviations (P2/P3)
    if (signals.length > 0) {
      return {
        event_id: eventId,
        patient_id: packet.patient_id,
        timestamp: now,
        severity: "YELLOW",
        type: "VITALS",
        triage_level: "P2",
        triage_category: "VITALS",
        message: `Borderline Vital Sign Deviation: ${signals.map((s) => s.replace("_", " ").toUpperCase()).join(", ")} outside resting threshold.`,
        instructions: [
          "Have the patient rest in bed for 5-10 minutes.",
          "Recheck heart rate, SpO2, and blood pressure to rule out movement artifact.",
          "Document telemetry trend in nursing flow sheet.",
        ],
        contributing_signals: signals,
      };
    }

    // 7. Stable Routine Baseline (P4)
    return {
      event_id: eventId,
      patient_id: packet.patient_id,
      timestamp: now,
      severity: "GREEN",
      type: "VITALS",
      triage_level: "P4",
      triage_category: "VITALS",
      message: "Vitals within expected physiological baseline.",
      instructions: ["Continue scheduled routine telemetry monitoring."],
      contributing_signals: [],
    };
  };

  // Inject a complete scenario
  const handleInjectScenario = (scenario: DemoScenario) => {
    const packet: VitalsPacket = {
      patient_id: activePatient.id,
      timestamp: new Date().toISOString(),
      ...scenario.vitals,
    };

    // Try posting to backend
    fetch("/vitals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(packet),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Backend offline");
      })
      .catch(() => {
        // Fallback local simulation
        handleVitalsPacket(packet);
        const alert = evaluatePacketFallback(packet);
        handleAlertPacket(alert);
      });

    triggerToast(
      `Injected: ${scenario.title}`,
      scenario.clinicalNote,
      scenario.severity,
    );
  };

  // Inject custom vitals from sliders
  const handleInjectCustomVitals = (v: Omit<VitalsPacket, "patient_id" | "timestamp">) => {
    const packet: VitalsPacket = {
      patient_id: activePatient.id,
      timestamp: new Date().toISOString(),
      ...v,
    };

    fetch("/vitals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(packet),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Backend offline");
      })
      .catch(() => {
        handleVitalsPacket(packet);
        const alert = evaluatePacketFallback(packet);
        handleAlertPacket(alert);
      });

    triggerToast("Custom Packet Injected", `HR: ${v.heart_rate} · SpO2: ${v.spo2}% · BP: ${v.systolic_bp}/${v.diastolic_bp}`, "info");
  };

  // Auto-Simulation streaming loop
  const handleToggleSimulating = () => {
    if (isSimulating) {
      if (autoSimIntervalRef.current) clearInterval(autoSimIntervalRef.current);
      autoSimIntervalRef.current = null;
      setIsSimulating(false);
      triggerToast("Simulation Stopped", "Auto telemetry stream paused", "info");
    } else {
      setIsSimulating(true);
      triggerToast("Simulation Active", "Streaming physiological vitals every 2.5s", "info");

      autoSimIntervalRef.current = window.setInterval(() => {
        const jitter = Math.sin(Date.now() / 4000) * 4;
        const packet: VitalsPacket = {
          patient_id: activePatient.id,
          timestamp: new Date().toISOString(),
          heart_rate: Math.round((activePatient.baseline.heartRate + jitter) * 10) / 10,
          spo2: Math.min(100, Math.round((activePatient.baseline.spo2 - Math.abs(jitter * 0.15)) * 10) / 10),
          systolic_bp: Math.round((activePatient.baseline.systolicBp + jitter * 1.6) * 10) / 10,
          diastolic_bp: Math.round((activePatient.baseline.diastolicBp + jitter * 0.8) * 10) / 10,
        };

        fetch("/vitals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(packet),
        }).catch(() => {
          handleVitalsPacket(packet);
        });
      }, 2500);
    }
  };

  useEffect(() => {
    return () => {
      if (autoSimIntervalRef.current) clearInterval(autoSimIntervalRef.current);
    };
  }, []);

  // Alert Actions
  const handleAcknowledgeAlert = async (eventId: string): Promise<void> => {
    try {
      await fetch(`/alerts/${eventId}/acknowledge`, { method: "POST" });
      await fetch(`/api/alerts/${eventId}/ack`, { method: "POST" }).catch(() => undefined);
    } catch {
      // Offline fallback
    }
    setAlerts((prev) =>
      prev.map((a) => (a.event_id === eventId ? { ...a, acknowledged: true } : a)),
    );
    triggerToast("Alert Acknowledged", "Clinical record updated with caregiver review timestamp", "info");
  };

  const handleAlertFeedback = (eventId: string, feedback: "false_alarm" | "real_problem") => {
    fetch(`/alerts/${eventId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback }),
    }).catch(() => undefined);

    setAlerts((prev) =>
      prev.map((a) => (a.event_id === eventId ? { ...a, feedback } : a)),
    );
    triggerToast("Triage Feedback Logged", `Marked event as ${feedback === "real_problem" ? "Real Incident" : "False Alarm"}`, "info");
  };

  const handleEscalateAlert = (alert: Alert) => {
    setCriticalAlert(alert);
    setIsEmergencyModalOpen(true);
    triggerToast(
      "Emergency Protocol Activated",
      `Emergency takeover activated for ${alert.message}`,
      "critical",
    );
  };

  const handleResolveAlert = async (
    eventId: string,
    resolution: { action: string; note: string; clinician: string }
  ) => {
    try {
      await fetch(`/alerts/${eventId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resolution),
      });
      await fetch(`/api/alerts/${eventId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resolution),
      }).catch(() => undefined);
    } catch {
      // offline fallback
    }

    const now = new Date().toISOString();
    setAlerts((prev) =>
      prev.map((a) =>
        a.event_id === eventId
          ? {
              ...a,
              resolved: true,
              resolved_at: now,
              resolved_by: resolution.clinician,
              resolution_action: resolution.action,
              resolution_note: resolution.note,
              acknowledged: true,
            }
          : a
      )
    );

    triggerToast(
      "Alert Triage Resolved",
      `${resolution.action} logged by ${resolution.clinician}`,
      "info"
    );
  };

  const handleAddMedication = (med: Medication) => {
    const updated = [med, ...medications];
    setMedications(updated);

    fetch(`/medications/${activePatient.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    }).catch(() => undefined);

    triggerToast("Medication Prescribed", `Added ${med.drug_name} (${med.strength}) to chart`, "info");
  };

  // Sparkline history extraction for each vital card
  const hrHistory = vitalsHistory.map((p) => p.heart_rate);
  const spo2History = vitalsHistory.map((p) => p.spo2);
  const sysHistory = vitalsHistory.map((p) => p.systolic_bp);
  const diaHistory = vitalsHistory.map((p) => p.diastolic_bp);

  // Latest alert severity
  const latestSeverity: AlertSeverity = alerts[0]?.severity ?? "GREEN";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Top Navbar */}
      <Navbar
        connected={connected}
        activePatient={activePatient}
        onSelectPatient={handleSelectPatient}
        audioEnabled={audioEnabled}
        onToggleAudio={() => setAudioEnabled(!audioEnabled)}
        demoStudioOpen={demoStudioOpen}
        onToggleDemoStudio={() => setDemoStudioOpen(!demoStudioOpen)}
        isSimulating={isSimulating}
      />

      {/* Main Container */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Hackathon Demo Studio Drawer */}
        <DemoController
          isOpen={demoStudioOpen}
          onClose={() => setDemoStudioOpen(false)}
          onInjectScenario={handleInjectScenario}
          onInjectCustomVitals={handleInjectCustomVitals}
          isSimulating={isSimulating}
          onToggleSimulating={handleToggleSimulating}
        />

        {/* Patient Profile Card */}
        <PatientHeader
          patient={activePatient}
          vitals={vitals}
          latestSeverity={latestSeverity}
          lastUpdatedTime={vitals ? new Date(vitals.timestamp).toLocaleTimeString() : null}
        />

        {/* Navigation Tabs Bar */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex rounded-xl border border-slate-800 bg-slate-900/90 p-1 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab("telemetry")}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-bold transition-all ${
                activeTab === "telemetry"
                  ? "bg-cyan-500/20 text-cyan-300 shadow-sm ring-1 ring-cyan-500/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <ActivityIcon className="h-3.5 w-3.5" />
              <span>Live Telemetry & Vitals</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("alerts")}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-bold transition-all ${
                activeTab === "alerts"
                  ? "bg-rose-500/20 text-rose-300 shadow-sm ring-1 ring-rose-500/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <ShieldAlertIcon className="h-3.5 w-3.5" />
              <span>Clinical Alerts & Triage</span>
              {alerts.filter((a) => !a.acknowledged && a.severity !== "GREEN").length > 0 && (
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                  {alerts.filter((a) => !a.acknowledged && a.severity !== "GREEN").length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("medications")}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-bold transition-all ${
                activeTab === "medications"
                  ? "bg-emerald-500/20 text-emerald-300 shadow-sm ring-1 ring-emerald-500/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <PillIcon className="h-3.5 w-3.5" />
              <span>Medications & AI Ingestion</span>
              <span className="rounded bg-slate-800 px-1.5 py-0.2 text-[10px] text-slate-300">
                {medications.length}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {!demoStudioOpen && (
              <button
                type="button"
                onClick={() => setDemoStudioOpen(true)}
                className="flex items-center gap-1.5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/20"
              >
                <span>⚡ Quick Scenarios</span>
              </button>
            )}
          </div>
        </div>

        {/* Tab Content */}
        <div className="mt-6">
          {activeTab === "telemetry" && (
            <div className="space-y-6">
              {/* 4 Live Vitals Cards Matrix */}
              <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <VitalCard
                  id="hr"
                  label="Heart Rate"
                  value={vitals?.heart_rate}
                  unit="bpm"
                  normalMin={60}
                  normalMax={100}
                  history={hrHistory}
                  selected={selectedVitalMetric === "hr"}
                  onClick={() =>
                    setSelectedVitalMetric(selectedVitalMetric === "hr" ? null : "hr")
                  }
                />
                <VitalCard
                  id="spo2"
                  label="Oxygen Saturation"
                  value={vitals?.spo2}
                  unit="%"
                  normalMin={95}
                  normalMax={100}
                  history={spo2History}
                  selected={selectedVitalMetric === "spo2"}
                  onClick={() =>
                    setSelectedVitalMetric(selectedVitalMetric === "spo2" ? null : "spo2")
                  }
                />
                <VitalCard
                  id="sys"
                  label="Systolic BP"
                  value={vitals?.systolic_bp}
                  unit="mmHg"
                  normalMin={90}
                  normalMax={130}
                  history={sysHistory}
                  selected={selectedVitalMetric === "sys"}
                  onClick={() =>
                    setSelectedVitalMetric(selectedVitalMetric === "sys" ? null : "sys")
                  }
                />
                <VitalCard
                  id="dia"
                  label="Diastolic BP"
                  value={vitals?.diastolic_bp}
                  unit="mmHg"
                  normalMin={60}
                  normalMax={85}
                  history={diaHistory}
                  selected={selectedVitalMetric === "dia"}
                  onClick={() =>
                    setSelectedVitalMetric(selectedVitalMetric === "dia" ? null : "dia")
                  }
                />
              </section>

              {/* Real-Time Waveform & Trend Telemetry Chart */}
              <TelemetryChart
                data={vitalsHistory}
                isStreamingPaused={isStreamingPaused}
                onToggleStreaming={() => setIsStreamingPaused(!isStreamingPaused)}
                onClearData={() => setVitalsHistory([])}
              />

              {/* Quick Alerts Snapshot */}
              <AlertsFeed
                alerts={alerts.slice(0, 5)}
                onAcknowledgeAlert={handleAcknowledgeAlert}
                onAlertFeedback={handleAlertFeedback}
                onEscalateAlert={handleEscalateAlert}
                onResolveAlert={handleResolveAlert}
              />
            </div>
          )}

          {activeTab === "alerts" && (
            <AlertsFeed
              alerts={alerts}
              onAcknowledgeAlert={handleAcknowledgeAlert}
              onAlertFeedback={handleAlertFeedback}
              onEscalateAlert={handleEscalateAlert}
              onResolveAlert={handleResolveAlert}
            />
          )}

          {activeTab === "medications" && (
            <MedicationsView
              patient={activePatient}
              medications={medications}
              onAddMedication={handleAddMedication}
            />
          )}
        </div>
      </main>

      {/* Floating Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex max-w-md items-start gap-3 rounded-2xl border border-slate-700/80 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-5">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-1 ${
              toast.severity === "RED" || toast.severity === "critical"
                ? "bg-rose-500/20 text-rose-400 ring-rose-500/40"
                : toast.severity === "YELLOW"
                  ? "bg-amber-500/20 text-amber-400 ring-amber-500/40"
                  : "bg-cyan-500/20 text-cyan-400 ring-cyan-500/40"
            }`}
          >
            {toast.severity === "RED" || toast.severity === "critical" ? (
              <ShieldAlertIcon className="h-4 w-4" />
            ) : toast.severity === "YELLOW" ? (
              <AlertTriangleIcon className="h-4 w-4" />
            ) : (
              <CheckCircleIcon className="h-4 w-4" />
            )}
          </div>

          <div className="flex-1">
            <div className="text-xs font-bold text-white tracking-tight">{toast.title}</div>
            <p className="mt-0.5 text-xs text-slate-300 leading-snug">{toast.message}</p>
          </div>

          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-slate-400 hover:text-white"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Full-Screen Emergency Modal with Compound Risk Badge, Medication List & Why Panel */}
      <EmergencyModal
        alert={criticalAlert}
        isOpen={isEmergencyModalOpen}
        onAcknowledge={handleAcknowledgeAlert}
        onClose={() => setIsEmergencyModalOpen(false)}
        medications={medications}
      />
    </div>
  );
}
