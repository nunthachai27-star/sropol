# Pregnancy → Labor → Newborn Continuum Design

**Date**: 2026-03-29
**Status**: Approved
**Scope**: Expand kk-lrms from labor-only to full maternal journey tracking

---

## 1. Overview

Redesign kk-lrms to support the complete pregnancy continuum: ANC (pregnancy tracking) → Labor → Newborn outcomes. Currently the system only tracks active labor patients via HOSxP `ipt`/`ipt_labour` tables with CPD risk scoring.

### Goals
- **Provincial risk surveillance**: Single dashboard tracking ALL pregnant women across 26 hospitals, flagging high-risk cases for timely referral
- **Continuity of care**: Track each woman's journey from first ANC visit through delivery to birth outcomes, catching gaps (missed visits, incomplete follow-up)

### Key Decisions
| Decision | Choice |
|----------|--------|
| Risk model | Stage-appropriate: 4-tier ANC risk during pregnancy, CPD during labor |
| Newborn data source | `ipt_newborn`/`ipt_labour_infant` from IPD (skip PCUAccount3) |
| Newborn scope | Birth outcomes + neonatal KPIs (no post-discharge tracking) |
| Referral | Full workflow: initiate, track, confirm with capability matching |
| Data acquisition | Hybrid: BMS polling (HOSxP) + webhooks (non-HOSxP) |
| Dashboard model | Active registry: all pregnant women visible, filterable |
| Architecture | "Maternal Journey" — single anchor entity connecting all stages |

---

## 2. Data Model

### 2.1 New Tables

#### `maternal_journeys` (anchor entity — one per pregnancy)
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary key |
| `hospital_id` | UUID (FK → hospitals) | Origin hospital |
| `current_hospital_id` | UUID (FK → hospitals) | May differ after referral |
| `hn` | VARCHAR | Patient HN at origin hospital |
| `person_anc_id` | INT (nullable) | HOSxP source ID |
| `name` | TEXT (encrypted) | Patient name |
| `cid` | TEXT (encrypted) | Citizen ID |
| `cid_hash` | VARCHAR | SHA-256 hash for matching |
| `age` | INT | Age at EDC |
| `gravida` | INT | Pregnancy number |
| `para` | INT | Parity |
| `lmp` | DATE | Last menstrual period |
| `edc` | DATE | Expected date of confinement |
| `care_stage` | ENUM | PREGNANCY, LABOR, DELIVERED, POSTPARTUM |
| `anc_risk_level` | ENUM | LOW, HR1, HR2, HR3 |
| `anc_visit_count` | INT | Total ANC visits |
| `last_anc_date` | DATE | Most recent ANC visit |
| `ga_weeks` | INT (computed) | Current gestational age from LMP |
| `registered_at` | TIMESTAMP | Journey creation time |
| `stage_changed_at` | TIMESTAMP | Last stage transition |
| `synced_at` | TIMESTAMP | Last sync from source |
| `created_at` | TIMESTAMP | Record creation |
| `updated_at` | TIMESTAMP | Last update |

**Indexes**: `(hospital_id, hn)` unique, `care_stage`, `anc_risk_level`, `cid_hash`, `current_hospital_id`

#### `cached_anc_visits`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary key |
| `journey_id` | UUID (FK → maternal_journeys) | Parent journey |
| `visit_date` | DATE | Service date |
| `visit_number` | INT | ANC visit sequence (1st, 2nd...) |
| `ga_weeks` | INT | GA at visit |
| `ga_days` | INT | GA remainder days |
| `fundal_height_cm` | FLOAT | Fundal height |
| `weight_kg` | FLOAT | Maternal weight |
| `bp_systolic` | INT | Blood pressure systolic |
| `bp_diastolic` | INT | Blood pressure diastolic |
| `fetal_hr` | INT | Fetal heart rate |
| `presentation` | VARCHAR | Baby position |
| `engagement` | VARCHAR | Baby lead/station |
| `pass_quality` | BOOLEAN | Within quality visit window |
| `provider_code` | VARCHAR | Attending staff |
| `synced_at` | TIMESTAMP | Last sync |
| `created_at` | TIMESTAMP | Record creation |

**Indexes**: `(journey_id, visit_date)` unique, `journey_id`

#### `cached_anc_risks`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary key |
| `journey_id` | UUID (FK → maternal_journeys) | Parent journey |
| `risk_level` | ENUM | LOW, HR1, HR2, HR3 |
| `triggered_rules` | JSONB | Array of triggered rule IDs |
| `risk_factors` | JSONB | Full risk factor detail |
| `recommended_facility` | VARCHAR | Recommended ANC location |
| `recommended_provider` | VARCHAR | Recommended provider type |
| `screened_at` | TIMESTAMP | When screening was performed |
| `created_at` | TIMESTAMP | Record creation |

**Indexes**: `(journey_id, screened_at)`, `risk_level`

#### `cached_referrals`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary key |
| `journey_id` | UUID (FK → maternal_journeys) | Parent journey |
| `refer_number` | VARCHAR | HOSxP reference number (nullable) |
| `from_hospital_id` | UUID (FK → hospitals) | Sending hospital |
| `to_hospital_id` | UUID (FK → hospitals) | Receiving hospital |
| `status` | ENUM | INITIATED, ACCEPTED, REJECTED, IN_TRANSIT, ARRIVED |
| `reason` | TEXT | Referral reason |
| `diagnosis_code` | VARCHAR | ICD-10 code |
| `urgency_level` | ENUM | ROUTINE, URGENT, EMERGENCY |
| `rejection_reason` | TEXT (nullable) | If rejected |
| `suggested_alternative_id` | UUID (nullable, FK → hospitals) | If rejected |
| `transport_mode` | VARCHAR (nullable) | ambulance, self, etc. |
| `initiated_at` | TIMESTAMP | When referral was created |
| `accepted_at` | TIMESTAMP (nullable) | When accepted |
| `departed_at` | TIMESTAMP (nullable) | When patient left |
| `arrived_at` | TIMESTAMP (nullable) | When patient arrived |
| `rejected_at` | TIMESTAMP (nullable) | When rejected |
| `initiated_by` | UUID (nullable, FK → users) | Staff who initiated |
| `accepted_by` | UUID (nullable, FK → users) | Staff who accepted |
| `created_at` | TIMESTAMP | Record creation |
| `updated_at` | TIMESTAMP | Last update |

**Indexes**: `journey_id`, `(from_hospital_id, status)`, `(to_hospital_id, status)`, `status`

#### `cached_newborns`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary key |
| `journey_id` | UUID (FK → maternal_journeys) | Parent journey |
| `infant_number` | INT | For multiples (1, 2, 3...) |
| `sex` | VARCHAR | M/F |
| `birth_weight_g` | INT | Birth weight in grams |
| `body_length_cm` | FLOAT | Body length |
| `head_circum_cm` | FLOAT | Head circumference |
| `temperature` | FLOAT | Temperature at birth |
| `heart_rate` | INT | HR at birth |
| `respiratory_rate` | INT | RR at birth |
| `apgar_1min` | INT | Apgar score at 1 minute |
| `apgar_5min` | INT | Apgar score at 5 minutes |
| `apgar_10min` | INT (nullable) | Apgar score at 10 minutes |
| `resuscitation` | JSONB | Flags: ppv, et_tube, chest_pump, oxygen_box, narcan |
| `vaccinations` | JSONB | Flags: bcg, hepb, vitk, eye_paste, azt |
| `infant_icd10` | VARCHAR (nullable) | Infant diagnosis |
| `infant_hn` | VARCHAR (nullable) | Infant HN |
| `infant_an` | VARCHAR (nullable) | Infant admission number |
| `discharge_status` | VARCHAR (nullable) | Discharge status code |
| `born_at` | TIMESTAMP | Date and time of birth |
| `synced_at` | TIMESTAMP | Last sync |
| `created_at` | TIMESTAMP | Record creation |

**Indexes**: `(journey_id, infant_number)` unique, `journey_id`

### 2.2 Modified Tables

#### `cached_patients` — add column:
| Column | Type | Description |
|--------|------|-------------|
| `journey_id` | UUID (nullable, FK → maternal_journeys) | Links to maternal journey |

**Index**: `journey_id`

### 2.3 Unchanged Tables
- `hospitals`, `hospital_bms_config`, `webhook_api_keys`, `users`, `audit_logs`
- `cached_vital_signs`, `cpd_scores` (no schema changes)

---

## 3. HOSxP Data Mapping & Sync

### 3.1 ANC Sync (every 5 minutes)

**Source tables**: `person_anc`, `person_anc_service`, `person_anc_risk`, `person_anc_classifying`, `patient`

**Query**: Select all `person_anc` records where `anc_register_date` falls within the tracking window (last 10 months). JOIN with `patient` for demographics, `person_anc_service` for visit records, `person_anc_risk`/`person_anc_classifying` for risk factors.

**Transform**:
- `person_anc` → `maternal_journeys` (create/upsert by `person_anc_id` + `hospital_id`)
- `person_anc_service` → `cached_anc_visits` (upsert by `journey_id` + `visit_date`)
- `person_anc_risk` + `person_anc_classifying` → `cached_anc_risks` (evaluate through risk engine)
- EDC auto-calculated from LMP (+280 days) if not provided
- GA weeks computed: `(current_date - lmp) / 7`
- Patient name/CID encrypted per PDPA requirements

### 3.2 Labor Sync (every 30 seconds — unchanged + extensions)

Existing sync unchanged. Extensions:
1. After `cached_patients` upsert, match `hn` + `hospital_id` to `maternal_journeys` → set `journey_id`
2. If no matching journey found, auto-create one with `care_stage = LABOR` using `ipt_labour` data (LMP, EDC, gravida)
3. Update journey `care_stage` → `LABOR`, `stage_changed_at` → now
4. New query: `ipt_labour_infant` → upsert `cached_newborns`
5. On infant data: transition journey to `DELIVERED`

### 3.3 Referral Sync (event-driven + 5 min poll)

- Outbound: Poll `referout` table for pregnancy-related referrals
- Inbound: Poll `referin` at receiving hospital for acceptance
- Webhook: Non-HOSxP hospitals push referral status updates via existing webhook API

### 3.4 Journey-Labor Matching Logic

When a labor admission arrives:
1. Search `maternal_journeys` WHERE `hn = patient.hn` AND `hospital_id = patient.hospital_id` AND `care_stage = 'PREGNANCY'`
2. If found → link `journey_id`, update `care_stage → LABOR`
3. If NOT found → auto-create journey with `care_stage = LABOR` and data from `ipt_labour`

---

## 4. ANC Risk Classification Engine

### 4.1 4-Tier Model

Based on provincial screening guidelines (แนวทางการคัดกรองและจัดการความเสี่ยงหญิงตั้งครรภ์):

| Level | Criteria Examples | ANC Location | Provider |
|-------|-------------------|--------------|----------|
| **LOW** | No risk factors | รพ.สต. | Nurse/health worker |
| **HR1** | Age <17/≥35, BMI <18.5/≥23, height <145cm, O2sat <95%, previous stillbirth, previous birth wt <2500g/>4000g, Hx preeclampsia/GDM | รพ.ชุมชน | Doctor/nurse |
| **HR2** | BMI 30-40, Twin DCDA, BP ≥140/90, gravida ≥5, ≥3 miscarriages, prior C-section, chronic diseases (DM/HT/HIV/thyroid), Rh-, HBsAg+, Syphilis+, HIV+, Thalassemia | รพช.แม่ข่าย/รพท. | Obstetrician |
| **HR3** | BMI ≥40, Twin MCDA/triplet+, abnormal fetal U/S, heart disease WHO≥2, renal disease/APS/SLE, severe anemia (Hct<28%/Hb<9), NIPT/Quad high risk | รพ.จังหวัด/รพศ. | Obstetrician/MFM |

### 4.2 Configurable Rule Engine

Rules defined in `src/config/anc-risk-rules.ts`:
- Each rule: `{ id, level, labelTh, labelEn, source, evaluate(input) → boolean }`
- Sources: `computed` (from raw vitals/demographics), `hosxp_risk` (from `person_anc_risk`), `hosxp_classifying` (from `person_anc_classifying`), `lab` (from lab results)
- Evaluation: Run ALL rules, collect triggered IDs, highest level wins (HR3 > HR2 > HR1 > LOW)
- No hardcoded conditions — rules are configurable per CLAUDE.md constitution

### 4.3 Service: `src/services/anc-risk.ts`
- `evaluateAncRisk(rules, input)` → `{ level, triggeredRules, recommendation }`
- `collectAncRiskInput(journey, visits, risks)` → `AncRiskInput`
- `shouldRefer(journey, hospital)` → `{ needed, reason, suggestedDestination }`

### 4.4 Dual Risk Models

- **Pregnancy stage**: `anc_risk_level` (LOW/HR1/HR2/HR3) on `maternal_journeys`
- **Labor stage**: `cpd_scores` (LOW/MEDIUM/HIGH) on `cached_patients`
- Both visible in patient detail for complete risk picture
- ANC risk carries forward as context during labor

---

## 5. Referral Workflow

### 5.1 State Machine

```
INITIATED → ACCEPTED → IN_TRANSIT → ARRIVED
         → REJECTED → (auto re-route to next capable hospital)
```

### 5.2 Hospital Capability Thresholds

Configured in `src/config/hospital-capabilities.ts` from provincial referral hierarchy:

| Hospital | Min GA | Min FW | Max Risk | Escalates To |
|----------|--------|--------|----------|--------------|
| รพ.พล | 35 wks | 2,000g | HR3 | รพ.ขอนแก่น |
| รพ.สิรินธร | 32 wks | 1,500g | HR3 | รพ.ขอนแก่น |
| รพ.บ้านไผ่ | 34 wks | 1,800g | HR3 | รพ.ขอนแก่น |
| รพ.ขอนแก่น | — | — | HR3 | — (terminal) |
| F1/F2/F3 hospitals | varies | varies | varies | Regional hub |

All 26 hospitals configured with thresholds and escalation paths.

### 5.3 Auto-Alert Logic

**Referral alerts**: When ANC risk or clinical parameters exceed hospital capability:
- System generates **referral alert** (not auto-initiated)
- Alert shows: reason, suggested destination, one-click initiation
- Clinical staff must explicitly initiate — safety decision requiring human judgment

**Overdue ANC alerts**: When a pregnant woman misses her expected next visit:
- Based on standard ANC schedule: visits at GA 12, 20, 26, 30, 32, 34, 36, 37, 38, 39, 40 weeks
- Alert generated when current date exceeds expected next visit date by 7+ days
- Overdue count shown on dashboard alert bar per hospital

### 5.4 Service: `src/services/referral.ts`
- `initiateReferral(journeyId, toHospitalId, reason, urgency)`
- `acceptReferral(referralId, acceptedBy)`
- `rejectReferral(referralId, reason, altHospital?)`
- `markInTransit(referralId, transportMode)`
- `confirmArrival(referralId, receivingAn)`
- `checkCapability(journeyId, hospitalId)`
- `getPendingReferrals(hospitalId, direction)`

### 5.5 API Routes
- `POST /api/referrals` — initiate
- `PATCH /api/referrals/[id]/accept`
- `PATCH /api/referrals/[id]/reject`
- `PATCH /api/referrals/[id]/transit`
- `PATCH /api/referrals/[id]/arrive`
- `GET /api/referrals?hospital=X&dir=in|out`
- `GET /api/dashboard/referrals`

---

## 6. Dashboard & UI

### 6.1 Province Dashboard (redesigned)

**Top KPI Bar** — 3 stage cards:
- **Pregnancy (ANC)**: total + risk breakdown (LOW/HR1/HR2/HR3)
- **Active Labor**: total + CPD risk breakdown (LOW/MEDIUM/HIGH)
- **Delivered (This Month)**: total + outcome flags (normal/low Apgar/LBW)

**Alert Bar** — 3 alert cards:
- Referral Alerts (patients exceeding hospital capability)
- Overdue ANC (missed scheduled visits)
- In-Transit Referrals (currently being transferred)

**Hospital Table** — expanded columns: ANC total, HR1/HR2/HR3 counts, labor count, delivered count, alert count, capability thresholds, last sync

### 6.2 New Pages

| Route | Purpose |
|-------|---------|
| `/pregnancies` | Province ANC registry, filterable by risk, GA, hospital |
| `/pregnancies/[journeyId]` | Journey detail: ANC timeline, risk history, vitals chart |
| `/referrals` | Province referral dashboard (pending, in-transit, completed) |
| `/hospitals/[hcode]/pregnancies` | Hospital ANC patient list |
| `/outcomes` | Neonatal KPI dashboard (birth weight, Apgar, complications) |

### 6.3 Modified Pages

| Route | Changes |
|-------|---------|
| `/` (dashboard) | Add stage KPIs, alert bar, expanded hospital table |
| `/patients/[an]` | Add journey context panel (ANC history, risk, referral status) |
| `/hospitals/[hcode]` | Add ANC tab, capability display, referral panel |

### 6.4 Navigation

```
Sidebar:
  Dashboard         (province overview)
  Pregnancies       (ANC registry)        ← NEW
  Labor Room        (existing, renamed)
  Outcomes          (neonatal KPIs)       ← NEW
  Referrals         (referral tracking)   ← NEW
  ─────────────────
  Hospitals         (config & monitoring)
  Admin             (settings, API keys)
```

---

## 7. Service Layer

### 7.1 New Services

| Service | Purpose |
|---------|---------|
| `src/services/anc-risk.ts` | ANC risk classification engine |
| `src/services/journey.ts` | Maternal journey lifecycle management |
| `src/services/referral.ts` | Referral workflow state machine |
| `src/services/newborn.ts` | Birth outcome tracking and KPIs |

### 7.2 Modified Services

| Service | Changes |
|---------|---------|
| `src/services/dashboard.ts` | Add stage KPIs, alert counts, ANC aggregation |
| `src/services/sync.ts` | Add ANC sync, newborn sync, journey matching |
| `src/services/webhook.ts` | Accept ANC + referral payloads |

### 7.3 Unchanged Services
- `cpd-score.ts`, `partogram.ts`, `audit.ts`, `health.ts`

---

## 8. New Configuration Files

| File | Purpose |
|------|---------|
| `src/config/anc-risk-rules.ts` | Risk classification rules (4-tier, configurable) |
| `src/config/hospital-capabilities.ts` | Per-hospital capability thresholds and referral hierarchy |

---

## 9. Complete API Route Inventory

### 9.1 New Routes (13)

**Journey/Pregnancy:**
- `GET /api/journeys` — Province-wide journey list (filter: stage, risk, hospital)
- `GET /api/journeys/[journeyId]` — Journey detail with all relations
- `GET /api/journeys/[journeyId]/anc-visits` — ANC visit history
- `GET /api/hospitals/[hcode]/journeys` — Hospital ANC patient list

**Referrals:**
- `POST /api/referrals` — Initiate referral
- `PATCH /api/referrals/[id]/accept` — Accept
- `PATCH /api/referrals/[id]/reject` — Reject
- `PATCH /api/referrals/[id]/transit` — Mark in transit
- `PATCH /api/referrals/[id]/arrive` — Confirm arrival
- `GET /api/referrals` — List referrals
- `GET /api/dashboard/referrals` — Province referral overview

**Outcomes:**
- `GET /api/journeys/[journeyId]/newborns` — Birth outcomes
- `GET /api/dashboard/outcomes` — Neonatal KPIs

### 9.2 Modified Routes (4)
- `GET /api/dashboard` — Add stage KPIs, alerts
- `GET /api/patients/[an]` — Add journey context
- `POST /api/webhooks/patient-data` — Accept ANC + referral payloads
- `GET /api/sse/dashboard` — Add journey/referral/newborn event types

---

## 10. New Types

### 10.1 Domain Types (`src/types/domain.ts`)
- `CareStage` enum: PREGNANCY, LABOR, DELIVERED, POSTPARTUM
- `AncRiskLevel` enum: LOW, HR1, HR2, HR3
- `ReferralStatus` enum: INITIATED, ACCEPTED, REJECTED, IN_TRANSIT, ARRIVED
- `UrgencyLevel` enum: ROUTINE, URGENT, EMERGENCY
- `MaternalJourney` interface
- `CachedAncVisit` interface
- `CachedAncRisk` interface
- `CachedReferral` interface
- `CachedNewborn` interface

### 10.2 API Types (`src/types/api.ts`)
- `JourneyListResponse`, `JourneyDetailResponse`
- `AncVisitEntry`, `AncRiskEntry`
- `ReferralListResponse`, `ReferralDetailResponse`
- `NewbornKPIsResponse`
- `DashboardStageKPIs`, `DashboardAlerts`
- SSE event types: `journey_update`, `referral_update`, `newborn_update`

### 10.3 HOSxP Types (`src/types/hosxp.ts`)
- `HosxpPersonAncRow`, `HosxpAncServiceRow`
- `HosxpAncRiskRow`, `HosxpAncClassifyingRow`
- `HosxpLabourInfantRow`, `HosxpReferoutRow`

---

## 11. Testing Strategy

### 11.1 Unit Tests (Vitest + SQLite in-memory)
- **ANC Risk Engine**: Each rule in isolation, highest-level-wins logic, partial data handling, threshold edge cases
- **Journey Lifecycle**: Create from ANC, transitions (PREGNANCY→LABOR→DELIVERED), HN matching, auto-create for walk-in
- **Referral Service**: State machine transitions, capability checks, reject→re-route
- **Newborn KPIs**: LBW rate, Apgar distribution, multiple infant handling

### 11.2 Integration Tests
- **ANC Sync Pipeline**: HOSxP SQL → transform → upsert journey + visits + risks
- **Journey-Labor Linking**: ANC patient admitted → journey transition; walk-in → auto-create
- **Referral Flow**: Full lifecycle (initiate→accept→transit→arrive), rejection path
- **API Routes**: All new endpoints with auth, webhook ANC payloads, dashboard aggregation

### 11.3 E2E Tests (Playwright)
- **Dashboard**: Stage KPI cards, alert bar, expanded hospital table
- **ANC Registry**: Patient list with risk badges, filter by risk/GA
- **Journey Detail**: ANC timeline, vitals chart, risk history
- **Referral UI**: Alert→initiate flow, accept/reject at receiving hospital
- **Outcomes Page**: Neonatal KPI cards, birth weight distribution
