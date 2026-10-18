import { randomUUID } from "node:crypto";
import { AnomalyEngine, type VitalsBreach, type VitalsDeterioration } from "./anomalyEngine.js";
import { DDIEngine, type ActiveInteraction, type DDIEngineOutput } from "./ddiEngine.js";
import type { Alert, AlertExplanation, AlertSeverity, Medication, VitalsPacket } from "./types.js";

export type DecisionBranch =
  | "VITALS_BREACH_ONLY"
  | "COMPOUND_BREACH"
  | "CRITICAL_INTERACTION_NORMAL_VITALS"
  | "NORMAL";

export interface DashboardCard {
  title: string;
  badge: string;
  description: string;
  severity: AlertSeverity;
  drugs: string[];
  vitals_status: string;
  recommendation: string;
}

export interface PatientRiskState {
  patient_id: string;
  latest_deterioration?: VitalsDeterioration;
  active_critical_interactions: ActiveInteraction[];
  last_evaluated_at: string;
  current_branch: DecisionBranch;
}

export interface FusionResult {
  patient_id: string;
  decision_branch: DecisionBranch;
  alert: Alert | null;
  is_silent: boolean;
  dashboard_card?: DashboardCard;
  anomaly: VitalsDeterioration;
  ddi: DDIEngineOutput;
}

export class FusionEngine {
  private anomalyEngine: AnomalyEngine;
  private ddiEngine: DDIEngine;
  private patientRiskStates = new Map<string, PatientRiskState>();
  private requireSustained: boolean;

  constructor(
    anomalyEngine?: AnomalyEngine,
    ddiEngine?: DDIEngine,
    options?: { requireSustained?: boolean },
  ) {
    this.anomalyEngine = anomalyEngine ?? new AnomalyEngine();
    this.ddiEngine = ddiEngine ?? new DDIEngine();
    this.requireSustained = options?.requireSustained ?? false;
  }

  public getAnomalyEngine(): AnomalyEngine {
    return this.anomalyEngine;
  }

  public getDDIEngine(): DDIEngine {
    return this.ddiEngine;
  }

  public updateMedications(patientId: string, medications: Medication[]): DDIEngineOutput {
    const ddiOutput = this.ddiEngine.evaluateMedications(patientId, medications);
    this.syncRiskState(patientId, undefined, ddiOutput);
    return ddiOutput;
  }

  public processVitals(packet: VitalsPacket, forceTimestampMs?: number): FusionResult {
    const deterioration = this.anomalyEngine.processPacket(packet, forceTimestampMs);
    const ddiOutput =
      this.ddiEngine.getLatestOutput(packet.patient_id) ??
      this.ddiEngine.evaluateMedications(packet.patient_id, []);

    const result = this.fuseRisk(deterioration, ddiOutput);
    this.syncRiskState(packet.patient_id, deterioration, ddiOutput, result.decision_branch);
    return result;
  }

  public evaluate(
    patientId: string,
    vitals?: VitalsPacket,
    medications?: Medication[],
  ): FusionResult {
    const ddiOutput = medications
      ? this.ddiEngine.evaluateMedications(patientId, medications)
      : this.ddiEngine.getLatestOutput(patientId) ??
        this.ddiEngine.evaluateMedications(patientId, []);

    let deterioration: VitalsDeterioration;
    if (vitals) {
      deterioration = this.anomalyEngine.processPacket(vitals);
    } else {
      const latest = this.anomalyEngine.getLatestDeterioration(patientId);
      if (latest) {
        deterioration = latest;
      } else {
        // Fallback default normal packet
        const dummy: VitalsPacket = {
          patient_id: patientId,
          timestamp: new Date().toISOString(),
          heart_rate: 75,
          spo2: 98,
          systolic_bp: 120,
          diastolic_bp: 80,
        };
        deterioration = this.anomalyEngine.processPacket(dummy);
      }
    }

    const result = this.fuseRisk(deterioration, ddiOutput);
    this.syncRiskState(patientId, deterioration, ddiOutput, result.decision_branch);
    return result;
  }

  public getRiskState(patientId: string): PatientRiskState | undefined {
    return this.patientRiskStates.get(patientId);
  }

  public resetPatient(patientId: string): void {
    this.anomalyEngine.resetPatient(patientId);
    this.ddiEngine.resetPatient(patientId);
    this.patientRiskStates.delete(patientId);
  }

  private syncRiskState(
    patientId: string,
    deterioration?: VitalsDeterioration,
    ddiOutput?: DDIEngineOutput,
    currentBranch: DecisionBranch = "NORMAL",
  ): void {
    let existing = this.patientRiskStates.get(patientId);
    if (!existing) {
      existing = {
        patient_id: patientId,
        latest_deterioration: deterioration,
        active_critical_interactions: ddiOutput?.critical_interactions ?? [],
        last_evaluated_at: new Date().toISOString(),
        current_branch: currentBranch,
      };
      this.patientRiskStates.set(patientId, existing);
    } else {
      if (deterioration) existing.latest_deterioration = deterioration;
      if (ddiOutput) existing.active_critical_interactions = ddiOutput.critical_interactions;
      existing.last_evaluated_at = new Date().toISOString();
      existing.current_branch = currentBranch;
    }
  }

  /**
   * Main Decision Fusion Logic
   * 1. Vitals breach only -> standard RED alert
   * 2. Vitals breach AND a critical interaction whose affected_vitals match the breach -> HIGH-PRIORITY COMPOUND ALERT
   * 3. Critical interaction with normal vitals -> stay silent; show only a low-key card on the dashboard
   */
  private fuseRisk(
    deterioration: VitalsDeterioration,
    ddiOutput: DDIEngineOutput,
  ): FusionResult {
    const patientId = deterioration.patient_id;
    const hasBreach = deterioration.has_breach;
    const isActionableBreach = this.requireSustained ? deterioration.is_sustained : hasBreach;

    if (hasBreach && !isActionableBreach) {
      return {
        patient_id: patientId,
        decision_branch: "NORMAL",
        alert: null,
        is_silent: true,
        anomaly: deterioration,
        ddi: ddiOutput,
      };
    }

    const criticalInteractions = ddiOutput.critical_interactions;
    const hasCriticalInteractions = criticalInteractions.length > 0;

    // Check for matching critical interactions whose affected_vitals intersect with deterioration contributing_signals
    const matchingInteractions = hasBreach
      ? criticalInteractions.filter((interaction: ActiveInteraction) =>
          interaction.affected_vitals.some((signal: string) =>
            deterioration.contributing_signals.includes(signal),
          ),
        )
      : [];

    const hasMatchingCompoundInteraction = matchingInteractions.length > 0;

    // -------------------------------------------------------------
    // BRANCH 2: Vitals breach AND matching critical interaction
    // -> HIGH-PRIORITY COMPOUND ALERT
    // -------------------------------------------------------------
    if (hasBreach && hasMatchingCompoundInteraction) {
      const topInteraction = matchingInteractions[0];
      const alert = this.createCompoundAlert(deterioration, topInteraction, ddiOutput.medications);

      return {
        patient_id: patientId,
        decision_branch: "COMPOUND_BREACH",
        alert,
        is_silent: false,
        anomaly: deterioration,
        ddi: ddiOutput,
      };
    }

    // -------------------------------------------------------------
    // BRANCH 1: Vitals breach only (or non-matching interaction)
    // -> Standard RED / YELLOW alert
    // -------------------------------------------------------------
    if (hasBreach) {
      const alert = this.createStandardVitalsAlert(deterioration);

      return {
        patient_id: patientId,
        decision_branch: "VITALS_BREACH_ONLY",
        alert,
        is_silent: false,
        anomaly: deterioration,
        ddi: ddiOutput,
      };
    }

    // -------------------------------------------------------------
    // BRANCH 3: Critical interaction with NORMAL vitals
    // -> Stay silent; show only a low-key card on the dashboard
    // -------------------------------------------------------------
    if (!hasBreach && hasCriticalInteractions) {
      const topInteraction = criticalInteractions[0];
      const dashboardCard: DashboardCard = {
        title: "Monitored Medication Interaction",
        badge: "Low-key Monitoring",
        description: `Patient is actively prescribed ${topInteraction.matched_drugs.join(" and ")}, which may interact (${topInteraction.mechanism}). Vitals currently remain within normal parameters.`,
        severity: "GREEN",
        drugs: topInteraction.matched_drugs,
        vitals_status: "Normal",
        recommendation: "Continue routine observation. No acute emergency response required.",
      };

      // Create a silent, low-key alert object with dashboard_card_only: true
      const silentAlert: Alert = {
        event_id: randomUUID(),
        patient_id: patientId,
        timestamp: new Date().toISOString(),
        severity: "GREEN",
        type: "COMPOUND",
        triage_level: "P4",
        triage_category: "COMPOUND",
        message: `Monitored medication interaction (${topInteraction.matched_drugs.join(" + ")}). Patient vitals are within normal range.`,
        instructions: [
          "Continue routine observation.",
          "Check for non-acute side effects (lightheadedness, mild fatigue).",
        ],
        contributing_signals: [],
        interaction: {
          drugs: topInteraction.matched_drugs,
          mechanism: topInteraction.mechanism,
          clinical_effect: topInteraction.clinical_effect,
          affected_vitals: topInteraction.affected_vitals,
          severity: topInteraction.severity,
        },
        explanation: {
          signals: [],
          duration: "Vitals normal",
          duration_seconds: 0,
          thresholds: {},
          matched_rule: `Monitoring Rule: Active interaction between ${topInteraction.matched_drugs.join(" and ")} noted, but all vital signs are normal.`,
          clinical_rationale: "Precautionary card on dashboard. Emergency alarms stay silent while vitals remain stable.",
          medications: topInteraction.matched_drugs,
          recommendation: "Routine observation only.",
        },
        silent: true,
        dashboard_card_only: true,
      };

      return {
        patient_id: patientId,
        decision_branch: "CRITICAL_INTERACTION_NORMAL_VITALS",
        alert: silentAlert,
        is_silent: true,
        dashboard_card: dashboardCard,
        anomaly: deterioration,
        ddi: ddiOutput,
      };
    }

    // -------------------------------------------------------------
    // ALL NORMAL: Normal vitals & no critical interactions
    // -------------------------------------------------------------
    const normalAlert: Alert = {
      event_id: randomUUID(),
      patient_id: patientId,
      timestamp: new Date().toISOString(),
      severity: "GREEN",
      type: "VITALS",
      triage_level: "P4",
      triage_category: "VITALS",
      message: "Vitals within expected range.",
      instructions: ["Continue routine monitoring."],
      contributing_signals: [],
      silent: true,
    };

    return {
      patient_id: patientId,
      decision_branch: "NORMAL",
      alert: normalAlert,
      is_silent: true,
      anomaly: deterioration,
      ddi: ddiOutput,
    };
  }

  /**
   * Helper: Formats plain-language description of breached vitals
   */
  private describeBreachedVitals(breaches: Record<string, VitalsBreach>): string {
    const parts: string[] = [];

    if (breaches.systolic_bp?.condition === "low" || breaches.diastolic_bp?.condition === "low") {
      parts.push("Low blood pressure");
    } else if (breaches.systolic_bp?.condition === "high" || breaches.diastolic_bp?.condition === "high") {
      parts.push("High blood pressure");
    }

    if (breaches.heart_rate?.condition === "low") {
      parts.push("Low heart rate");
    } else if (breaches.heart_rate?.condition === "high") {
      parts.push("Elevated heart rate");
    }

    if (breaches.spo2?.condition === "low") {
      parts.push("Low oxygen saturation");
    }

    if (parts.length === 0) {
      return "Vital signs outside normal range";
    }

    return parts.join(" and ");
  }

  /**
   * Helper: Formats thresholds object for "Why this alert?" explanation
   */
  private formatThresholdsPayload(
    breaches: Record<string, VitalsBreach>,
  ): AlertExplanation["thresholds"] {
    const result: AlertExplanation["thresholds"] = {};
    for (const [key, b] of Object.entries(breaches)) {
      result[key] = {
        value: b.value,
        threshold: b.threshold,
        condition: b.condition,
      };
    }
    return result;
  }

  /**
   * Creates Branch 2: HIGH-PRIORITY COMPOUND ALERT
   * - Never claim causation; use "possibly related to".
   * - Attach contributing_signals[] and the interaction object to the Alert.
   * - Add explanation payload for "Why this alert?" panel.
   */
  private createCompoundAlert(
    deterioration: VitalsDeterioration,
    interaction: ActiveInteraction,
    medications: Medication[],
  ): Alert {
    const vitalDesc = this.describeBreachedVitals(deterioration.breaches);
    const drugNames = interaction.matched_drugs.join(" and ");

    // Strict rule compliance: Never claim causation; use "possibly related to".
    // Include line such as "Low blood pressure while taking X and Y, which can interact. Show this medication list to the emergency team."
    const message = `${vitalDesc} while taking ${drugNames}, possibly related to ${interaction.mechanism}. Show this medication list to the emergency team.`;

    const durationText = deterioration.duration_seconds > 0
      ? `Sustained for ${deterioration.duration_seconds}s (${deterioration.consecutive_breaches} consecutive readings)`
      : `${deterioration.consecutive_breaches} consecutive readings`;

    const matchedSignals = deterioration.contributing_signals.filter((s) =>
      interaction.affected_vitals.includes(s),
    );

    const explanation: AlertExplanation = {
      signals: deterioration.contributing_signals,
      duration: durationText,
      duration_seconds: deterioration.duration_seconds,
      thresholds: this.formatThresholdsPayload(deterioration.breaches),
      matched_rule: `Compound Risk Rule: Confirmed vitals deterioration in [${matchedSignals.join(", ")}] matched critical drug interaction between [${drugNames}] affecting physiological parameters [${interaction.affected_vitals.join(", ")}].`,
      clinical_rationale: `Active combination of ${drugNames} is associated with ${interaction.clinical_effect} through ${interaction.mechanism}. Patient vitals demonstrate concurrent acute breach in matching parameters. Causation is not claimed, but compound risk requires immediate clinical review.`,
      medications: interaction.matched_drugs,
      recommendation: "Show this medication list to the emergency team immediately. Hold upcoming doses pending clinical evaluation.",
    };

    return {
      event_id: randomUUID(),
      patient_id: deterioration.patient_id,
      timestamp: new Date().toISOString(),
      severity: "RED", // High priority compound alert
      type: "COMPOUND",
      triage_level: "P1",
      triage_category: "COMPOUND",
      message,
      instructions: [
        "Show this medication list to the emergency team.",
        "Stay with the patient and ensure comfortable recumbent or seated posture.",
        "Hold next scheduled dose until clinician review.",
        "Recheck vitals immediately.",
      ],
      contributing_signals: deterioration.contributing_signals,
      interaction: {
        drugs: interaction.matched_drugs,
        mechanism: interaction.mechanism,
        clinical_effect: interaction.clinical_effect,
        affected_vitals: interaction.affected_vitals,
        severity: interaction.severity,
      },
      explanation,
      medications: medications.length > 0 ? medications : interaction.matched_drugs,
      silent: false,
    };
  }

  /**
   * Creates Branch 1: Standard Vitals Alert (Vitals breach only)
   */
  private createStandardVitalsAlert(deterioration: VitalsDeterioration): Alert {
    const vitalDesc = this.describeBreachedVitals(deterioration.breaches);
    const isRed = deterioration.severity === "RED";

    const durationText = deterioration.duration_seconds > 0
      ? `Sustained for ${deterioration.duration_seconds}s (${deterioration.consecutive_breaches} consecutive readings)`
      : `${deterioration.consecutive_breaches} consecutive readings`;

    const explanation: AlertExplanation = {
      signals: deterioration.contributing_signals,
      duration: durationText,
      duration_seconds: deterioration.duration_seconds,
      thresholds: this.formatThresholdsPayload(deterioration.breaches),
      matched_rule: `Vitals Crisis Rule: Sustained deterioration in [${deterioration.contributing_signals.join(", ")}] breached standard clinical thresholds without matching drug interaction.`,
      clinical_rationale: `Physiological parameters crossed critical threshold limits (${deterioration.contributing_signals.join(", ")}).`,
      recommendation: "Stay with the patient and escalate to medical staff immediately.",
    };

    const message = isRed
      ? `Critical vital sign deviation detected: ${vitalDesc}. Immediate clinical attention required.`
      : `One or more vital signs outside resting range: ${vitalDesc}.`;

    const instructions = isRed
      ? [
          "Stay with the patient.",
          "Recheck vitals immediately.",
          "Escalate to a clinician.",
        ]
      : [
          "Have the patient rest for 5 minutes.",
          "Recheck heart rate, SpO2, and blood pressure.",
        ];

    return {
      event_id: randomUUID(),
      patient_id: deterioration.patient_id,
      timestamp: new Date().toISOString(),
      severity: deterioration.severity,
      type: "VITALS",
      triage_level: isRed ? "P1" : "P2",
      triage_category: "VITALS",
      message,
      instructions,
      contributing_signals: deterioration.contributing_signals,
      explanation,
      silent: false,
    };
  }
}

/** Standalone functional helper for risk fusion evaluation */
export function evaluateRiskFusion(
  deterioration: VitalsDeterioration,
  ddiOutput: DDIEngineOutput,
): FusionResult {
  const engine = new FusionEngine();
  // Bypass internal processing to evaluate exact inputs
  return (engine as unknown as { fuseRisk: (det: VitalsDeterioration, ddi: DDIEngineOutput) => FusionResult }).fuseRisk(
    deterioration,
    ddiOutput,
  );
}
