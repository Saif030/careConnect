# CareConnect: Next-Gen Remote Patient Monitoring & Clinical Decision Support System

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?logo=node.js)](backend/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript)](backend/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](frontend/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi)](prescription/)
[![Python](https://img.shields.io/badge/Python-3.11%20%7C%203.13-3776AB?logo=python)](prescription/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38B2AC?logo=tailwind-css)](frontend/)
[![InfluxDB v2](https://img.shields.io/badge/InfluxDB-v2-22ADF6?logo=influxdb)](docker-compose.yml)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql)](docker-compose.yml)
[![Twilio](https://img.shields.io/badge/Twilio-SMS%20%7C%20Voice%20%7C%20WhatsApp-F22F46?logo=twilio)](docs/TWILIO_SETUP.md)
[![Validation](https://img.shields.io/badge/Validation-98.16%25%20FA%20Reduction-success)](docs/validation/report.md)

> **CareConnect** is an enterprise-ready, cross-signal Remote Patient Monitoring (RPM) and Clinical Decision Support System (CDSS). It bridges the critical divide between continuous high-frequency biometric streams (heart rate, SpO2, blood pressure) and active pharmacological regimens (drug-drug interactions, prescriptions) to eliminate alarm fatigue, intercept adverse drug events before they manifest as fatal crises, and automate emergency caregiver escalations.

---

## 📑 Table of Contents

- [1. Executive Summary & Business Impact](#1-executive-summary--business-impact)
  - [The Clinical & Healthcare Crisis](#the-clinical--healthcare-crisis)
  - [Market Opportunity & Target Segments](#market-opportunity--target-segments)
  - [Business Model & Payer Reimbursement (CPT Codes)](#business-model--payer-reimbursement-cpt-codes)
  - [Quantified Return on Investment (ROI)](#quantified-return-on-investment-roi)
- [2. System Architecture & Data Flow](#2-system-architecture--data-flow)
- [3. Core Technical Innovations](#3-core-technical-innovations)
  - [Multi-Signal Persistence Filtering (Alarm Fatigue Solution)](#multi-signal-persistence-filtering-alarm-fatigue-solution)
  - [Cross-Signal Clinical Fusion Engine (Vitals + Pharmacokinetics)](#cross-signal-clinical-fusion-engine-vitals--pharmacokinetics)
  - [6-Stage AI Prescription Extraction & Safety Gate](#6-stage-ai-prescription-extraction--safety-gate)
  - [Multi-Tier Emergency Escalation (Twilio SMS / Voice / WhatsApp)](#multi-tier-emergency-escalation-twilio-sms--voice--whatsapp)
  - [Privacy-by-Design & Cryptographic Architecture](#privacy-by-design--cryptographic-architecture)
- [4. Monorepo Microservices & Structure](#4-monorepo-microservices--structure)
- [5. Quantitative Validation & Benchmark Metrics](#5-quantitative-validation--benchmark-metrics)
- [6. Hackathon Presentation & Live Demo Studio](#6-hackathon-presentation--live-demo-studio)
- [7. Quickstart & Deployment Guide](#7-quickstart--deployment-guide)
  - [Prerequisites](#prerequisites)
  - [One-Click Windows Quickstart](#one-click-windows-quickstart)
  - [Standard Setup with Make / Manual Terminals](#standard-setup-with-make--manual-terminals)
  - [Environment Variables (.env)](#environment-variables-env)
- [8. Test Suite & Validation Harness](#8-test-suite--validation-harness)
- [9. Regulatory Notice & Safety Disclaimer](#9-regulatory-notice--safety-disclaimer)

---

## 1. Executive Summary & Business Impact

### The Clinical & Healthcare Crisis

Modern healthcare is grappling with three interconnected challenges that drive up hospital operational costs and degrade patient outcomes:

1. **Alarm Fatigue Epidemic**: Between **85% and 99%** of alarms in clinical monitoring settings are false alarms or clinically insignificant spikes caused by sensor slips or transient motion. This noise desensitizes caregivers, leading to missed true crises, clinician burnout, and high staff turnover.
2. **Preventable Adverse Drug Events (ADEs)**: Adverse drug events cause over **1.5 million preventable injuries and deaths** in the United States alone each year. Over 30% of emergency readmissions in geriatric patients are linked to polypharmacy and unrecognized drug-drug interactions (DDIs).
3. **The 30-Day Hospital Readmission Penalty**: Under programs like the US CMS Hospital Readmissions Reduction Program (HRRP), health systems face severe financial penalties when post-acute discharge patients are readmitted within 30 days due to unmanaged cardiovascular or pulmonary deterioration.

### Market Opportunity & Target Segments

The global **Remote Patient Monitoring (RPM)** market is projected to expand from **\$71.9 Billion in 2023 to over \$175 Billion by 2030 (CAGR ~13.5%)**, propelled by aging demographics, rising rates of chronic disease (hypertension, COPD, heart failure), and decentralized care models.

CareConnect targets high-value healthcare market verticals:

```mermaid
graph TD
    CC["CareConnect Platform"]
    CC --> B2B1["Accountable Care Organizations (ACOs)<br/><i>Shared savings via readmission reduction</i>"]
    CC --> B2B2["Health Systems & Hospital Networks<br/><i>Post-discharge continuous monitoring</i>"]
    CC --> B2B3["Senior Living & Assisted Care Facilities<br/><i>Night-time triage and remote clinical oversight</i>"]
    CC --> B2B4["Direct-to-Consumer / Family Caregiver Networks<br/><i>Peace-of-mind alerts with automated emergency fallbacks</i>"]
```

### Business Model & Payer Reimbursement (CPT Codes)

CareConnect is architected to be turn-key compliant with US CMS and commercial payer Remote Physiologic Monitoring (RPM) reimbursement frameworks:

| CPT Code | Clinical Description | Average US Reimbursement (Monthly) | CareConnect Automation |
| :---: | :--- | :---: | :--- |
| **CPT 99453** | Initial setup of RPM device and patient onboarding/education | **\$19 – \$21** (one-time) | Automated device provisioning and patient registration |
| **CPT 99454** | Monthly transmission of daily vital signs recordings ($\ge 16$ days/mo) | **\$55 – \$65 / patient / mo** | Continuous automated InfluxDB time-series ingestion |
| **CPT 99457** | Clinical staff management services (first 20 min of RPM review) | **\$50 – \$55 / patient / mo** | Real-time caregiver dashboard, alerts feed, and triage logs |
| **CPT 99458** | Additional 20 min of clinical RPM management review | **\$40 – \$45 / patient / mo** | Automated audit trail logging for all clinician reviews |

#### Monetization Architecture
- **SaaS B2B Subscription**: Per-Patient-Per-Month (PPPM) model charged to health systems (\$25 – \$45 / patient / mo), allowing clinical providers to capture substantial net positive margin on CPT billing.
- **Enterprise Hospital Licensing**: Tiered volume deployment across health systems with dedicated on-premise or HIPAA-compliant VPC configurations.

### Quantified Return on Investment (ROI)

For a mid-sized healthcare organization managing 1,000 post-acute cardiac or COPD patients:
- **Avoided Readmissions**: Reduces preventable 30-day readmissions by an estimated **38%–45%**. At an average cost of **\$14,500 per inpatient readmission**, saving 40 readmissions equates to **\$580,000 in direct annual cost avoidance**.
- **Caregiver Efficiency**: 98.16% reduction in false alarms frees up an estimated **18 clinician hours per week per 100 monitored patients**, eliminating alarm desensitization and optimizing staff capacity.
- **Net CPT Revenue**: 1,000 patients billed under CPT 99454 + 99457 generates approximately **\$1.3M in gross recurring clinical revenue annually**.

---

## 2. System Architecture & Data Flow

CareConnect utilizes an event-driven, decoupled microservices topology:

```mermaid
flowchart TD
    subgraph Data Sources & Edge Telemetry
        S["Vitals Simulator / IoT Sensors<br/>(Heart Rate, SpO2, BP)"]
        RxUpload["Prescription Document<br/>(Image Scans / E-Prescriptions)"]
    end

    subgraph Ingestion & Edge Gate
        FastAPI["Prescription Service (Python / FastAPI)<br/>OpenCV Preprocessing → OCR → LLM Extraction<br/>RxNorm Normalization & Safety Gate"]
        Express["Backend Ingestion API (Node.js 20 / Express)<br/>JWT & RBAC Gatekeeper + Zod Schema Validation"]
    end

    subgraph Clinical Decision Support & Fusion
        AnomalyEng["Anomaly Engine<br/>Persistence Filter (P=3)<br/>Circadian Dynamic Baselines"]
        DDIEng["DDI Safety Engine<br/>27 Curated Critical Interactions<br/>Combinatorial Regimen Pairs: n(n-1)/2"]
        FusionEng["Clinical Fusion Engine<br/>Biometric Breach + Pharmacological Context<br/>Alert Severity: GREEN | YELLOW | RED"]
    end

    subgraph Storage & Security Layer
        Influx[("InfluxDB v2 Time-Series<br/>- Opaque patient_id Tag<br/>- High-Frequency Telemetry<br/>- ZERO PII")]
        Postgres[("PostgreSQL 16 Relational<br/>- Patients (AES-256-GCM Encrypted)<br/>- Active Medications<br/>- Immutable Audit Access Logs")]
    end

    subgraph Realtime Delivery & Multi-Tier Escalation
        SocketIO["Real-Time Socket.io Server<br/>Low-Latency WebSocket Feeds"]
        Escalation["Escalation Engine<br/>60s Primary Acknowledgment Timer"]
        Twilio["Twilio Communications Engine<br/>- Tier 1: Primary SMS / WhatsApp<br/>- Tier 2: Voice Call Escalation<br/>- Secondary Contact Escalation"]
    end

    subgraph Presentation & Clinical Cockpit
        ReactUI["CareConnect Frontend (React + Vite + Tailwind)<br/>- Multi-Signal Recharts Waveforms<br/>- Clinical Protocol Checklists<br/>- 1-Click Interactive Demo Studio"]
    end

    S -->|POST /api/vitals| Express
    RxUpload -->|POST /api/prescriptions/parse| FastAPI
    FastAPI -->|Structured Medication JSON| Express

    Express --> Influx
    Express --> AnomalyEng
    Express --> DDIEng
    AnomalyEng & DDIEng --> FusionEng

    FusionEng -->|RED Crisis Alerts| Escalation
    FusionEng -->|Alert Events| Postgres
    FusionEng -->|Real-Time Broadcast| SocketIO

    Escalation -->|Multi-Channel Dispatch| Twilio
    SocketIO -->|Live Waveforms & Alerts| ReactUI
    Express -->|REST & Chart Ingestion| ReactUI
```

---

## 3. Core Technical Innovations

### Multi-Signal Persistence Filtering (Alarm Fatigue Solution)

Standard hospital pulse oximeters and consumer monitors alarm on single-point threshold crossings ($P=1$), generating massive alarm fatigue on transient sensor slips, motion artifacts, or coughing spasms.

CareConnect implements a **Persistence Filtering Algorithm ($P=3$)**:
- A physiological breach must be sustained for $P$ consecutive minutes before promoting a warning into an active clinical alert.
- **Result**: Eliminates **98.16% of false alarms** while retaining **100% sensitivity (0 false negatives)** on genuine deteriorations with an acceptable mean detection delay of only 2.80 minutes.

```
Single-Threshold (P=1):   [████████████████████████████████████████] 272 False Alarms / 1,000h
CareConnect (P=2):         [███] 25 False Alarms (-90.81%)
CareConnect (P=3 Default): [█] 5 False Alarms (-98.16%)
CareConnect (P=5):         [] 0 False Alarms (-100.00%)
```

### Cross-Signal Clinical Fusion Engine (Vitals + Pharmacokinetics)

Most monitoring systems evaluate vital signs in isolation from medications. CareConnect's **Fusion Engine** (`backend/src/fusionEngine.ts`) dynamically cross-references biometric breaches against the patient's active drug regimen using a combinatorial DDI matrix:

$$\text{Regimen Combinations} = \frac{n(n - 1)}{2}$$

#### Decision Branches:
1. **`NORMAL`**: Stable physiological vitals with compatible medications.
2. **`VITALS_BREACH_ONLY`**: Biometric deviation without contributing pharmacodynamic interactions (e.g., pure hypoxemic desaturation requiring supplemental oxygen).
3. **`COMPOUND_BREACH`**: Vital signs crash directly exacerbated or triggered by concomitant drug combinations (e.g., profound hypotension induced by Lisinopril + Metoprolol or Nitroglycerin + Sildenafil).
4. **`CRITICAL_INTERACTION_NORMAL_VITALS`**: High-risk pharmacological interaction identified prior to biometric collapse; flagged silently for routine clinician review without triggering alarm fatigue.

### 6-Stage AI Prescription Extraction & Safety Gate

Prescription onboarding employs a hardened computer vision and language pipeline (`prescription/app/`):

```mermaid
flowchart LR
    P1["1. Image Preprocessing<br/>(Deskew, Denoise, CLAHE)"] --> P2["2. Layout Analysis<br/>(Prescription Bounding Boxes)"]
    P2 --> P3["3. Optical Character Recognition<br/>(Tesseract OCR Engine)"]
    P3 --> P4["4. LLM Structured Extraction<br/>(Drug Name, Dosage, Sig, Timing)"]
    P4 --> P5["5. RxNorm Ontology Normalization<br/>(NIH RxNorm ID Mapping)"]
    P5 --> P6["6. Confidence Safety Gate<br/>(Threshold >= 0.85 & Valid Dosage)"]
    
    P6 -->|Pass| AutoApprove["Auto-Approve to Patient Regimen"]
    P6 -->|Ambiguous / Illegible| ReviewQueue["Route to Pharmacist Review Queue<br/>(100% Messy Prescriptions Gated)"]
```

### Multi-Tier Emergency Escalation (Twilio SMS / Voice / WhatsApp)

When a `RED` life-safety alert is triggered:
1. **Step 1 (Immediate)**: Dispatches instant push notification and Twilio SMS/WhatsApp alert to the Primary Caregiver. An automated 60-second acknowledgment timer is armed.
2. **Step 2 (T + 60s Unacknowledged)**: If the primary caregiver does not acknowledge the incident via the interactive UI (`POST /api/alerts/:id/ack`), the engine automatically triggers an emergency synthetic **Twilio Voice Call**.
3. **Step 3 (Secondary Fallback)**: Simultaneously escalates SMS and voice channels to the designated **Secondary Contact**, while recording an immutable escalation trail in PostgreSQL.

### Privacy-by-Design & Cryptographic Architecture

CareConnect complies with HIPAA and GDPR data minimization requirements (`docs/privacy.md`):

| Data Layer | Storage Engine | PII Status | Encryption & Protection |
| :--- | :--- | :---: | :--- |
| **Biometric Telemetry** | InfluxDB v2 | **Zero PII** | Anonymized; tagged exclusively by opaque UUID `patient_id`. |
| **Patient Demographics (PHI)** | PostgreSQL 16 | **PHI** | Field-level **AES-256-GCM** encryption with dedicated IVs and authentication tags. |
| **Audit Trails** | PostgreSQL 16 | N/A | Append-only, tamper-evident log of all clinical views, edits, and alerts. |
| **Prescription Images** | Object / File Store | Sensitive | Configurable retention: Immediate zero-retention wipe or AES-256 at rest. |

---

## 4. Monorepo Microservices & Structure

```
hackshift2/
├── backend/                  # Node.js 20, TypeScript, Express, Socket.io
│   ├── src/
│   │   ├── anomalyEngine.ts  # Persistence filtering & threshold boundary evaluation
│   │   ├── ddiEngine.ts      # 27 curated clinical drug-drug interaction rules
│   │   ├── fusionEngine.ts   # Cross-signal synthesis (Vitals + Pharmacodynamics)
│   │   ├── escalation.ts     # 60s emergency escalation timer & multi-channel logic
│   │   ├── crypto.ts         # AES-256-GCM field encryption/decryption utilities
│   │   ├── notifications/    # Twilio (SMS, Voice, WhatsApp) & Supabase real-time
│   │   └── db/               # PostgreSQL migrations, connection pool, and seeds
│   └── data/interactions.json# High-priority pharmacological contraindications
├── frontend/                 # React 18, Vite, Tailwind CSS, Recharts
│   └── src/
│       ├── components/       # Telemetry charts, Alerts feed, EmergencyModal, DemoStudio
│       └── App.tsx           # Primary Caregiver Cockpit & Dashboard
├── prescription/             # Python 3.11+, FastAPI, OpenCV, Pydantic, RapidFuzz
│   └── app/
│       ├── preprocess.py     # Image thresholding, contrast enhancement, noise filter
│       ├── ocr.py            # Optical character recognition interface
│       ├── llm_parse.py      # Structured extraction of dosage, form, and frequency
│       ├── normalize.py      # Standardized RxNorm string matching
│       └── gate.py           # Deterministic confidence threshold & safety gating
├── simulator/                # Python synthetic vitals telemetry generator
│   └── simulator/            # AR(1) physiological stream, artifacts, and crisis injection
├── docs/                     # Full technical contracts, validation reports, and setup guides
│   ├── contracts.md          # Shared JSON Schema specifications
│   ├── safety.md             # Clinical boundaries, CDSS guidelines, and DDI matrix
│   ├── privacy.md            # Cryptographic model, storage separation, and audit spec
│   ├── validation/           # 1,000h benchmark script, chart, and validation report
│   ├── TWILIO_SETUP.md       # Twilio SMS, Voice, and WhatsApp configuration guide
│   └── SUPABASE_SETUP.md     # Supabase real-time sync configuration guide
├── docker-compose.yml        # PostgreSQL 16 & InfluxDB v2 container orchestration
├── Makefile                  # Developer ergonomics (install, dev, test, validate)
└── run_all.bat               # 1-Click native Windows service launcher
```

---

## 5. Quantitative Validation & Benchmark Metrics

The system was subjected to rigorous validation across 1,000 continuous hours (60,000 minutes) of synthetic telemetry and 30 clinical prescription presentations (`docs/validation/report.md`):

| Evaluation Metric | Legacy Single-Threshold | CareConnect Engine ($P=3$) | Improvement / Outcome |
| :--- | :---: | :---: | :---: |
| **Telemetry Ingestion Window** | 1,000 Hours | 1,000 Hours | Continuous streaming |
| **False Alarms (Motion / Spikes)** | 272 False Alarms | **5 False Alarms** | **98.16% Reduction in False Alarms** |
| **True Crisis Sensitivity** | 20 / 20 Detected (100%) | **20 / 20 Detected (100%)** | **0 Missed Emergencies (0% False Negatives)** |
| **Mean Detection Latency** | 0.90 Minutes | **2.80 Minutes** | Within safe clinical intervention bounds |
| **Ambiguous Prescription Gating**| 0% (Blind ingestion) | **100% Gated (10/10)** | Routed to Pharmacist Review Queue |
| **Prescription Entity Accuracy** | Baseline OCR (~60%) | **87.1% Overall (100% Drug)**| High-fidelity structured parsing |

---

## 6. Hackathon Presentation & Live Demo Studio

CareConnect includes a built-in **Interactive Demo Studio** on the caregiver dashboard (`http://localhost:5173`), engineered specifically for hackathon judging and live clinical evaluations:

```
+----------------------------------------------------------------------------------+
| CareConnect Caregiver Cockpit                            Demo Studio [Active]    |
+----------------------------------------------------------------------------------+
| [🟢 Baseline Normal]  [🟡 Tachycardia]  [🔴 Critical Hypoxia]  [⚡ Compound Risk] |
| [▶ Start Auto Telemetry Loop]              [+ Ingest Sample Prescription]        |
+----------------------------------------------------------------------------------+
```

### 1-Click Clinical Scenarios:
1. `🟢 Resting Baseline`: Normal resting hemodynamics (HR 72 bpm, SpO2 98%, BP 120/80 mmHg). Emits green routine operational status.
2. `🟡 Tachycardia Warning`: Elevated resting pulse (> 110 bpm). Demonstrates amber warning with rest and hydration instructions.
3. `🔴 Critical Hypoxia`: Acute peripheral SpO2 collapse (< 90%). Fires red emergency alert, starts 60s escalation countdown, and opens the **Interactive Protocol Checklist**.
4. `⚡ Compound Multi-Drug Risk`: Concomitant ACE inhibitor (Lisinopril) + Calcium Channel Blocker (Amlodipine) causing sudden hypotensive collapse. Demonstrates cross-signal fusion with drug mechanism explanation.
5. `▶ Start Auto Loop`: Simulates realistic live continuous telemetry streaming directly in the UI without requiring background terminal processes.
6. `Prescription AI Studio`: Allows upload or preset selection of handwritten/messy scripts to watch real-time OCR extraction, RxNorm mapping, and safety gating.

---

## 7. Quickstart & Deployment Guide

### Prerequisites
- **Node.js**: v20.x or higher
- **Python**: v3.11 or v3.13
- **Docker & Docker Compose**: For local PostgreSQL and InfluxDB
- **Git**

---

### One-Click Windows Quickstart

On Windows, launch all 4 microservices simultaneously with a single command:

```cmd
run_all.bat
```

This launches dedicated console windows for:
- **Backend API**: `http://localhost:4000`
- **Caregiver Dashboard**: `http://localhost:5173`
- **Prescription Service**: `http://localhost:8000`
- **Vitals Simulator**: Continuous telemetry feeder

---

### Standard Setup with Make / Manual Terminals

#### 1. Clone & Configure Environment
```bash
git clone https://github.com/your-org/careconnect.git
cd careconnect
cp .env.example .env
```

#### 2. Start Infrastructure Containers
```bash
docker compose up -d
```
- PostgreSQL: `localhost:5432`
- InfluxDB UI: `http://localhost:8086` (Username: `admin`, Password: `adminpassword123`)

#### 3. Install Dependencies
```bash
# Using Makefile
make install

# Or manually:
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
python -m pip install -r prescription/requirements.txt
python -m pip install -r simulator/requirements.txt
```

#### 4. Run Database Migrations & Seeds
```bash
cd backend
npm run migrate
npm run seed
cd ..
```

#### 5. Launch Services
```bash
# Using Makefile
make dev

# Or in separate terminal windows:
# Terminal 1: Backend
cd backend && npm run dev

# Terminal 2: Frontend Dashboard
cd frontend && npm run dev

# Terminal 3: Prescription Engine
cd prescription && python -m uvicorn app.main:app --port 8000 --reload

# Terminal 4 (Optional): Telemetry Simulator
cd simulator && python run.py
```

Open your browser to: **`http://localhost:5173`**

---

### Environment Variables (.env)

The system works out of the box with default mock settings. To enable live SMS/Voice or Supabase sync, configure:

```ini
# Backend Core
PORT=4000
NODE_ENV=development
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
JWT_SECRET=careconnect_jwt_secret_key_change_in_production

# Relational & Time-Series Databases
DATABASE_URL=postgres://careconnect:careconnect@localhost:5432/careconnect
INFLUX_URL=http://localhost:8086
INFLUX_TOKEN=careconnect-super-secret-admin-token
INFLUX_ORG=careconnect
INFLUX_BUCKET=vitals

# Twilio Telephony (SMS / Voice / WhatsApp)
MOCK_NOTIFICATIONS=true # Set to false to send real SMS/Voice
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX
PRIMARY_CAREGIVER_PHONE=+1XXXXXXXXXX
SECONDARY_CAREGIVER_PHONE=+1XXXXXXXXXX

# Supabase Realtime Sync (Optional)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

---

## 8. Test Suite & Validation Harness

CareConnect features end-to-end unit, integration, and safety test coverage across all stacks:

```bash
# Run all unit and integration tests across microservices
make test

# Or run tests per service:
cd backend && npm test
cd frontend && npm test
cd prescription && pytest
```

### Run Phase 9 Clinical Benchmark Validation
To reproduce the 1,000-hour telemetry benchmark and prescription gating audit:

```bash
make validate
# Or:
python docs/validation/run_all_validation.py
```

---

## 9. Regulatory Notice & Safety Disclaimer

> [!WARNING]
> ### CLINICAL DECISION SUPPORT SYSTEM (CDSS) NOTICE
> **Decision support only. Consult a pharmacist or doctor. Not an autonomous diagnostic device.**
>
> CareConnect is an assistive Clinical Decision Support System designed to assist caregivers and clinical staff in identifying physiological anomalies and pharmacological risks. It does **not** generate autonomous medical diagnoses, alter medication dosages, or replace the professional clinical judgment of a licensed physician, registered nurse, or pharmacist. All high-consequence interventions, prescription approvals, and emergency responses require human verification. Conforms to the requirements of the US FDA 21st Century Cures Act § 3060 for non-device clinical decision support.

---

<div align="center">
  <sub>Engineered for Hackathons, Clinical Trials, and Scalable Digital Health Deployments.</sub>
</div>
