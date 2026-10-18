import type { Alert, ChartPoint, DemoScenario, Medication, Patient, VitalsPacket } from "../types";

export const PATIENTS: Patient[] = [
  {
    id: "pt_001",
    name: "Eleanor Vance",
    age: 74,
    gender: "Female",
    room: "ICU-304B",
    bed: "Bed 01",
    conditions: ["Hypertension Stage 2", "Coronary Artery Disease", "Mild COPD"],
    attendingPhysician: "Dr. Kathryn Vance, MD",
    baseline: {
      heartRate: 72,
      spo2: 98,
      systolicBp: 120,
      diastolicBp: 78,
    },
  },
  {
    id: "pt_002",
    name: "Arthur Pendelton",
    age: 68,
    gender: "Male",
    room: "Ward-210A",
    bed: "Bed 02",
    conditions: ["Post-Op Cardiac Rehab", "Atrial Fibrillation"],
    attendingPhysician: "Dr. Samuel Chen, MD",
    baseline: {
      heartRate: 68,
      spo2: 97,
      systolicBp: 124,
      diastolicBp: 80,
    },
  },
  {
    id: "pt_003",
    name: "Sarah Lin",
    age: 59,
    gender: "Female",
    room: "Stepdown-105C",
    bed: "Bed 01",
    conditions: ["Type 2 Diabetes Mellitus", "Asthma"],
    attendingPhysician: "Dr. Rafael Alvarez, MD",
    baseline: {
      heartRate: 76,
      spo2: 99,
      systolicBp: 118,
      diastolicBp: 75,
    },
  },
];

export const INITIAL_MEDICATIONS: Medication[] = [
  {
    drug_name: "Lipitor",
    generic_name: "atorvastatin",
    form: "tablet",
    strength: "20 mg",
    frequency: "once daily",
    timing: "evening",
    duration_days: 90,
    confidence: 0.94,
    rxnorm_id: "617314",
  },
  {
    drug_name: "Lisinopril",
    generic_name: "lisinopril",
    form: "tablet",
    strength: "10 mg",
    frequency: "once daily",
    timing: "morning",
    duration_days: 30,
    confidence: 0.98,
    rxnorm_id: "29046",
  },
  {
    drug_name: "Norvasc",
    generic_name: "amlodipine",
    form: "tablet",
    strength: "5 mg",
    frequency: "once daily",
    timing: "morning",
    duration_days: 60,
    confidence: 0.91,
    rxnorm_id: "17767",
  },
];

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "normal",
    title: "Resting Baseline",
    subtitle: "Optimal vitals within resting threshold",
    severity: "GREEN",
    vitals: {
      heart_rate: 74,
      spo2: 98.4,
      systolic_bp: 120,
      diastolic_bp: 78,
    },
    clinicalNote: "Patient stable in resting supine position.",
  },
  {
    id: "tachycardia",
    title: "Tachycardia & Strain",
    subtitle: "Heart rate exceeds 110 bpm resting baseline",
    severity: "YELLOW",
    vitals: {
      heart_rate: 118,
      spo2: 96.2,
      systolic_bp: 138,
      diastolic_bp: 88,
    },
    clinicalNote: "Exertion or anxiety spike; caregiver rest protocol recommended.",
  },
  {
    id: "hypoxia",
    title: "Critical Hypoxia Desaturation",
    subtitle: "Peripheral SpO2 drops severely below 90%",
    severity: "RED",
    vitals: {
      heart_rate: 106,
      spo2: 88.5,
      systolic_bp: 114,
      diastolic_bp: 72,
    },
    clinicalNote: "Acute respiratory distress protocol. Titrate oxygen immediately.",
  },
  {
    id: "compound",
    title: "Compound Risk: Dual Hypotension",
    subtitle: "Amlodipine + Lisinopril additive blood pressure crash",
    severity: "RED",
    vitals: {
      heart_rate: 54,
      spo2: 95.0,
      systolic_bp: 82,
      diastolic_bp: 50,
    },
    clinicalNote: "Additive vasodilation from concomitant ACE inhibitor + Calcium channel blocker.",
  },
];

export const INITIAL_ALERTS: Alert[] = [
  {
    event_id: "evt_init_01",
    patient_id: "pt_001",
    timestamp: new Date(Date.now() - 35000).toISOString(),
    severity: "RED",
    type: "VITALS",
    triage_level: "P1",
    triage_category: "VITALS",
    message: "Critical Hypoxemia: Peripheral SpO2 acutely depressed at 87%. Acute respiratory triage.",
    instructions: [
      "Initiate high-flow supplemental oxygen via nasal cannula immediately.",
      "Position patient upright in high Fowler's posture and check airway patency.",
      "Notify Attending Physician and request urgent arterial blood gas evaluation.",
    ],
    contributing_signals: ["spo2", "heart_rate"],
    acknowledged: false,
    explanation: {
      signals: ["spo2"],
      duration: "Acute desaturation (120s)",
      duration_seconds: 120,
      thresholds: {
        spo2: { value: 87, threshold: 92, condition: "low" },
      },
      matched_rule: "Respiratory Protocol Level 1: SpO2 < 90% requires immediate oxygen titration.",
      clinical_rationale: "Hypoxemic tissue perfusion deficit observed. High risk of secondary myocardial strain.",
      recommendation: "Titrate oxygen and auscultate lung fields.",
    },
  },
  {
    event_id: "evt_init_02",
    patient_id: "pt_001",
    timestamp: new Date(Date.now() - 120000).toISOString(),
    severity: "RED",
    type: "COMPOUND",
    triage_level: "P1",
    triage_category: "COMPOUND",
    message: "Compound Vasodilation Shock: Severe hypotension (78/48 mmHg) while active on Lisinopril + Amlodipine.",
    instructions: [
      "Place patient in supine posture with lower extremities elevated.",
      "HOLD next scheduled dose of Lisinopril and Norvasc pending physician review.",
      "Recheck non-invasive blood pressure every 3 minutes.",
    ],
    contributing_signals: ["systolic_bp", "diastolic_bp"],
    acknowledged: true,
    acknowledged_at: new Date(Date.now() - 60000).toISOString(),
    interaction: {
      drugs: ["Lisinopril 10mg", "Norvasc (Amlodipine) 5mg"],
      mechanism: "Additive systemic vascular resistance reduction (ACE-inhibitor + CCB)",
      clinical_effect: "Profound hypotension, risk of syncope and cerebral hypoperfusion",
      affected_vitals: ["systolic_bp", "diastolic_bp"],
    },
  },
  {
    event_id: "evt_init_03",
    patient_id: "pt_001",
    timestamp: new Date(Date.now() - 280000).toISOString(),
    severity: "YELLOW",
    type: "VITALS",
    triage_level: "P2",
    triage_category: "VITALS",
    message: "Sinus Tachycardia Strain: Heart rate elevated at 124 bpm resting. Hemodynamic surge.",
    instructions: [
      "Have patient rest comfortably for 10 minutes in a calm environment.",
      "Obtain stat 12-lead ECG to rule out supraventricular arrhythmia.",
      "Recheck hydration and temperature status.",
    ],
    contributing_signals: ["heart_rate"],
    acknowledged: false,
  },
  {
    event_id: "evt_init_04",
    patient_id: "pt_001",
    timestamp: new Date(Date.now() - 600000).toISOString(),
    severity: "RED",
    type: "VITALS",
    triage_level: "P1",
    triage_category: "VITALS",
    message: "Hypertensive Crisis: Systolic BP 186/110 mmHg. Exceeds critical vascular safety threshold.",
    instructions: [
      "Assess for headache, visual disturbance, or chest tightness.",
      "Stat physician notification for cautious antihypertensive titration.",
    ],
    contributing_signals: ["systolic_bp", "diastolic_bp"],
    acknowledged: true,
    resolved: true,
    resolved_at: new Date(Date.now() - 180000).toISOString(),
    resolved_by: "Dr. Kathryn Vance, MD",
    resolution_action: "Medication Held / Adjusted",
    resolution_note: "Patient administered oral dose and blood pressure normalized to 138/82. Continuous monitoring maintained.",
  },
];

export const SAMPLE_PRESCRIPTIONS = [
  {
    label: "Lipitor 20mg (Atorvastatin)",
    text: "Lipitor (atorvastatin) 20 mg tablet. Take 1 tablet by mouth once daily in the evening for 90 days. High cholesterol management.",
  },
  {
    label: "Lisinopril 10mg (ACE Inhibitor)",
    text: "Lisinopril 10 mg tablet once daily in the morning for hypertension management. Monitor BP closely.",
  },
  {
    label: "Norvasc 5mg (Amlodipine)",
    text: "Norvasc (amlodipine besylate) 5 mg oral tablet once daily in morning for 60 days. Observe for peripheral edema.",
  },
  {
    label: "Metoprolol 50mg (Beta-Blocker)",
    text: "Lopressor (metoprolol tartrate) 50 mg tablet twice daily with food for post-infarct rate stabilization.",
  },
];

export function generateInitialHistory(patientId: string): ChartPoint[] {
  const points: ChartPoint[] = [];
  const now = Date.now();
  const patient = PATIENTS.find((p) => p.id === patientId) ?? PATIENTS[0];

  for (let i = 18; i >= 0; i--) {
    const time = new Date(now - i * 3000);
    const jitter = Math.sin(i * 0.7) * 3;
    points.push({
      timestamp: time.toISOString(),
      timeLabel: time.toLocaleTimeString([], { hour12: false, minute: "2-digit", second: "2-digit" }),
      heart_rate: Math.round((patient.baseline.heartRate + jitter) * 10) / 10,
      spo2: Math.min(100, Math.round((patient.baseline.spo2 - Math.abs(jitter * 0.2)) * 10) / 10),
      systolic_bp: Math.round((patient.baseline.systolicBp + jitter * 1.5) * 10) / 10,
      diastolic_bp: Math.round((patient.baseline.diastolicBp + jitter * 0.8) * 10) / 10,
    });
  }

  return points;
}

export function createInitialPacket(patientId: string): VitalsPacket {
  const patient = PATIENTS.find((p) => p.id === patientId) ?? PATIENTS[0];
  return {
    patient_id: patient.id,
    timestamp: new Date().toISOString(),
    heart_rate: patient.baseline.heartRate,
    spo2: patient.baseline.spo2,
    systolic_bp: patient.baseline.systolicBp,
    diastolic_bp: patient.baseline.diastolicBp,
  };
}
