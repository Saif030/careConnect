import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Alert, Medication } from "./types.js";

export type InteractionSeverity = "MINOR" | "MODERATE" | "CRITICAL";

export interface DdiRule {
  drug_a: string;
  drug_b: string;
  severity: InteractionSeverity;
  mechanism: string;
  clinical_effect: string;
  caregiver_warning: string;
  affected_vitals: string[];
}

export interface DetectedInteraction {
  rule: DdiRule;
  medication_a: Medication;
  medication_b: Medication;
  matched_drugs: [string, string];
  severity: InteractionSeverity;
  mechanism: string;
  clinical_effect: string;
  caregiver_warning: string;
  affected_vitals: string[];
}

export interface UnverifiedMedicationWarning {
  patient_id: string;
  drug_name: string;
  generic_name: string;
  reason: string;
  warning: "Unverified Medication - Manual Review Required";
}

export interface DdiAnalysisResult {
  patient_id: string;
  medications: Medication[];
  total_medications: number;
  pairs_evaluated: number;
  interactions: DetectedInteraction[];
  critical_interactions: DetectedInteraction[];
  moderate_interactions: DetectedInteraction[];
  minor_interactions: DetectedInteraction[];
  critical_alert: Alert | null;
  unverified_medications: UnverifiedMedicationWarning[];
  disclaimer: "Decision support only. Consult a pharmacist or doctor.";
}

export const DISCLAIMER = "Decision support only. Consult a pharmacist or doctor.";

// Common Brand to Generic mappings
export const BRAND_TO_GENERIC: Record<string, string> = {
  advil: "ibuprofen",
  motrin: "ibuprofen",
  crocin: "paracetamol",
  calpol: "paracetamol",
  tylenol: "paracetamol",
  acetaminophen: "paracetamol",
  coumadin: "warfarin",
  jantoven: "warfarin",
  aldactone: "spironolactone",
  zestril: "lisinopril",
  prinivil: "lisinopril",
  prozac: "fluoxetine",
  zoloft: "sertraline",
  ultram: "tramadol",
  viagra: "sildenafil",
  revatio: "sildenafil",
  cialis: "tadalafil",
  adcirca: "tadalafil",
  nitrostat: "nitroglycerin",
  nitrolingual: "nitroglycerin",
  lanoxin: "digoxin",
  cordarone: "amiodarone",
  pacerone: "amiodarone",
  lipitor: "atorvastatin",
  glucophage: "metformin",
  plavix: "clopidogrel",
  norvasc: "amlodipine",
  lasix: "furosemide",
  augmentin: "amoxicillin and clavulanate potassium",
  zithromax: "azithromycin",
  cipro: "ciprofloxacin",
  crestor: "rosuvastatin",
  synthroid: "levothyroxine",
};

// Drug synonym aliases (e.g. acetaminophen <-> paracetamol)
export const DRUG_ALIASES: Record<string, string[]> = {
  paracetamol: ["acetaminophen"],
  acetaminophen: ["paracetamol"],
};

let curatedRulesCache: DdiRule[] | null = null;

export function loadCuratedInteractions(): DdiRule[] {
  if (curatedRulesCache) {
    return curatedRulesCache;
  }
  const filePath = path.resolve(__dirname, "../data/interactions.json");
  if (!fs.existsSync(filePath)) {
    console.warn(`[DDI Engine] Curated interactions file not found at ${filePath}.`);
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    curatedRulesCache = JSON.parse(raw) as DdiRule[];
    return curatedRulesCache;
  } catch (err) {
    console.error("[DDI Engine] Failed to parse interactions.json:", err);
    return [];
  }
}

/**
 * Resolves a medication to its canonical lowercase generic name.
 */
export function normalizeDrugName(med: Medication): string {
  const generic = med.generic_name ? med.generic_name.trim().toLowerCase() : "";
  const brand = med.drug_name ? med.drug_name.trim().toLowerCase() : "";

  // 1. Direct brand mapping
  if (brand && BRAND_TO_GENERIC[brand]) {
    return BRAND_TO_GENERIC[brand];
  }
  if (generic && BRAND_TO_GENERIC[generic]) {
    return BRAND_TO_GENERIC[generic];
  }

  // 2. Generic name fallback
  if (generic) {
    return generic;
  }

  // 3. Brand name fallback
  return brand;
}

/**
 * Generates all unique unordered pairs: n(n - 1) / 2
 */
export function generateMedicationPairs<T>(items: T[]): Array<[T, T]> {
  const pairs: Array<[T, T]> = [];
  const n = items.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      pairs.push([items[i], items[j]]);
    }
  }
  return pairs;
}

/**
 * Evaluates whether two drug names match a DDI rule (symmetrically and with aliases).
 */
export function matchesDdiRule(drug1: string, drug2: string, rule: DdiRule): boolean {
  const rA = rule.drug_a.toLowerCase();
  const rB = rule.drug_b.toLowerCase();

  const names1 = [drug1, ...(DRUG_ALIASES[drug1] || [])];
  const names2 = [drug2, ...(DRUG_ALIASES[drug2] || [])];

  for (const n1 of names1) {
    for (const n2 of names2) {
      if ((n1 === rA && n2 === rB) || (n1 === rB && n2 === rA)) {
        return true;
      }
      // Substring/class matching (e.g. "lisinopril" matches "lisinopril")
      if (
        (n1.includes(rA) && n2.includes(rB)) ||
        (n1.includes(rB) && n2.includes(rA))
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Analyzes active medications for drug-drug interactions.
 * - Generates all unique pairs: n(n-1)/2
 * - Identifies MINOR, MODERATE, and CRITICAL interactions
 * - Emits a COMPOUND Alert only for CRITICAL interactions
 * - Flags unverified medications without breaking the run
 * - Includes mandatory medical disclaimer
 */
export function analyzeDrugInteractions(
  patientId: string,
  medications: Medication[],
  customRules?: DdiRule[],
): DdiAnalysisResult {
  const rules = customRules || loadCuratedInteractions();
  const unverified: UnverifiedMedicationWarning[] = [];
  const validMeds: Medication[] = [];

  // 1. Validate & identify unverified medications
  for (const med of medications) {
    const rawName = (med.drug_name || med.generic_name || "").trim().toLowerCase();
    const isUnknown =
      !rawName ||
      rawName === "unknown" ||
      rawName === "uncertain" ||
      rawName.includes("???") ||
      rawName.includes("illegible") ||
      med.confidence < 0.4;

    if (isUnknown) {
      unverified.push({
        patient_id: patientId,
        drug_name: med.drug_name || "Unknown",
        generic_name: med.generic_name || "",
        reason: `Medication could not be verified (confidence: ${med.confidence.toFixed(2)})`,
        warning: "Unverified Medication - Manual Review Required",
      });
    } else {
      validMeds.push(med);
    }
  }

  // 2. Generate unique pairs: n(n - 1) / 2
  const pairs = generateMedicationPairs(validMeds);
  const detectedInteractions: DetectedInteraction[] = [];

  for (const [medA, medB] of pairs) {
    const nameA = normalizeDrugName(medA);
    const nameB = normalizeDrugName(medB);

    for (const rule of rules) {
      if (matchesDdiRule(nameA, nameB, rule)) {
        detectedInteractions.push({
          rule,
          medication_a: medA,
          medication_b: medB,
          matched_drugs: [
            medA.drug_name || medA.generic_name || nameA,
            medB.drug_name || medB.generic_name || nameB,
          ],
          severity: rule.severity,
          mechanism: rule.mechanism,
          clinical_effect: rule.clinical_effect,
          caregiver_warning: rule.caregiver_warning,
          affected_vitals: rule.affected_vitals,
        });
        break; // Match found for this pair in this rule
      }
    }
  }

  // 3. Filter by severity
  const criticalInteractions = detectedInteractions.filter(
    (i) => i.severity === "CRITICAL",
  );
  const moderateInteractions = detectedInteractions.filter(
    (i) => i.severity === "MODERATE",
  );
  const minorInteractions = detectedInteractions.filter(
    (i) => i.severity === "MINOR",
  );

  // Silently log non-critical interactions
  for (const mod of moderateInteractions) {
    console.log(
      `[DDI Engine][MODERATE] Patient ${patientId}: ${mod.medication_a.drug_name} + ${mod.medication_b.drug_name} (${mod.rule.mechanism})`,
    );
  }
  for (const min of minorInteractions) {
    console.log(
      `[DDI Engine][MINOR] Patient ${patientId}: ${min.medication_a.drug_name} + ${min.medication_b.drug_name} (${min.rule.mechanism})`,
    );
  }

  // 4. Generate Alert ONLY for CRITICAL interactions
  let criticalAlert: Alert | null = null;
  if (criticalInteractions.length > 0) {
    const topCritical = criticalInteractions[0];
    const affectedVitals = Array.from(
      new Set(criticalInteractions.flatMap((i) => i.affected_vitals)),
    );

    criticalAlert = {
      event_id: `evt_ddi_${randomUUID().slice(0, 8)}`,
      patient_id: patientId,
      timestamp: new Date().toISOString(),
      severity: "RED",
      type: "COMPOUND",
      triage_level: "P1",
      triage_category: "DDI",
      message: `CRITICAL DRUG INTERACTION: ${topCritical.caregiver_warning}`,
      instructions: [
        "Do NOT administer the interacting medications together.",
        "Contact the prescribing physician or clinical pharmacist immediately.",
        `Monitor patient for: ${affectedVitals.join(", ")}.`,
      ],
      contributing_signals: affectedVitals,
      interaction: {
        drugs: [
          topCritical.medication_a.drug_name || topCritical.medication_a.generic_name,
          topCritical.medication_b.drug_name || topCritical.medication_b.generic_name,
        ],
        mechanism: topCritical.rule.mechanism,
        clinical_effect: topCritical.rule.clinical_effect,
      },
    };

    console.warn(
      `[DDI Engine][CRITICAL ALERT] Patient ${patientId}: Generated RED COMPOUND alert for ${topCritical.rule.drug_a} + ${topCritical.rule.drug_b}`,
    );
  }

  return {
    patient_id: patientId,
    medications: medications,
    total_medications: medications.length,
    pairs_evaluated: pairs.length,
    interactions: detectedInteractions,
    critical_interactions: criticalInteractions,
    moderate_interactions: moderateInteractions,
    minor_interactions: minorInteractions,
    critical_alert: criticalAlert,
    unverified_medications: unverified,
    disclaimer: DISCLAIMER,
  };
}

export interface ActiveInteraction {
  matched_drugs: string[];
  mechanism: string;
  clinical_effect: string;
  affected_vitals: string[];
  severity: InteractionSeverity;
}

export interface DDIEngineOutput {
  patient_id: string;
  medications: Medication[];
  critical_interactions: ActiveInteraction[];
  all_interactions: DetectedInteraction[];
  analysis: DdiAnalysisResult;
}

export class DDIEngine {
  private patientOutputs = new Map<string, DDIEngineOutput>();
  private rules: DdiRule[];

  constructor(customRules?: DdiRule[]) {
    this.rules = customRules || loadCuratedInteractions();
  }

  public evaluateMedications(patientId: string, medications: Medication[]): DDIEngineOutput {
    const analysis = analyzeDrugInteractions(patientId, medications, this.rules);

    const critical_interactions: ActiveInteraction[] = analysis.critical_interactions.map((ci) => {
      const mappedSignals = new Set<string>(ci.affected_vitals);
      for (const sig of ci.affected_vitals) {
        const s = sig.toLowerCase();
        if (s.includes("pressure") || s.includes("bp")) {
          mappedSignals.add("systolic_bp");
          mappedSignals.add("diastolic_bp");
        }
        if (s.includes("heart") || s.includes("pulse") || s.includes("brady") || s.includes("tachy") || s.includes("rate")) {
          mappedSignals.add("heart_rate");
        }
        if (s.includes("oxygen") || s.includes("spo2") || s.includes("hypox")) {
          mappedSignals.add("spo2");
        }
      }
      return {
        matched_drugs: [
          ci.medication_a.drug_name || ci.medication_a.generic_name,
          ci.medication_b.drug_name || ci.medication_b.generic_name,
        ],
        mechanism: ci.rule.mechanism,
        clinical_effect: ci.rule.clinical_effect,
        affected_vitals: Array.from(mappedSignals),
        severity: ci.severity,
      };
    });

    const output: DDIEngineOutput = {
      patient_id: patientId,
      medications,
      critical_interactions,
      all_interactions: analysis.interactions,
      analysis,
    };

    this.patientOutputs.set(patientId, output);
    return output;
  }

  public getLatestOutput(patientId: string): DDIEngineOutput | undefined {
    return this.patientOutputs.get(patientId);
  }

  public resetPatient(patientId: string): void {
    this.patientOutputs.delete(patientId);
  }
}
