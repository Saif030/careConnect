/** Mirrors docs/contracts.md exactly. */

export interface VitalsPacket {
  patient_id: string;
  timestamp: string;
  heart_rate: number;
  spo2: number;
  systolic_bp: number;
  diastolic_bp: number;
}

export interface Medication {
  drug_name: string;
  generic_name: string;
  form: string;
  strength: string;
  frequency: string;
  timing: string;
  duration_days: number;
  confidence: number;
  rxnorm_id: string;
  safety_notes?: string[];
}

export type AlertSeverity = "GREEN" | "YELLOW" | "RED";

export type AlertType = "VITALS" | "COMPOUND";

export interface Interaction {
  drugs?: string[];
  mechanism?: string;
  clinical_effect?: string;
  affected_vitals?: string[];
  severity?: string;
}

export interface AlertExplanation {
  signals: string[];
  duration: string;
  duration_seconds?: number;
  thresholds: Record<
    string,
    {
      value: number;
      threshold: number | [number, number];
      condition: string;
    }
  >;
  matched_rule: string;
  clinical_rationale?: string;
  medications?: string[];
  recommendation?: string;
}

export interface Alert {
  event_id: string;
  patient_id: string;
  timestamp: string;
  severity: AlertSeverity;
  type: AlertType;
  message: string;
  instructions: string[];
  contributing_signals: string[];
  interaction?: Interaction;
  explanation?: AlertExplanation;
  medications?: Medication[] | string[];
  acknowledged?: boolean;
  acknowledged_at?: string;
  feedback?: "false_alarm" | "real_problem" | "False alarm" | "Real problem";
  feedback_at?: string;
  silent?: boolean;
  dashboard_card_only?: boolean;
  triage_category?: "VITALS" | "COMPOUND" | "DDI" | "CONTRAINDICATION" | "ANOMALY";
  triage_level?: "P1" | "P2" | "P3" | "P4";
  resolved?: boolean;
  resolved_at?: string;
  resolved_by?: string;
  resolution_note?: string;
  resolution_action?: string;
}

