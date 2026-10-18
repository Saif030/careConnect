import { randomUUID } from "node:crypto";
import type { Alert, VitalsPacket } from "./types.js";

export function evaluateVitals(packet: VitalsPacket): Alert {
  const contributing_signals: string[] = [];

  if (packet.heart_rate < 50 || packet.heart_rate > 110) {
    contributing_signals.push("heart_rate");
  }
  if (packet.spo2 < 94) {
    contributing_signals.push("spo2");
  }
  if (packet.systolic_bp < 90 || packet.systolic_bp > 160) {
    contributing_signals.push("systolic_bp");
  }
  if (packet.diastolic_bp < 50 || packet.diastolic_bp > 100) {
    contributing_signals.push("diastolic_bp");
  }

  let severity: Alert["severity"] = "GREEN";
  let message = "Vitals within expected range.";
  const instructions: string[] = ["Continue routine monitoring."];
  let triage_level: "P1" | "P2" | "P3" | "P4" = "P4";
  let triage_category: "VITALS" | "COMPOUND" | "DDI" | "CONTRAINDICATION" | "ANOMALY" = "VITALS";

  if (contributing_signals.includes("spo2") || packet.heart_rate > 130 || packet.systolic_bp < 80 || packet.systolic_bp > 180 || packet.heart_rate < 48) {
    severity = "RED";
    triage_level = "P1";

    if (packet.spo2 < 90) {
      message = `Acute Hypoxemia: Peripheral SpO2 acutely depressed at ${packet.spo2}%. Respiratory triage required.`;
    } else if (packet.heart_rate < 50) {
      message = `Profound Bradycardia: Heart rate critically depressed at ${packet.heart_rate} bpm.`;
    } else if (packet.heart_rate > 130) {
      message = `Extreme Tachycardia: Heart rate surging at ${packet.heart_rate} bpm. Critical cardiac strain.`;
    } else if (packet.systolic_bp < 80) {
      message = `Severe Hypotensive Shock: Blood pressure critically low at ${packet.systolic_bp}/${packet.diastolic_bp} mmHg.`;
    } else if (packet.systolic_bp > 180) {
      message = `Hypertensive Emergency: Severe blood pressure elevation (${packet.systolic_bp}/${packet.diastolic_bp} mmHg). Risk of end-organ compromise.`;
    } else {
      message = "Critical vital sign deviation detected. Immediate clinical intervention indicated.";
    }

    instructions.splice(
      0,
      instructions.length,
      "Stay with the patient.",
      "Recheck vitals immediately.",
      "Escalate to a clinician.",
    );
  } else if (contributing_signals.length > 0) {
    severity = "YELLOW";
    triage_level = "P2";
    message = `Borderline Vital Sign Deviation: ${contributing_signals.map(s => s.replace("_", " ").toUpperCase()).join(", ")} outside resting range.`;
    instructions.splice(
      0,
      instructions.length,
      "Have the patient rest for 5 minutes.",
      "Recheck heart rate, SpO2, and blood pressure.",
    );
  }

  return {
    event_id: randomUUID(),
    patient_id: packet.patient_id,
    timestamp: new Date().toISOString(),
    severity,
    type: "VITALS",
    triage_level,
    triage_category,
    message,
    instructions,
    contributing_signals,
  };
}

export function isVitalsPacket(value: unknown): value is VitalsPacket {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.patient_id === "string" &&
    typeof v.timestamp === "string" &&
    typeof v.heart_rate === "number" &&
    typeof v.spo2 === "number" &&
    typeof v.systolic_bp === "number" &&
    typeof v.diastolic_bp === "number"
  );
}
