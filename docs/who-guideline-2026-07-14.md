# WHO-Aligned Antenatal Care Monitoring Gap Report and Implementation Plan

**System:** KK-LRMS

**Date:** 2026-07-14

**Status:** Proposed implementation plan; not an approved clinical protocol

**Primary scope:** Antenatal-care monitoring, provincial continuity, follow-up, and referral support

**Evidence base:** Current repository source/tests plus official WHO guidance available on 2026-07-14

**Decision owners:** Provincial obstetric lead, ANC nursing lead, public-health/MCH lead, health-informatics lead, privacy/security owner, and product/engineering owner

---

## 1. Executive Decision

KK-LRMS already has a useful provincial pregnancy registry, four-tier ANC risk model, longitudinal journey page, cross-stage labor/newborn linkage, worklists, and referral state machine. It is a strong foundation for province-level pregnancy monitoring and inter-hospital coordination.

It is **not yet safe or complete enough to claim WHO-aligned pregnancy monitoring**. The highest-risk defects are not missing screens or dashboards; they are incorrect information semantics and loss of continuity:

1. Missing BP, fetal heart rate, and haemoglobin can be classified and displayed as normal.
2. Missing source values are replaced with plausible healthy values before risk evaluation.
3. One hospital's ANC payload can delete or overwrite another hospital's visit history.
4. A missing gestational age can make the UI imply that all eight contacts are complete.
5. The system detects risks and missed care but does not provide an owned, auditable, closed-loop response workflow.
6. The built-in HOSxP adapters populate only part of the data model, while the UI and indicators do not expose data completeness.

The recommended strategy is an **additive ANC v2 pipeline**, activated gradually per hospital. Do not rewrite the pregnancy module or turn KK-LRMS into a replacement electronic medical record. First correct unknown-state semantics and source provenance; then add scheduling, tasks, referral linkage, indicators, and governance behind feature gates.

### Target result

When this plan is complete, KK-LRMS will be able to answer, with explicit evidence and provenance:

- Who is currently pregnant and whether the pregnancy outcome is confirmed or unresolved?
- Which ANC contacts and care activities are due, completed, late, missing, invalid, pending, or not applicable?
- Which clinical findings require action, who owns the action, when it is due, and how it was resolved?
- Which facility and source produced each clinical fact, and whether later syncs preserved the provincial history?
- What are the ANC1, first-contact-by-12-weeks, ANC4, ANC8, screening, prevention, and follow-up rates, with explicit denominator definitions and separately reported unknown and excluded counts?

### Release-blocking invariants

These are non-negotiable across every phase:

1. `missing`, `unknown`, `invalid`, `pending`, `not due`, `not applicable`, `stale`, `normal`, and `abnormal` are distinct states.
2. Missing or invalid clinical data never renders green, never counts as complete, and never becomes a fabricated healthy value.
3. Assessment completeness is separate from risk severity. A known high-risk finding remains high risk even when other inputs are missing; a low-risk classification requires an approved complete input set.
4. Missing or stale evidence can never lower a previously known risk.
5. One hospital or source can never delete, overwrite, or reattribute another hospital's clinical record.
6. Every imported record and derived assessment has source, time, and ruleset provenance; accepted source evidence is append-only and corrections/retractions create new versions.
7. Episode status, outcome verification, care responsibility, and operational closure remain separate. Transfer or closure never fabricates an outcome or marks a pregnancy ended; unresolved outcomes remain visible until source-confirmed or resolved through an approved reviewed-exception process.
8. Every actionable finding creates or updates one idempotent task with an owner, due time, acknowledgement, action, and resolution evidence.
9. Clinical thresholds, eligibility rules, due windows, and response times do not activate without recorded local clinical approval.
10. Rollback preserves imported clinical evidence, tasks, referrals, and audit history.

---

## 2. Authority, Scope, and Safety Boundary

### 2.1 What this report is

This report translates WHO guidance and the WHO ANC Digital Adaptation Kit into a repository-specific engineering and operational plan. It identifies what the current system supports, what is missing or unsafe, the proposed target architecture, phased work, acceptance criteria, rollout gates, and rollback conditions.

### 2.2 What this report is not

This document is not a clinical protocol and must not be used to set local treatment, referral, dose, contraindication, or emergency-response rules without approval. WHO recommendations must be adapted to current Thai Ministry of Public Health, Royal Thai College of Obstetricians and Gynaecologists, provincial referral-network, facility-capability, and privacy requirements.

### 2.3 Intended system role

KK-LRMS should remain:

- the provincial longitudinal pregnancy registry and coordination layer;
- a derived clinical read model from HOSxP, browser-push, and webhook source records;
- the source of truth for LRMS-owned tasks, acknowledgement, outreach, referral coordination, and audit state.

KK-LRMS should not become:

- the authoritative source encounter record;
- a prescribing or medication-ordering system;
- an autonomous diagnostic or referral engine;
- a mechanism that silently edits or deletes source observations;
- a patient-messaging platform until consent, confidentiality, language, opt-out, and delivery-channel controls are separately approved.

Corrections to imported facts must preserve the original source evidence and mark it superseded, retracted, or entered in error. Clinical corrections should be made in the source EHR and re-synced where possible.

### 2.4 Evidence boundary

The repository findings in this report are confirmed from current code and tests. This review did not inspect production databases, deployed external webhook senders, actual HOSxP field-population rates, or local clinical workflows at every hospital. A separate sender may populate more fields than the built-in adapters. Phase 0 therefore includes read-only production-shaped profiling before any clinical activation.

---

## 3. WHO Benchmark Used for This Plan

### 3.1 Primary sources

1. [WHO recommendations on antenatal care for a positive pregnancy experience (2016)](https://www.who.int/publications/i/item/9789241549912) — comprehensive routine ANC guideline.
2. [WHO summary of the eight-contact model (2016)](https://www.who.int/news/item/07-11-2016-pregnant-women-must-be-able-to-access-the-right-care-at-the-right-time-says-who) — first contact in the first 12 weeks, followed by contacts at 20, 26, 30, 34, 36, 38, and 40 weeks; a contact is care and support, not just a row or attendance event.
3. [WHO Digital Adaptation Kit for Antenatal Care (2021)](https://www.who.int/publications/i/item/9789240020306) — software-neutral workflows, core data elements, decision support, indicators, and functional/non-functional requirements for implementing ANC guidance digitally, including the linked Annex A data dictionary, Annex B decision logic, Annex C indicator table, and Annex D functional/non-functional requirements.
4. [WHO ultrasound-before-24-weeks update (2022)](https://www.who.int/publications/i/item/9789240046009) — current update to maternal and fetal assessment guidance.
5. [WHO antiplatelet agents for prevention of pre-eclampsia update (2021)](https://www.who.int/publications/i/item/9789240037540) — eligibility-dependent guidance that requires local clinical adaptation.
6. [WHO toolkit for adaptation of positive pregnancy and postnatal experience recommendations (2025)](https://www.who.int/publications/i/item/9789240105164) — method for local adaptation rather than copying global recommendations directly into software.
7. [WHO ANC facility-contact indicator metadata](https://www.who.int/data/gho/indicator-metadata-registry/imr-details/antental-care-contact%28s%29-in-a-facility) — ANC1, ANC4+, ANC8+, and age disaggregation.
8. [WHO standards for improving quality of maternal and newborn care in health facilities](https://www.who.int/publications/i/item/9789241511216) — cross-cutting quality context for information systems, referral, communication, dignity, workforce, and resources. Its detailed standards primarily cover labour, childbirth, and early postnatal care; this report does not treat them as direct ANC clinical requirements.
9. [WHO maternal intervention e-handbook](https://www.who.int/teams/maternal-newborn-child-adolescent-health-and-ageing/handbooks/programme-manager-s-handbook-mncah/recommendations-on-interventions-along-life-course/maternal) — current WHO programme-manager summary of major ANC interventions and timing; detailed source guidelines remain authoritative.
10. [WHO analysis and use of health facility data guidance (2023)](https://platform.who.int/docs/default-source/mca-documents/rmncah/9789240080331-eng.pdf?Status=Master&sfvrsn=91eaab3c_7) — facility-indicator, denominator, representativeness, reporting-completeness, and data-quality guidance.
11. [WHO SMART DAK for self-monitoring of blood pressure in pregnancy (2025)](https://smart.who.int/dak-smbp/v1.0.0/) — an additional option to clinic BP monitoring for people with hypertensive disorders of pregnancy, not a universal routine requirement.

### 3.2 Interpretation classes

Every implemented rule or indicator must carry one of these classes:

| Class | Meaning | Activation rule |
|---|---|---|
| `U` Universal routine ANC | Generally applicable routine-care expectation, such as the eight-contact model, respectful communication, or asking about substance use | May be proposed from WHO, but local wording/workflow still requires clinical approval |
| `N` National/provincial adaptation | Thailand-, province-, facility-, or referral-network-specific timing, threshold, form, or ownership rule | Must match an approved local source and effective date |
| `E` Eligibility-dependent | Applies only when risk, diagnosis, history, exposure, or contraindication criteria are met, such as aspirin, anti-D, or self-monitoring of BP | Disabled until eligibility, exclusions, dose/action, ownership, and escalation are approved |
| `C` Context-specific | Applies only in particular epidemiological or service settings, such as malaria IPTp or deworming policy | Disabled by default unless local policy explicitly enables it |
| `P` Programme indicator | Aggregate monitoring definition, not an individual clinical decision | Requires an approved numerator, denominator, exclusions, deduplication rule, and version |
| `HS` Health-system expectation | Staffing, competence, diagnostics, medicines, transport, referral capacity, communication, dignity, and other operational conditions that software cannot create | Treat as pilot/readiness evidence with a named operational owner; never claim compliance from a screen or table |
| `NR` Not routine/universal | Intervention not recommended as universal routine ANC, research-context-only, or outside the cited routine recommendation | Disabled unless a newer and locally approved source explicitly authorizes the target population and workflow |

### 3.3 Preliminary WHO capability-to-KK-LRMS matrix

This is a scope and traceability matrix, not an executable clinical protocol. WHO recommendations describe care. The KK-LRMS boundary is to record, support, route, and measure approved care without replacing clinical judgement, point-of-care documentation, trained staff, diagnostics, medicines, transport, or referral capacity.

| Class | WHO care/programme domain | Current KK-LRMS status | Appropriate implementation boundary |
|---|---|---|---|
| `U` | Minimum eight-contact model: first contact up to 12 weeks, followed by targets at 20, 26, 30, 34, 36, 38, and 40 weeks | Partial static helper in `src/services/anc-clinical.ts`; uniform windows can miss early booking; unknown GA can appear complete | Track dating provenance, planned contacts, qualifying encounters, due/unknown state, and care-content evidence. Exact early/late windows remain approved local policy |
| `U` | Respectful, individualized contact with relevant information, informed choice, and psychosocial support | Longitudinal journey exists, but counselling/choice/decline evidence and closed-loop action are incomplete | Record counselling, preference, decline, and follow-up evidence. Software cannot prove communication quality or respectful conduct by itself |
| `U` | Maternal/fetal assessment, risk identification, prevention, and early detection | Rich fields and risk model exist, but missing values can become normal/fabricated and ingestion paths differ | Preserve unknown/invalid/pending/declined status, provenance, and one versioned evaluator. Cadence and thresholds require approved Thai/provincial protocols |
| `U` | Healthy eating/physical-activity counselling and iron-folic-acid support | Supplement fields exist but are inconsistently populated; structured counselling, offer/decline, adherence, and action state are missing | Track offered/provided/declined/adherence/source status. HOSxP remains authoritative for prescribing and local policy governs formulation/dose |
| `U` | Tobacco exposure and alcohol/other substance enquiry | Some psychosocial fields exist, but adapter coverage, UI, and support/referral pathways are incomplete | Add restricted structured capture, safe display, and an approved support pathway; do not expose content in general worklists/reminders |
| `C` | Intimate-partner-violence enquiry where privacy, trained response, safe referral, and WHO minimum supportive conditions exist | A JSON field may store a result, but no proven restricted safe-response workflow exists | Keep disabled until privacy, responders, safe referral, access control, and escalation are operationally approved; do not combine this rule with universal substance enquiry |
| `U` | One imaging ultrasound before 24 weeks | Scan/dating fields and timing helpers exist, but completion, result, provenance, and follow-up are not consistently closed-loop | Track offer/completion/result/follow-up and dating provenance. Equipment, trained operators, diagnosis, counselling, and referral capacity remain health-system responsibilities |
| `U/N` | BP/weight and locally approved maternal assessment cadence; pre-eclampsia assessment after the approved GA threshold | BP/weight/protein fields exist, but nulls can be normal, BP can be fabricated, and findings are passive | Store actual measurements and missingness; generate only approved tasks. Do not invent cadence, thresholds, diagnosis, or treatment in software |
| `U/N` | Fetal growth, fundal height, and fetal-movement enquiry at approved gestations | Fields exist but source coverage is shallow and no approved trajectory/action model exists | First make trends/completeness visible; activate decision support only with current local rules and clinical capacity |
| `U/N` | Routine booking/locally approved tests such as Hb, blood group/Rh, HIV, syphilis, hepatitis B, and glucose testing | Many fields exist, built-in adapters populate only a subset, and positive results lack completion/management state | Track test status, source, result, acknowledgement, action, and resolution separately. Testing set/timing remains locally governed |
| `E` | Vaccination or prophylaxis based on previous exposure, Rh status, diagnosis, or risk eligibility | Vaccine/Rh fields exist but prior exposure, eligibility, contraindication, offer/decline, and management completion are incomplete | Model assessment, eligibility, administration/decline, and follow-up separately. Tetanus administration is exposure-dependent; anti-D/aspirin rules require current Thai/local authority |
| `U/N` | Birth/emergency preparedness, breastfeeding, and postpartum-family-planning counselling | Danger signs are displayed, but structured preparedness, counselling, preference, and completion evidence are missing | Add locally approved care-plan items and evidence; clinical counselling remains a human care process |
| `U/N` | Support for common physiological symptoms in pregnancy | No structured symptom/counselling follow-through was found | HOSxP remains the point-of-care record; ingest only the status/action evidence needed for provincial continuity or referral, not a treatment module |
| `C` | Malaria/IPTp, deworming, undernutrition/calcium, TB/HIV service models, community/home visits, and other setting-dependent interventions | Not represented consistently and some may be inapplicable locally | Keep off by default behind versioned national/provincial policy; do not turn a global catalogue into universal alerts |
| `E` | Self-monitoring BP for people with hypertensive disorders as an additional option to clinic monitoring | No dedicated pathway | Keep outside the initial universal scope; require eligibility, device/data quality, education, review ownership, and escalation approval |
| `P` | DAK workflows, data elements, decision support, scheduling, referral, indicators, and functional/non-functional requirements | Registration, journey, risk, and referral are partial strengths; source parity, appointments, task ownership, and reproducible indicators are incomplete | Use DAK as a software-neutral traceability reference. Proposed tables, APIs, state machines, and idempotency rules are local engineering controls, not verbatim WHO requirements |
| `P` | Facility ANC1, ANC4+, ANC8+, and approved age disaggregation | No reproducible suite; visit identity and denominator ascertainment are unsafe | Version definitions, episode deduplication, facility/contact scope, age bands, unknown/excluded counts, source watermarks, and privacy suppression |
| `HS` | Competent staff, diagnostics, medicines/supplies, functional referral/transport, actionable information, communication, dignity, emotional support, and physical resources | Referral/auth/audit foundations exist, but repository code cannot establish these conditions | Make them pilot-readiness and operational-governance gates with named owners; never claim WHO compliance from implemented software alone |
| `NR` | Routine antenatal CTG, routine Doppler ultrasound, and formal daily fetal-movement counting are not universal routine defaults in the 2016 guideline | Some fetal-surveillance fields exist and could be misread as universal care-plan items | Do not generate universal prompts. Distinguish reduced-movement enquiry from formal daily counting; require current/local approval for any eligible pathway |

The preliminary status must be replaced by a signed requirement-level traceability matrix in Phase 0. Repository files in `docs/pregnancy/` are evidence inputs, not proof of current clinical approval.

### 3.4 Proposed KK-LRMS capabilities informed by WHO guidance and DAK

WHO does not mandate a specific product or database schema. The DAK is software-neutral, illustrative, non-exhaustive, and intended for adaptation. For KK-LRMS, the proposed capabilities are:

- a pregnancy episode and reliable gestational-age/dating provenance;
- a contact plan and record of actual care contacts;
- maternal, fetal, laboratory, prevention, counselling, and psychosocial data with explicit missingness;
- decision support whose rules and source versions are auditable;
- follow-up for abnormal findings, missed contacts, referrals, and unresolved outcomes;
- data quality and programme indicators with reproducible denominators;
- confidentiality, respectful care, equity, and safe handling of sensitive screens;
- local adaptation and version governance when WHO or Thai guidance changes.

Eight contacts alone are therefore not sufficient evidence of quality, and a visit count is not proof that the expected content of care occurred.

---

## 4. Current System Baseline

### 4.1 Strengths to retain

| Capability | Current evidence | Decision |
|---|---|---|
| Longitudinal pregnancy episode | `src/db/tables/maternal-journeys.ts`; `src/services/journey.ts` | Retain `maternal_journeys` as the episode anchor |
| Cross-stage continuum | Pregnancy, labor, referral, and newborn tables share journey links | Preserve; do not isolate ANC v2 from labor/newborn flows |
| Rich ANC storage | `src/db/tables/cached-anc-visits.ts` and `src/db/tables/maternal-journeys.ts` contain vitals, labs, supplements, vaccines, fetal and psychosocial fields | Reuse existing typed columns; add provenance and repeatable-result support where needed |
| Four-tier provincial risk model | `src/config/anc-risk-rules.ts`; `src/services/anc-risk.ts`; `src/services/anc-screening.ts` | Version and make completeness-aware rather than replace wholesale |
| WHO/RTCOG timing helpers | `src/services/anc-clinical.ts` has eight contact targets plus RTCOG/anatomy/OGTT/GBS/Tdap/thalassemia checks | Correct semantics, centralize policy, and version it |
| Province worklists | `src/config/anc-ops.ts`; `src/services/journey-list.ts`; provincial pregnancy pages | Extend into owned workflows instead of building a separate dashboard |
| Referral lifecycle | `src/services/referral.ts`; referral API routes; `cached_referrals` | Link tasks/findings to existing referral transitions |
| Authentication, audit, encryption, logging | Existing middleware, audit tables/services, CID hashing/encryption, structured logger | Extend existing controls to new ANC resources |
| PostgreSQL-compatible test harness | PGlite helpers and schema sync | Keep for fast tests; add real PostgreSQL concurrency/migration CI |

### 4.2 Current architecture constraints

- `SchemaSync` creates tables and adds missing columns, but does not alter or remove existing constraints and silently catches index-creation errors (`src/db/schema-sync.ts`). Constraint changes require explicit idempotent migrations.
- Startup migrations are wired manually in `src/app/api/startup.ts`.
- `cached_anc_visits` currently has a unique index on `(journey_id, visit_date)`, which is insufficient for cross-hospital or multiple same-day contacts.
- Production uses `pg.Pool`; PGlite serializes access and cannot prove production concurrency behavior.
- Browser polling is the normal polling path, but legacy server polling and webhooks still affect parity and must use the same clinical contract.

---

## 5. Ranked Gap Assessment

| Priority | Gap | Repository evidence | Patient/program consequence | Target control |
|---|---|---|---|---|
| `P0 Critical` | Missing BP/FHR/Hb treated as normal | `src/services/anc-clinical.ts:26-44`; locked by `tests/unit/services/anc-clinical.test.ts:23-64`; green `OK` rendering in journey detail | False reassurance and suppressed follow-up | Explicit unknown/invalid states; no green or complete UI for missing data |
| `P0 Critical` | Healthy-value imputation before risk evaluation | `src/services/sync/anc.ts:204-244` substitutes height 160, BMI 22, BP 120/80, O2 98, Hct 36, Hb 12 | Missing assessment can be misclassified low risk | Remove imputation; separate completeness from risk severity |
| `P0 Critical` | Cross-hospital visit loss/re-attribution | `src/services/webhook.ts:1108-1175`; `src/services/sync/anc.ts:266-330`; unique `(journey_id, visit_date)` | Provincial history can shrink when another hospital syncs | Stable source identity, source-scoped reconciliation, atomic upserts |
| `P0 Critical` | Unknown GA can imply eight contacts complete | `nextContactDue` and detail UI completion behavior | Missed care is hidden when dating data is absent | `UNKNOWN_GA` state and outcome-verification worklist |
| `P1 High` | Contact algorithm uses uniform ±1-week windows and can mis-handle first contact | `src/services/anc-clinical.ts:48-78`; existing tests pin current behavior | A valid week-8 booking may not count; one encounter may match more than one target | Contact-plan model, approved windows, one encounter per planned contact |
| `P1 High` | Built-in source adapters populate different subsets | Server polling, browser polling, Pascal webhook adapter, and API fields differ | Clinical meaning depends on delivery path | One versioned normalized ANC ingestion contract and mapper parity tests |
| `P1 High` | Webhook visit validation is shallow | `src/services/webhook.ts:500-562` validates identity/dates more than clinical content | Malformed ranges/enums/units can reach storage | Boundary validation, quarantine, per-patient atomic result |
| `P1 High` | Risk differs by ingestion path | Polling calculates with imputation; webhook uses declared risk/item IDs | Same woman can receive different assessments by source | One post-persistence evaluator; declared and derived risk stored separately |
| `P1 High` | Passive alerts without closed-loop ownership | Danger signs and abnormal values are chips; dashboard focuses on referral/stale/due counts | Detection does not prove response | Idempotent clinical task state machine linked to referral and resolution evidence |
| `P1 High` | No appointment/no-show/outreach workflow | Worklists exist, but journey APIs are read-only and no owned follow-up state was found | Missed contact has no accountable next action | Contact plan, appointment, outreach attempt, escalation, closure workflow |
| `P1 High` | Outcome inferred from time rather than confirmed | Freshness/ops rules treat very late GA/staleness as delivered or closed | Ongoing or unrecorded pregnancy can disappear | Confirmed outcome/transfer/closure status; unresolved worklist |
| `P1 High` | 500-row active-ANC cap without pagination | Polling/browser query limits | Pregnancies can be silently omitted in larger facilities | Watermarked pagination with completeness counters |
| `P2 Medium-High` | Stored fields not shown or acted upon | Psychosocial, urine culture/ketone, vitamins, and other fields are returned but absent from the journey page's local type | Clinicians cannot see or close the loop on captured data | Authorized structured display and task routing |
| `P2 Medium-High` | No structured assessment/care-plan follow-through | No ANC problem, care-plan, result acknowledgement, adherence, or resolution model | Positive tests and preventive gaps remain informational | Focused problem/result/care-plan items, not full EHR order entry |
| `P2 Medium` | Maternal/fetal growth trends lack decision support | Weight, fundal height, EFW stored/displayed without approved trajectory rules | Possible growth concerns depend on manual interpretation | Versioned local rules only after clinical approval; initially display trends/completeness |
| `P2 Medium` | No WHO programme indicator suite | Dashboard is operational/risk oriented; no ANC1/4/8 or content-coverage definitions | Province cannot measure coverage or data quality consistently | Versioned indicators with numerator, denominator, and unknown count |
| `P2 Medium` | Identity excludes some patients | Invalid/non-Thai 13-digit CID can be skipped; no alternative identifier workflow | Migrant/non-Thai/unidentified women may be omitted or duplicated | Hospital identifiers plus verified alternate identity and manual merge workflow |
| `P2 Medium` | Current log redaction does not cover common patient-name/HN keys or PHI embedded in error messages | `src/lib/logger.ts` redacts CID/tokens but not HN/name keys and serializes error message/stack | New ingestion/task telemetry could disclose PHI | Expand structured redaction and prohibit PHI-bearing error text; add negative logging tests before new telemetry |
| `P3` | No standards-based terminology/provenance mapping | Custom fields have limited standard coding | Harder exchange and guideline evolution | Map key fields to approved terminology incrementally; do not block safety phases |

---

## 6. Target Operating Model and Architecture

### 6.1 Architectural decision

Choose an additive compatibility architecture:

```text
HOSxP / browser push / webhook
              |
      source-specific mapper
              |
      NormalizedAncBundleV2
              |
 provenance + validation + idempotency
              |
  canonical provincial ANC projection
              |
 risk / contact / care-plan evaluators
              |
 tasks / appointments / referrals / outcome verification
              |
 UI / indicators / reconciliation / audit / observability
```

The existing pregnancy pages and tables continue to work during rollout. New writes are additive, v2 calculations run in shadow mode, and reads switch per hospital only after reconciliation passes.

### 6.2 Options considered

| Option | Decision | Rationale |
|---|---|---|
| Patch only the UI | Reject | Does not fix fabricated inputs, destructive ingestion, provenance, or follow-up ownership |
| Rewrite ANC as a new standalone service | Reject for this programme | High migration and operational risk; duplicates existing journey/auth/referral foundations |
| Keep LRMS passive and rely entirely on HOSxP | Reject | Cannot reliably monitor cross-hospital continuity, province-level coordination, referral, or unresolved care |
| Add an ANC v2 boundary inside the current application | **Choose** | Corrects high-risk semantics first, preserves compatibility, and permits controlled rollout |

### 6.3 Canonical assessment model

Do not add `UNKNOWN` as another severity beside `LOW`, `HR1`, `HR2`, and `HR3`. Completeness and severity are orthogonal:

```ts
type ClinicalDataStatus =
  | 'UNKNOWN'
  | 'INVALID'
  | 'PENDING'
  | 'NOT_DUE'
  | 'NOT_APPLICABLE'
  | 'NOT_PERFORMED'
  | 'PATIENT_DECLINED'
  | 'CURRENT'
  | 'STALE';

type AssessmentStatus =
  | 'UNASSESSED'
  | 'INCOMPLETE'
  | 'COMPLETE'
  | 'STALE'
  | 'LEGACY_UNVERIFIED';

interface AncAssessmentV2 {
  status: AssessmentStatus;
  riskLevel: AncRiskLevel | null;
  missingRequired: string[];
  invalidInputs: string[];
  triggeredRules: string[];
  rulesetVersion: string;
  evaluatedAt: string;
  inputSnapshotHash: string;
}
```

Examples:

- Missing BP: `UNKNOWN`, never normal.
- Valid BP 120/80: `CURRENT` plus a normal interpretation.
- Known high-risk finding with missing BMI: `INCOMPLETE` plus the applicable high-risk level.
- All approved mandatory inputs valid and no rule triggered: `COMPLETE + LOW`.
- Existing unverified low-risk rows: `LEGACY_UNVERIFIED`, not automatically confirmed low.

### 6.4 Contact and schedule model

Maintain separate concepts:

1. **Recorded ANC contact count:** distinct qualifying encounters.
2. **WHO scheduled-contact adherence:** mapping to contact 1 through contact 8 using approved windows.
3. **WHO timing measure:** first qualifying ANC contact by the approved interpretation of 12 completed weeks.
4. **RTCOG/MOPH local timing or visit indicators:** separately labelled and versioned.
5. **Content-of-care completion:** expected activities completed, pending, missing, declined, or not applicable.

Rules:

- Contact 1 accepts a valid pregnancy ANC contact from pregnancy confirmation up to the locally approved exact boundary for WHO's “up to 12 weeks” wording; a week-8 contact is not rejected because it is outside a ±1-week band around week 12.
- A late first contact remains the first recorded contact but fails the first-contact-by-12-weeks timing measure.
- One encounter completes at most one planned contact. This is a local safety/counting control for KK-LRMS, not verbatim WHO text.
- Eight completed contacts require eight distinct qualifying encounters.
- A database visit row alone does not necessarily prove a qualifying contact; the clinical committee must approve the minimum documentation/content contract.
- WHO target weeks are not software due windows. Early/late windows and escalation timing must be locally approved and versioned.
- Unknown GA yields an unknown schedule state, not “complete.”

### 6.5 Gestational-age and dating model

Create one shared `effectiveGestationalAge()` policy used by list, detail, contact, alert, and indicator code. It must return:

- GA weeks/days;
- calculation timestamp;
- dating method (`ART`, approved ultrasound dating, LMP, EDC-derived, source-recorded, unknown);
- source and source time;
- confidence/quality state;
- inconsistency flags.

Do not silently overwrite source GA. When dates conflict beyond an approved tolerance, preserve each source value, mark the effective calculation disputed, and create a data-quality review item.

### 6.6 Closed-loop state model

Use a conditional, auditable state machine similar to referral transitions:

```text
OPEN -> ACKNOWLEDGED -> IN_PROGRESS -> RESOLVED
  |          |              |
  +----------+--------------+-> CANCELLED (reason required)
  +---------------------------> ESCALATED

RESOLVED -> REOPENED only when new evidence or reviewed correction exists
```

Every task requires:

- deterministic trigger key;
- journey and source finding/contact reference;
- type, severity/priority, assigned hospital and optional user;
- due time from an approved ruleset;
- acknowledgement, action, escalation, and resolution timestamps;
- resolution code and evidence reference;
- append-only transition events and audit actor.

Creating a referral does not resolve the clinical task. Resolution requires an approved outcome such as arrival, reviewed management completion, or explicit transfer of responsibility.

### 6.7 Immutable source evidence and replay model

Mutable canonical rows are not sufficient clinical provenance. Use two layers:

1. **Append-only source record versions:** every accepted visit/result/patient correction or retraction becomes a new immutable version with source identity, schema version, source/received time, payload hash, normalized encrypted evidence, `supersedes_id`, and retention class.
2. **Current v2 projections:** queryable visit/result rows point to the active source version and may be rebuilt from immutable versions. Superseded/retracted versions remain available to authorized audit/replay workflows.

An ingestion event containing only a hash proves delivery/idempotency but cannot reproduce the record. Therefore:

- retain the minimum normalized source evidence required for replay, encrypted and access-controlled under an approved retention schedule;
- store raw source payloads only in a separately approved encrypted quarantine/staging store when needed for diagnosis, with short retention and restricted access;
- append a tombstone/retraction version instead of deleting source evidence;
- define deterministic projection selection for newer, corrected, retracted, and entered-in-error versions;
- provide an authorized replay job that rebuilds shadow projections from retained versions, or explicitly refetches by source watermark when retention policy does not permit local evidence storage;
- audit every replay and prohibit replay from emitting duplicate tasks/referrals.

---

## 7. Proposed Data and Code Changes

Names below are implementation proposals. Phase 0 may refine names, but not the safety contracts.

### 7.1 Extend `maternal_journeys`

Modify `src/db/tables/maternal-journeys.ts` additively:

- `anc_assessment_status`
- `anc_risk_level_v2` nullable
- `anc_risk_ruleset_version`
- `anc_risk_assessed_at`
- `pregnancy_episode_status` (for example active, outcome recorded, review required, closed)
- `outcome_verification_status` (not due, pending source confirmation, verified, disputed)
- `care_responsibility_status` and optional responsible hospital
- `closure_status`
- `closure_reason`

Keep legacy `anc_risk_level` during rollout, but stop using its default `LOW` as evidence of a completed assessment.

Pregnancy outcome, operational closure, and transfer of care are separate concepts. Transfer never means the pregnancy ended. Store source-proven outcome events in a child table rather than one scalar journey outcome so multiple fetuses/newborns and corrected evidence can be represented.

The current table also requires non-null `hn`, `cid`, and `cid_hash`. Before accepting alternate-ID pregnancies, add an explicit migration that makes these legacy identifiers nullable, update every reader/matcher to be null-safe, and make the journey UUID plus verified identifier records the episode identity. Do not insert an empty or fabricated CID/HN merely to satisfy the old schema.

### 7.2 Preserve legacy `cached_anc_visits` and add a v2 visit projection

Do not make the existing table the v2 canonical store. Its unique `(journey_id, visit_date)` constraint conflicts with same-day cross-hospital visits, and removing it early would make rollback to the previous writer unsafe.

Keep `cached_anc_visits` as the legacy compatibility projection during the rollout and add `anc_visits_v2` with the existing typed clinical fields plus:

- `source_system`, `source_record_id`, and `source_updated_at`;
- `active_source_version_id` and `ingestion_event_id`;
- `record_status` (`ACTIVE`, `SUPERSEDED`, `RETRACTED`, `ENTERED_IN_ERROR`);
- `provenance_confidence` (`AUTHORITATIVE`, `INFERRED`, `LEGACY_UNKNOWN`);
- `data_quality_flags_json` and `updated_at`.

The v2 active projection uses a stable source key such as `(hospital_id, source_system, source_record_id)`. A legacy deterministic source ID may be derived from hospital, person ANC ID, date, and visit number only when necessary and must be labelled `INFERRED`.

Immediate containment must prevent current v1 code from overwriting or deleting another hospital's record; a same-day cross-hospital conflict may be explicitly rejected/quarantined during containment, but never silently overwrite existing evidence. The old index is removed only in a separate legacy-retirement release after the rollback window has closed, if the legacy table remains at all.

### 7.3 Extend `cached_anc_risks`

Add:

- `assessment_status`
- `ruleset_version`
- `input_snapshot_json` or a non-PHI reproducible evidence reference
- `missing_required_json`
- `invalid_inputs_json`
- `source_event_id`
- `evaluated_at`

Keep source-declared risk separate from LRMS-derived risk. Never overwrite one with the other.

### 7.4 Add focused tables

Register every new table in dependency order in `src/db/tables/index.ts`.

| Proposed table | Purpose | Minimum fields/constraints |
|---|---|---|
| `maternal_journey_identifiers` | Hospital-specific and alternate identity | journey, hospital, type, encrypted value, keyed lookup hash, verification status, source, active/superseded; weak identities never auto-merge |
| `anc_ingestion_events` | Trace every source delivery | hospital, source, schema version, delivery mode/boundary, idempotency key, payload hash, source/received timestamps, watermarks, accepted/rejected counters, status/error code; unique source idempotency key |
| `anc_source_record_versions` | Immutable replay/audit evidence | entity type, source key/version, encrypted normalized evidence, payload hash, observed/source/received time, `supersedes_id`, record status, retention class; append-only |
| `anc_visits_v2` | Current structured visit projection | typed visit fields, journey/hospital, stable source key, active source version, quality/provenance/status; unique stable source key |
| `anc_clinical_results` | Repeatable labs, imaging, and screens with provenance | journey, optional visit, code, value/unit, result status, observed time, source-version identity, supersession/status; retain compatibility projections initially |
| `pregnancy_outcome_events` | Source-proven episode/fetus/newborn outcomes | journey, event type/time, source version, verification state, optional fetus sequence/newborn link, supersession/status; supports multiple births and corrected evidence |
| `clinical_guideline_versions` | Bind approved source/local adaptation to executable logic | authority, title, source reference/checksum, local version/effective dates, approval/approvers, executable ruleset ID/checksum, build/Git SHA; immutable once active |
| `anc_contact_plans` | Individual planned contacts | journey, contact code, target/window dates, status, completion visit, guideline version; unique journey/contact/version |
| `anc_care_plan_items` | Screening, prevention, counselling, and birth-preparedness monitoring | journey, item code/class, due window, eligibility status, completion/evidence, guideline version |
| `clinical_tasks` | Owned action for abnormal/missing/missed/unresolved care | trigger key, journey, finding/contact, type, priority, owner, due time, status, resolution; unique open trigger semantics |
| `clinical_task_events` | Append-only task transition audit | task, from/to status, actor, timestamp, reason, metadata |
| `anc_appointments` | Scheduled contact and no-show state | journey/contact plan, facility, scheduled time, status, prior appointment link, source, owner |
| `maternal_contact_preferences` | Safe-contact authorization | journey, contact allowed/do-not-contact, consent source/time/expiry, preferred language/channel/time, shared-phone restriction, neutral-content instruction |
| `patient_contact_attempts` | Reminder/outreach attempt history | journey/task/appointment, authorized preference version, channel, attempted by/at, result, next action; sensitive content excluded |
| `anc_indicator_snapshots` | Reproducible aggregate results | scope/period, hospital/geography, indicator/cohort version, numerator/denominator/unknown/excluded counts, as-of time, source watermarks, calculation build/ruleset; no patient identifiers |

Do not build a generic medication-ordering module. If treatment/adherence information is needed for monitoring, represent it as source-derived results or care-plan completion evidence, while HOSxP remains the authoritative clinical record.

### 7.5 Proposed service boundaries

Create or refactor toward:

- `src/types/anc-ingestion.ts` — v2 source contract and normalized types.
- `src/services/anc-normalization.ts` — source mapping only; no risk calculation.
- `src/services/anc-ingestion.ts` — validation, identity resolution, transaction, idempotency, append-only source versions, and source-scoped reconciliation.
- `src/services/anc-evidence.ts` — authorized version selection, supersession, retention, and replay into shadow projections.
- `src/services/anc-projection.ts` — recompute journey summary from all active provincial records.
- `src/services/anc-assessment.ts` — completeness-aware, versioned risk assessment.
- `src/services/anc-scheduling.ts` — effective GA, contact plan, appointments, missed-contact detection.
- `src/services/anc-care-plan.ts` — eligibility and content-of-care status.
- `src/services/clinical-task.ts` — state transitions and idempotent task generation.
- `src/services/anc-indicators.ts` — versioned aggregate calculation.
- `src/services/anc-reconciliation.ts` — v1/v2 and source/canonical comparison.
- `src/config/anc-guidelines/` — reviewed executable TypeScript rules and test vectors.

Executable clinical logic should remain reviewed, version-controlled TypeScript. The database stores activation and approval metadata; it must not execute arbitrary database-authored clinical code.

At startup, ANC v2 readiness must fail if the database-selected active guideline version is missing, outside its effective interval, unapproved, or does not match the executable ruleset/build checksum. A mismatched version never falls back silently to the newest code.

### 7.6 `NormalizedAncBundleV2` contract

Require:

- `schemaVersion`
- `sourceSystem`
- `sourceHospitalCode`
- `deliveryMode: INCREMENTAL | SNAPSHOT`
- `idempotencyKey`
- `sourceGeneratedAt`
- stable source IDs and update timestamps for patients, visits, and results
- explicit absent/null values without healthy substitution
- a declared snapshot boundary when `deliveryMode=SNAPSHOT`

Processing rules:

1. Webhook, browser-push, and maintained polling paths call the same normalizer and writer.
2. Source adapters map fields only; they do not calculate or persist derived risk.
3. Validate types, enumerations, units, plausible ranges, timestamps, and GA/date consistency.
4. Severe but plausible data is accepted and escalated; impossible/malformed data is quarantined with field-specific codes.
5. Processing is per-patient atomic: one invalid patient cannot silently discard all other valid patients in the bundle.
6. Incremental payloads never delete.
7. A snapshot may append a tombstone/retraction version only for records from the same hospital/source and only inside its explicit complete boundary; it never deletes or overwrites the prior version.
8. Omitted visits mean no change unless an authoritative snapshot contract explicitly says otherwise.
9. Older `source_updated_at` data cannot overwrite newer evidence.
10. A correction/retraction appends an immutable source version and updates the active projection; it never overwrites the prior version.
11. Journey counts and dates are recomputed from stored active provincial records, never copied from the current payload's count.
12. Tasks, projections, audit, and clinical facts commit transactionally; SSE/event notification occurs only after commit.
13. Replay into a shadow projection is deterministic and cannot emit duplicate tasks, referrals, or notifications.
14. Every sync returns accepted, updated, unchanged, quarantined, conflict, and rejected counters without PHI.

### 7.7 API and authorization surfaces

Proposed routes should follow existing API error and authorization patterns:

- `GET /api/journeys/:id/anc-plan`
- `GET /api/journeys/:id/clinical-tasks`
- `POST /api/journeys/:id/clinical-tasks/:taskId/acknowledge`
- `POST /api/journeys/:id/clinical-tasks/:taskId/transition`
- `GET|POST /api/journeys/:id/appointments`
- `POST /api/journeys/:id/outreach-attempts`
- `GET /api/dashboard/anc-indicators`
- `GET /api/admin/anc-reconciliation`
- `GET|POST /api/admin/clinical-guidelines`

Hospital users may see and act only within approved current/referral/coordination relationships. Provincial users may monitor the province according to their existing scope. Sensitive psychosocial results require a narrower permission than general pregnancy-detail access. Aggregate indicator responses must contain no CID, HN, name, free-text notes, or row-level drill-through without separate authorization.

### 7.8 Authorization contract

The current domain has only `OBSTETRICIAN`, `NURSE`, and `ADMIN`, plus `readwrite`/`readonly` access mode. Existing journey handlers are broadly authenticated and accept journey/hospital selectors without a complete handler-level relationship check. The proposed mutation routes are not automatically covered by the middleware readonly prefix list. Do not assume role names or middleware alone are sufficient.

Define capabilities and hospital relationships explicitly before adding routes:

| Action | Minimum role/capability | Relationship/scope | Access mode |
|---|---|---|---|
| Read routine journey/plan/task summary | Approved clinical or monitoring capability | current hospital, source hospital, active referral/coordination relationship, or approved provincial monitoring scope | `readwrite` or explicitly approved `readonly` |
| View sensitive psychosocial detail | Separate sensitive-ANC capability | active care relationship and minimum-necessary purpose | `readwrite`; readonly disabled unless privacy owner explicitly approves |
| Acknowledge/transition clinical task | Approved clinical-action capability; `ADMIN` alone is not clinical authority | assigned/responsible hospital or explicit transfer/referral relationship | `readwrite` only |
| Create/reschedule appointment or record outreach | Approved clinical/coordination capability | responsible hospital and valid safe-contact preference | `readwrite` only |
| Create/transition referral | Existing referral-party and role controls plus task relationship | from/to party as required by transition | `readwrite` only |
| View aggregate indicators | Monitoring/admin capability | de-identified authorized geography | approved `readonly` or `readwrite` |
| Activate guideline/configuration | Authorized allowlisted admin plus recorded clinical approval | configured province/system | `readwrite` only; cannot author executable clinical code in DB |
| Replay/reconcile source evidence | Restricted informatics/audit capability | approved source/hospital and purpose | `readwrite`, separately audited |

Every handler must call reusable server-side guards for session, access mode, hospital/journey relationship, capability, and sensitive-data scope before loading or mutating data. Add the route prefixes to middleware readonly blocking only as defence in depth. Required negative tests include arbitrary `hospital_id`, arbitrary journey UUID, cross-hospital task transition, readonly POST, `ADMIN` without clinical capability, referral non-party, sensitive-screen access, and aggregate drill-through.

---

## 8. Implementation Phases

### Immediate Safety Containment — before ANC v2 development

**Objective:** Stop new false-normal and cross-hospital-loss behavior without changing unapproved clinical thresholds.

#### Work

- [ ] Change BP, FHR, Hb, urine, fetal-movement, and related interpretation helpers so null/partial data returns explicit unknown or incomplete.
- [ ] Change journey detail/list badges: missing is neutral/amber “not recorded,” never green `OK`.
- [ ] Change `nextContactDue` and UI language so unknown GA says schedule cannot be determined; never “8 contacts complete.”
- [ ] Remove healthy default substitutions from `src/services/sync/anc.ts` and pass nulls into the completeness-aware boundary.
- [ ] Prevent incomplete assessments from being persisted or displayed as confirmed `LOW`.
- [ ] Prevent automatic risk downgrade when evidence is missing, stale, or older than the current assessment.
- [ ] Scope any current visit replacement to the source hospital as a temporary guard; explicitly reject/quarantine same-day cross-hospital conflicts rather than overwrite. The durable fix is the Phase 2 v2 source projection.
- [ ] Add non-PHI logs/metrics for attempted cross-source replacement, missing mandatory inputs, and incomplete assessments.

#### Acceptance gate

- `sev*(null)` tests expect unknown.
- Partial BP cannot be normal.
- No missing field or schedule state renders green or complete.
- No synthetic normal value reaches storage or risk evaluation.
- A hospital B payload cannot reduce, overwrite, or reattribute hospital A's visit rows; an unrepresentable legacy conflict is explicit and observable.
- Existing clinical thresholds remain unchanged unless separately approved.

### Phase 0 — Clinical Specification, Regression Guardrails, and Data Profiling

**Objective:** Freeze definitions and measure real source quality before migrations or workflow activation.

#### Clinical/governance work

- [ ] Create a traceability matrix linking each implemented item to WHO, RTCOG/MOPH/provincial source, interpretation class, version, effective date, owner, and approval state.
- [ ] Approve the minimum qualifying ANC-contact data contract.
- [ ] Approve rules for GA dating priority, conflict tolerance, and schedule windows.
- [ ] Approve mandatory risk inputs and the behavior of incomplete/high-risk combinations.
- [ ] Approve urgent/routine task types and response ownership; do not invent clinical SLAs in code.
- [ ] Approve eligibility-dependent items such as aspirin, calcium, anti-D, home BP monitoring, and fetal surveillance before enabling decision support.
- [ ] Approve safe, restricted workflows for depression, substance use, and intimate-partner violence.
- [ ] Approve indicator numerators, denominators, exclusions, and age/geography disaggregation.
- [ ] Approve the distinction between source completeness, LRMS-registry cohort rates, facility rates, and population/provincial coverage.
- [ ] Approve safe-contact consent, language/channel/time, shared-phone, do-not-contact, and neutral-content requirements before any manual or automated outreach.
- [ ] Approve clinical-evidence, quarantine, task, audit, and indicator retention/deletion schedules.

#### Engineering/data work

- [ ] Add failing tests for every release-blocking invariant before behavior changes.
- [ ] Build read-only, de-identified profiling by hospital and source: row counts, field completeness, invalid ranges, duplicate source candidates, null hospital IDs, same-day visits, GA conflict, unresolved outcomes, and data lag.
- [ ] Measure the impact of the 500-row cap and identify facilities requiring pagination.
- [ ] Inventory every active sender/version: browser HOSxP query, webhook Pascal unit, custom sender, and any legacy server poller.
- [ ] Capture de-identified production-shaped replay fixtures for each source path.
- [ ] Define source snapshot semantics in `docs/WEBHOOK-SPEC.md`; absence of a declared boundary means incremental.
- [ ] Establish backup, restore, and reconciliation runbooks.
- [ ] Define the role/capability/access-mode/hospital-relationship authorization matrix and add failing negative tests for current journey access gaps.
- [ ] Add logging tests proving HN, name, identifiers, sensitive screens, and PHI-bearing errors cannot reach structured logs.

#### Deliverables

- Approved clinical traceability matrix.
- Golden clinical safety fixtures.
- Data-quality baseline by source/hospital.
- Versioned v2 ingestion contract.
- Migration preflight report and rollback rehearsal plan.

#### Acceptance gate

- No clinical rule or task generation is enabled.
- Every golden case has a signed expected result.
- Production-shaped source completeness is known rather than inferred from schema.
- Ambiguous identity and visit-source records have a review path, not an automatic rewrite.

### Phase 1 — Additive Schema, Provenance, and Guideline Governance

**Objective:** Add backward-compatible storage needed for safe ingestion and audit.

#### Work

- [ ] Add v2 domain types and assessment completeness states.
- [ ] Add assessment/episode/outcome-verification/care-responsibility columns to the journey table without conflating them.
- [ ] Add focused tables from section 7.4 and register them in `ALL_TABLES` in dependency order.
- [ ] Add the append-only source-version store and separate `anc_visits_v2` projection; leave the legacy visit index intact during the rollback window.
- [ ] Add an explicit idempotent migration making legacy HN/CID fields nullable only after all affected readers/matchers are null-safe.
- [ ] Add explicit idempotent migrations for v2 partial/conditional indexes that `SchemaSync` cannot safely manage.
- [ ] Add migration preflight that reports dirty/ambiguous rows without rewriting or deleting them.
- [ ] Wire migrations in `src/app/api/startup.ts` with an explicit status/readiness outcome.
- [ ] Add feature flags with production defaults off: v2 writes, v2 projection, v2 reads, task generation, indicator publication, and sensitive-screen display.
- [ ] Store guideline source/local version, approval/effective interval, executable ruleset checksum, and build/Git SHA; enforce startup mismatch failure for ANC v2.

#### Migration safety

- Add nullable columns first.
- Create new non-destructive indexes before switching writers.
- Backfill provenance only when evidence exists; use `INFERRED` or `LEGACY_UNKNOWN`, never fabricate authority.
- Do not drop the legacy visit uniqueness constraint during v2 deployment. The new table carries the correct source key, and legacy index removal—if needed—is a separate retirement release after rollback to the old writer is no longer required.
- A failed clinical-invariant migration must not be hidden by `SchemaSync`'s caught index error. The ANC v2 readiness gate remains false.
- The previous application image must start and serve existing pregnancy/referral reads against the expanded schema.

Two-release choreography:

1. **Release A:** deploy null-safe readers, additive v2 tables, immutable version storage, feature flags, dormant/shadow-capable writer, migrations, and readiness checks. Keep every v2 flag off.
2. **Release B:** after preflight/backup/restore verification, enable append-only evidence plus shadow v2 projection for an allowlisted hospital. The legacy table/index and v1 read path remain available for rollback.
3. **Later retirement release:** after at least one stable release and signed reconciliation, disable legacy writes/reads. Only then consider dropping the old index/table in a separately rehearsed migration.

If startup crashes before a migration transaction commits, PostgreSQL rolls it back and ANC v2 remains not ready. If it crashes after schema commit but before app readiness, the idempotent migration reruns, checksum/state verification completes, and feature flags remain off. No partially completed migration step may enable a writer.

#### Acceptance gate

- Fresh-schema creation passes on PGlite and PostgreSQL 16.
- Every explicit migration passes twice with no additional effect.
- Dirty-data preflight produces a de-identified report and changes no clinical row.
- Migration failure rolls back its transaction and keeps ANC v2 disabled.
- Legacy pages, existing referrals, and labor/newborn linkage remain readable.

### Phase 2 — Provenance-Safe, Canonical Ingestion

**Objective:** Make all maintained source paths produce one idempotent canonical record without healthy imputation or cross-hospital loss.

#### Work

- [ ] Implement `NormalizedAncBundleV2` types, validator, normalizer, and writer.
- [ ] Version browser/webhook payloads and include stable source IDs, source timestamps, idempotency keys, and delivery mode.
- [ ] Route browser push, webhook, and maintained legacy polling through the same normalized writer.
- [ ] Remove global journey visit deletion and date-only upsert logic.
- [ ] Append immutable source versions and atomically update `anc_visits_v2` by hospital/source/source-record ID; reject stale active-projection changes without deleting the received evidence.
- [ ] Add source-scoped snapshot retraction by appending tombstone versions only after snapshot boundaries are proven.
- [ ] Record every ingestion event and per-patient result.
- [ ] Implement retention-governed encrypted evidence replay/refetch and prove replay cannot duplicate tasks/referrals.
- [ ] Store source-declared risk separately; calculate derived risk after canonical persistence.
- [ ] Recompute journey summary from all active provincial visits.
- [ ] Add watermarked/keyset pagination for 501+ active pregnancies.
- [ ] Emit SSE only after transaction commit.

#### Acceptance gate

- Replaying one event 100 times stores one active canonical source record.
- Replaying or correcting an event retains all immutable versions while selecting exactly one current projection.
- Same-day visits at two hospitals coexist.
- Hospital A snapshots cannot change hospital B records.
- Older events cannot overwrite newer evidence.
- Omitted visits do not delete data.
- Browser/webhook fixtures normalize to equivalent records.
- Pagination ingests all eligible pregnancies exactly once.
- Transaction failure leaves no partial clinical facts, projection, or task.

### Phase 3 — Reconciliation, Identity, and Shadow Projection

**Objective:** Safely bridge legacy data to v2 without rewriting uncertain history.

#### Work

- [ ] Populate hospital-specific journey identifiers and verified alternate identifiers.
- [ ] Make HN/CID/cid_hash optional in the v2 episode contract; never generate placeholders to satisfy the legacy schema.
- [ ] Add a manual review queue for weak/ambiguous matches; never automatically merge weak identities.
- [ ] Backfill visit provenance with explicit confidence.
- [ ] Mark existing risk rows `LEGACY_UNVERIFIED` unless reproducible inputs/ruleset are available.
- [ ] Recompute v2 visit count, last contact, effective GA, contact plan, and assessment in shadow mode.
- [ ] Compare v1/v2 results by hospital using a de-identified reconciliation report.
- [ ] Explain every divergence category: fixed bug, source incompleteness, identity ambiguity, rule-version difference, or implementation defect.
- [ ] Preserve raw legacy fields until at least one stable release after v2 read activation.
- [ ] Build source-proven pregnancy outcome events and keep episode status, outcome verification, care responsibility, and closure separate; link fetus/newborn-specific outcomes where applicable.

#### Acceptance gate

- No backfill deletes a source row.
- Every visit has authoritative, inferred, or legacy-unknown provenance.
- Ambiguous patients remain separate and visible for review.
- Unavailable/non-Thai CID, repeated pregnancy, distinct episodes with similar demographics, reversible merge/split, and multiple-birth outcome fixtures pass.
- Provincial cross-hospital visit totals never decrease due to reconciliation.
- Clinical/data owners approve the reconciliation report before v2 reads are enabled.

### Phase 4 — Versioned Clinical Assessment, Contact Plans, and Care Plans

**Objective:** Calculate reproducible, completeness-aware monitoring state.

#### Work

- [ ] Centralize guideline/ruleset selection and effective-date logic.
- [ ] Implement the assessment model from section 6.3.
- [ ] Implement one shared effective-GA function with provenance/conflict state.
- [ ] Generate individual contact plans from reliable dating evidence.
- [ ] Correct first-contact logic and enforce one encounter per planned contact.
- [ ] Separate WHO ANC8, first-contact-by-12-weeks, RTCOG/MOPH local, facility-contact, schedule-adherence, and content-of-care statuses.
- [ ] Generate care-plan items for approved routine screening, supplementation, vaccination, counselling, birth preparedness, and postpartum preparation.
- [ ] Implement only approved eligibility-dependent/context-specific rules; default all others off.
- [ ] Never close a pregnancy from GA/EDC/staleness alone.
- [ ] Persist ruleset version, inputs/missing/invalid evidence, triggers, and evaluation time.

#### Acceptance gate

- Missing all mandatory inputs returns `UNASSESSED`, never `LOW`.
- A known HR3 trigger plus other missing data remains `INCOMPLETE + HR3`.
- A week-8 qualifying contact completes WHO contact 1.
- One week-37 encounter cannot complete both week-36 and week-38 planned contacts.
- Unknown GA cannot produce a completed schedule.
- Every derived assessment is reproducible from stored evidence and ruleset.
- Clinical owners sign the final deterministic test vectors before activation.

### Phase 5 — Closed-Loop Tasks, Appointments, Outreach, and Referral Integration

**Objective:** Convert detection into accountable action while preserving clinical authority boundaries.

#### Work

- [ ] Implement task services/APIs with conditional state transitions and idempotent trigger keys.
- [ ] Generate tasks for approved abnormal findings, missing mandatory assessment, missed contact, unresolved outcome, data conflict, and referral-required conditions.
- [ ] Assign hospital/team ownership and approved due times.
- [ ] Implement appointment, reschedule, no-show, and outreach-attempt history.
- [ ] Store and enforce safe-contact consent/preferences before manual or automated outreach; shared-phone and do-not-contact restrictions override task convenience.
- [ ] Add escalation without exposing sensitive screen content on general dashboards.
- [ ] Link clinical tasks/findings to existing referrals.
- [ ] Require verified referral/clinical completion evidence before resolving a task.
- [ ] Reopen resolved tasks only for new evidence or reviewed correction.
- [ ] Preserve task/referral transitions in audit and append-only events.
- [ ] Keep external SMS/messaging disabled until a separate consent/privacy project is approved.

#### Acceptance gate

- Repeated ingestion of one finding creates exactly one open task.
- Concurrent acknowledgement/transition yields one committed transition plus idempotent success or conflict.
- A severe approved scenario completes finding -> task -> acknowledgement -> referral -> arrival/management resolution end to end.
- A later normal result does not silently erase an unresolved severe finding.
- A transaction failure creates neither orphan task nor unlinked referral.
- Every open task has an owner, due time, and audit trail.
- No outreach attempt can be recorded or initiated without a current authorized contact preference; content remains neutral and sensitive findings are never disclosed.

### Phase 6 — Clinical UI and Operational Workflows

**Objective:** Make data quality, provenance, schedule, and owned action understandable at the point of use.

#### Pregnancy list/worklist

- [ ] Show assessment completeness beside risk level.
- [ ] Add filters for unassessed/incomplete/stale assessments, due/missed contacts, unresolved outcomes, open/overdue tasks, source lag, and identity review.
- [ ] Keep WHO ANC8 and MOPH/local metrics separately labelled.
- [ ] Show last source update and data completeness without PHI in aggregate cards.

#### Journey detail

- [ ] Replace green default `OK` with explicit `not recorded`, `invalid`, `pending`, `stale`, `normal`, or `abnormal` labels.
- [ ] Show source hospital/system, observed time, and provenance confidence for visits/results.
- [ ] Show dating method, effective GA, and any conflict.
- [ ] Show contact plan, appointments, completed encounter evidence, and missed-contact workflow.
- [ ] Show care-plan items and why each is due/not due/not applicable/complete.
- [ ] Show owned tasks, acknowledgement, referral link, and resolution evidence.
- [ ] Display stored urine, supplement, vaccination, fetal-surveillance, and approved psychosocial fields through typed API models.
- [ ] Restrict depression/IPV/substance content and avoid unsafe notification/general-dashboard text.
- [ ] Make status understandable without colour alone and verify Thai/mobile accessibility.

#### Acceptance gate

- No missing value can render green or complete.
- Source and observation time are visible for clinical facts.
- Positive approved screens/danger signs expose an authorized action path.
- Colour is not the only severity cue.
- Mobile and keyboard workflows pass targeted component/E2E tests.
- Hospital/provincial/sensitive-data authorization tests pass.

### Phase 7 — WHO-Referenced and Locally Governed ANC Indicators and Data Quality

**Objective:** Produce reproducible source-quality and LRMS-registry cohort monitoring without hiding unknown data. Label a result as population/provincial coverage only after denominator ascertainment is independently proven.

#### Initial indicator set

| Origin/group | Indicator | Required output |
|---|---|---|
| WHO facility contact | ANC1, ANC4+, ANC8+ within the explicitly defined facility/LRMS cohort | numerator, denominator, unknown/excluded count, version, source watermark |
| WHO timing reference/local definition | First qualifying ANC contact by 12 completed weeks | same plus dating-quality count and exact approved boundary |
| Local/DAK-derived contact content | BP documented at qualifying contacts | measured, not measured, declined, invalid, unknown |
| Local assessment quality | Complete/incomplete/unassessed/stale risk assessment | counts/rate by source/hospital and ruleset |
| Locally approved testing coverage | Hb, syphilis, HIV, hepatitis B, blood-group/Rh, or other approved tests | individual source traceability; result, acknowledgement, and completed management kept separate |
| WHO recommendation/local operational measure | Approved ultrasound before 24 weeks | offered/completed/late/declined/unknown/not applicable |
| Local/DAK-derived prevention | Iron/folate and locally approved supplement/vaccine continuity | eligibility, offered/provided/declined/adherence, unknown |
| Local workflow | Open/overdue tasks, acknowledgement time, resolution time | SLA/ruleset version and unknown ownership count |
| Local referral workflow | Referral acceptance/arrival/verified completion | never treat referral creation as completion |
| Local continuity | Episode active, outcome verification due/pending/verified, lost contact, transferred responsibility | separate confirmed operational states |
| Data quality | Source reporting completeness/timeliness, lag, rejected/quarantined fields, provenance confidence, identity ambiguity | de-identified counts/rates and as-of watermarks |

#### Indicator rules

- Deduplicate provincially by verified pregnancy episode, not hospital row.
- Show WHO ANC8 and any Thai ANC5/local indicator separately.
- Distinguish WHO clinical contact scheduling from the GHO facility-contact indicator. Do not include community or external contacts in a facility rate unless the signed indicator definition permits them.
- Count a contact only under the approved qualifying-contact contract. The one-encounter/one-planned-contact allocation is a local KK-LRMS control.
- Do not equate a recorded positive/negative test with completed management.
- Show unknown and excluded counts next to every rate and define whether they are in or outside the denominator; never silently remove missing data.
- Version numerator, denominator, exclusions, geography, cohort definition, calculation build/ruleset, source watermarks, as-of time, and effective interval.
- Support WHO age disaggregation where privacy-safe, including adolescent groups; suppress small cells according to approved privacy policy.
- Publish no patient identifiers in aggregate endpoints, logs, or snapshots.

Use three explicit labels:

1. **Source-data completeness:** whether expected facilities/senders/data elements reported completely and on time.
2. **LRMS-registry cohort rate:** rate among pregnancy episodes captured in the defined LRMS cohort as of a stated watermark.
3. **Population/provincial coverage:** rate against a validated population denominator. This label remains disabled until facility participation, private/community/external contacts, denominator source, cohort eligibility, reporting completeness, and representativeness are approved and reconciled. Routine facility data are not automatically population-representative.

#### Acceptance gate

- Signed fixture cohorts reproduce every numerator and denominator.
- One cross-hospital pregnancy counts once provincially.
- Indicators are reproducible by version, as-of time, source watermarks, cohort, and calculation build.
- The UI/API labels every rate as source completeness, LRMS cohort, facility rate, or validated population/provincial coverage.
- Population/provincial labels remain unavailable until the signed denominator-ascertainment gate passes.
- Aggregates contain no CID, HN, name, clinical free text, or unsafe small-cell disclosure.

### Phase 8 — Pilot, Rollout, and Legacy Retirement

**Objective:** Activate v2 only where data, workflow, training, and rollback are proven.

#### Rollout sequence

1. Offline replay of de-identified production-shaped data.
2. Schema/provenance deployment with all production feature flags off.
3. Shadow writes at one representative district hospital and the provincial hub.
4. Shadow v1/v2 assessment, contact, and count reconciliation.
5. Read-only unknown/provenance/contact-plan UI pilot.
6. Closed-loop task/referral pilot after clinical sign-off.
7. Expand to 3-5 hospitals representing different HOSxP versions/source paths.
8. Staged province rollout with explicit hospital allowlist.
9. Retire legacy risk/contact reads only after at least one stable release and signed reconciliation.

#### Immediate stop conditions

Stop activation for the affected hospital/source if any of these is non-zero:

- fabricated normal observations;
- cross-hospital visit loss, overwrite, or reattribution;
- duplicate active canonical source visits;
- severe actionable finding without an action record;
- action without owner or audit trail;
- pregnancy hidden without confirmed outcome/transfer/reviewed closure;
- source-accepted record absent centrally after its watermark;
- accepted correction/retraction overwrote or deleted the only retained source evidence;
- journey risk inconsistent with the latest canonical assessment;
- active guideline metadata does not match the deployed executable ruleset/build;
- a rate is exposed as population/provincial coverage before denominator ascertainment passes;
- PHI in logs, metrics, or aggregate reports;
- unauthorized access to clinical task, identity, psychosocial, or referral data.

---

## 9. Verification and Test Plan

The following matrix is release-blocking.

| ID | Layer | Required scenarios | Acceptance |
|---|---|---|---|
| `ANC-V01` | Clinical unit | Null/partial/invalid BP, FHR, Hb; declined/not performed; severe plausible values; assessment without BMI/labs | Unknown/invalid/declined/not performed are distinct and never normal; no healthy substitution; severity and completeness separate |
| `ANC-V02` | Contact schedule unit | First contact weeks 6/8/9/10/12/13; targets 20/26/30/34/36/38/40; duplicates; one week-37 encounter; unknown/EDC-derived GA | First contact by 12 qualifies; RTCOG target separate; one encounter maps once; unknown GA is not complete |
| `ANC-V03` | Boundary validation | Every enum/range/unit; malformed/future dates; GA conflict; partial BP; invalid JSON; severe valid data | Invalid data quarantined with field errors; severe valid data accepted/escalated; per-patient atomic semantics |
| `ANC-V04` | Schema/migration | Additive v2 projection/version tables, nullable legacy identity, dirty preflight, idempotency, rollback/crash at each step | Same-day cross-hospital v2 visits allowed without changing legacy index; migration restartable/non-destructive; old image compatible during rollback window |
| `ANC-V05` | Ingestion parity/evidence | Webhook, browser push, maintained poller; corrections/retractions; MySQL/PostgreSQL-shaped fixtures; 501+ pregnancies | Same active projection/completeness/risk/provenance; every version retained under policy; deterministic replay; full pagination |
| `ANC-V06` | Cross-hospital integration | A visit, B same-day visit, A/B resend, subset, omitted visits, empty declared snapshot, out-of-order events | Only same source partition changes; all other visits survive; provincial summary recomputed |
| `ANC-V07` | Atomicity/concurrency | Failure during multi-row ingest/version activation; simultaneous A/B; duplicate/stale delivery; replay | No partial/lost history; one active projection per source key with immutable versions; summary/tasks atomic; replay emits no duplicate task/referral; SSE after commit |
| `ANC-V08` | Task workflow | Create, acknowledge, assign, escalate, refer, resolve, reopen; duplicate finding; concurrent transition | Idempotent task, valid transition, owner/time/audit/evidence; unresolved finding cannot silently disappear |
| `ANC-V09` | Appointment/outcome/contact safety | Due date, reschedule, no-show, consent/preference, do-not-contact/shared phone, outreach, 41+ weeks, transfer, external/multiple-birth outcomes | No time-only outcome; transfer/episode/outcome verification distinct; contact requires current authorization; Asia/Bangkok boundaries correct |
| `ANC-V10` | Indicators | ANC1/4/8 facility/LRMS cohort, first contact by 12 weeks, source completeness, local content measures, denominator/as-of/source changes | Signed definitions; one episode counted once; unknown/excluded semantics explicit; no population/provincial label before ascertainment; no PHI |
| `ANC-V11` | Component/UI | Unknown/invalid/declined/stale data, provenance, contact due, danger signs, sensitive screen, ownership, rate scope label | No missing-green state; text/icon semantics; authorized action path; source/time and indicator scope visible |
| `ANC-V12` | Full roundtrip | Hospital A ingest -> detail; hospital B ingest -> combined history; severe finding -> task/referral; missed contact -> outreach | Proves stored and visible effects through route, DB, API, UI, refresh/SSE |
| `ANC-V13` | Observability/privacy | Accepted/rejected/missing counts, watermark, conflict, task SLA, name/HN/error-message logging, log failures | Non-PHI metrics/logs; observability failure does not block ingest; clinical degradation separate from infrastructure readiness |
| `ANC-V14` | Load/query plan | 500-record bundle, 501+ pagination, eight contacts each, all hospitals, simultaneous sync, indicator queries | Zero row loss; bounded queries; PostgreSQL `EXPLAIN` uses indexes; approved performance baseline |
| `ANC-V15` | Authorization | Every new read/mutation with role, access mode, arbitrary hospital/journey, relationship, sensitive capability, referral party | Handler-level guards deny cross-hospital, readonly mutation, admin-without-clinical-capability, non-party, and sensitive access; middleware is defence in depth |
| `ANC-V16` | Version/reproducibility | Missing/mismatched guideline checksum, late-arriving data, historical rerun, source watermark change, build change | ANC v2 readiness fails on active ruleset mismatch; historical assessment/indicator reproduces from stored version, cohort, watermarks, as-of time, and build |

### 9.1 Mandatory clinical safety fixtures

Clinical owners must sign the expected results for at least:

| Case | Required invariant |
|---|---|
| BP absent or one component missing | Incomplete/unknown; never normal or 120/80 |
| BP 139/89, 140/90, 160/110 | Deterministic approved boundaries; severe scenario creates approved urgent workflow |
| Hb absent, 10.9, 8.9 | Absent unknown; boundaries match approved local protocol |
| FHR absent, 109, 110, 160, 161 | Absent unknown; deterministic approved boundaries |
| First contact GA 8 | WHO contact 1 completed; separate local timing indicator applied |
| One encounter GA 37 | Cannot complete two planned contacts |
| Eight raw visits with unknown GA | Contact schedule remains unknown unless approved evidence permits mapping |
| Patient declined or service not performed | Distinct from missing/unknown; indicator and task behavior follows the signed definition |
| Bleeding/reduced fetal movement/severe headache | Visible, assigned, and auditable action |
| Positive HIV/syphilis/hepatitis B | Result is not completed management; follow-up remains open until documented |
| Positive depression/IPV screen | Restricted safe workflow; no general dashboard or unsafe patient reminder content |
| GA >=41 without outcome | Remains on outcome-verification worklist |
| Non-Thai/unavailable CID | Alternate identity path prevents silent exclusion; weak match not auto-merged |
| Same patient, repeated pregnancy; similar demographics, distinct patient; merge then split | Episodes remain distinct; weak match is reviewed; merge/split is reversible with evidence |
| Same-day visits at two hospitals | Both survive with provenance |
| Older payload after newer | Newer clinical evidence is not overwritten |
| Correction/retraction and replay | Previous version remains auditable; active projection is correct; no duplicate task/referral |
| Transfer without pregnancy outcome | Responsibility changes while episode remains active/outcome unverified |
| Twins with different outcomes | Separate source-proven outcome events link correctly; scalar journey state does not erase either event |
| Shared telephone/do-not-contact | No outreach or revealing content is produced without current safe-contact authorization |
| Context-specific item disabled | No recommendation appears simply because it exists in global WHO guidance |

### 9.2 Test harness and CI gates

Current PGlite tests are valuable fast PostgreSQL-dialect checks, but PGlite serializes calls and cannot reproduce `pg.Pool` concurrency. CI also excludes `tests/e2e/**`, including Vitest cold-start tests. Correct this coverage gap.

1. **Every commit:** targeted clinical unit, validation, PGlite integration, component tests, TypeScript check/build path as applicable, and lint.
2. **Every pull request:** full Vitest, production build, deterministic cold-start route tests, and required Playwright smoke. Move required Vitest cold-start tests out of the excluded E2E pattern or change CI configuration.
3. **Clinical-schema pull request:** PostgreSQL 16 service for migration, transaction, uniqueness, out-of-order, concurrency, and query-plan tests.
4. **Release candidate:** authenticated Playwright ANC roundtrip against an ephemeral Compose stack.
5. **Staging opt-in:** read-only live HOSxP extraction plus one synthetic/de-identified end-to-end central effect. Live HOSxP access remains outside cheap default CI.

Recommended test anchors:

- Update `tests/unit/services/anc-clinical.test.ts` rather than preserving missing-as-normal behavior.
- Extend webhook validation tests with field/range/partial-bundle cases.
- Extend `tests/integration/webhook-anc-referral.test.ts` for cross-hospital visit preservation and source-scoped resends.
- Reuse `tests/helpers/failingDb.ts` for transaction rollback.
- Reuse concurrency patterns from `tests/unit/services/referral-concurrency.test.ts`.
- Reuse PGlite helpers in `tests/helpers/createPgliteDb.ts` and `tests/helpers/testDb.ts`.
- Add a real PostgreSQL 16 CI suite for `pg.Pool` behavior.
- Add authenticated ANC Playwright coverage; current admin coverage is insufficient/skipped.

---

## 10. Observability, Reconciliation, and Operational Readiness

### 10.1 Required non-PHI metrics

By hospital/source/version:

- last source watermark and ingestion lag;
- payloads/patients/visits/results accepted, updated, unchanged, quarantined, rejected, or conflicted;
- pagination pages and expected/received totals;
- completeness of mandatory approved fields;
- authoritative/inferred/legacy-unknown provenance counts;
- unassessed/incomplete/complete/stale assessments;
- v1/v2 risk/contact/count divergence categories;
- open/overdue/unowned clinical tasks;
- referral acceptance, arrival, and verified-resolution lag;
- unresolved outcome and ambiguous-identity counts;
- snapshot tombstone candidates and actual source-scoped retractions.

Names, HN, CID, encrypted identifiers, free-text clinical notes, raw payloads, and sensitive screen content must not appear in logs/metrics. Review logger redaction keys for HN/name and add structured codes rather than interpolated clinical text.

### 10.2 Readiness dimensions

Keep separate readiness states:

- infrastructure readiness: application started, DB reachable, migrations complete;
- source readiness: sender contract/version/watermark valid;
- data-quality readiness: completeness, provenance, and reconciliation within approved limits;
- clinical-workflow readiness: owners trained, task routing available, no overdue unowned critical action;
- indicator readiness: definitions approved and source completeness sufficient.

Infrastructure `200` must not imply that ANC clinical data is current or complete.

### 10.3 Reconciliation report

Extend current reconciliation beyond its three existing discrepancy types. The ANC report should contain only de-identified aggregates and categorized samples behind restricted access:

- source event accepted but canonical row missing;
- source version chain/supersession broken or active projection pointing to the wrong version;
- canonical row without source/provenance;
- source/canonical field conflict;
- duplicate source key;
- same-day cross-hospital visits;
- journey summary not matching active visits;
- v1/v2 assessment divergence;
- contact-plan divergence;
- task trigger without task or duplicate open tasks;
- referral/task state mismatch;
- hidden/unresolved pregnancy outcome;
- identity ambiguity;
- guideline/build checksum mismatch or non-reproducible indicator snapshot.

---

## 11. Deployment, Migration, and Rollback Runbook

### 11.1 Pre-deployment

- [ ] Take and verify a PostgreSQL backup.
- [ ] Rehearse restore on an isolated database.
- [ ] Run migration preflight and archive its checksum/de-identified result.
- [ ] Run de-identified source replay for every sender version.
- [ ] Verify previous and new application images against the expanded schema.
- [ ] Confirm feature flags are off by default in production.
- [ ] Confirm clinical/task owners and escalation contacts for pilot hospitals.
- [ ] Confirm dashboards/logs contain no PHI.
- [ ] Confirm the active DB guideline version matches the deployed executable checksum/build SHA.
- [ ] Confirm evidence-retention/replay and safe-contact policies are active for pilot hospitals.

### 11.2 Deployment order

1. Deploy additive schema and explicit migrations.
2. Validate table/index/constraint state on PostgreSQL.
3. Enable ingestion event capture only.
4. Enable v2 shadow writes for one allowlisted hospital.
5. Run source/canonical and v1/v2 reconciliation.
6. Enable read-only v2 UI.
7. Enable task generation only after clinical approval.
8. Enable indicator publication after denominator validation.
9. Expand allowlist gradually.

### 11.3 Rollback contract

Rollback is feature-first, not destructive:

1. Disable per-hospital v2 reads, task generation, and v2 ingestion/projection writes independently.
2. Stop the affected sender/source if it threatens data integrity.
3. Revert to the tagged prior application image.
4. Run readiness and reconciliation checks.
5. Preserve all additive tables, imported evidence, task/referral events, and audit rows.
6. Do not run destructive down migrations or delete new actions.
7. Open tasks remain assigned and auditable; cancel only with clinical owner review and an explicit reason.
8. Investigate using the ingestion-event manifest, then rebuild shadow projections from retained immutable source versions; if policy did not permit local evidence retention, refetch from the approved source watermark. Never treat event hashes alone as replayable clinical evidence.

Rollback acceptance must prove that the previous image starts against the expanded schema and that pregnancy timelines, referrals, labor, and newborn records remain readable.

---

## 12. Security, Privacy, Equity, and Respectful Care

### 12.1 Authorization and confidentiality

- Apply handler-level role/capability, access-mode, hospital/provincial/referral relationship checks to every new route and transition; middleware is only defence in depth.
- Use a narrower permission for IPV, depression, substance-use, and other sensitive screens.
- Do not expose sensitive findings in general dashboard labels, browser notifications, SMS, or shared worklists.
- Audit read and mutation access to restricted records according to approved policy.
- Keep analytics de-identified and suppress privacy-risk small cells.
- Before any telephone/manual/digital outreach, require current safe-contact consent/preferences: preferred language, channel and time, do-not-contact, shared-phone restriction, neutral-content instruction, source, recorded time, and expiry/review date.
- Store only the minimum neutral outreach content; do not copy pregnancy status, sensitive screen results, or clinical narratives into contact-attempt records or shared-phone messages.
- Apply approved retention/deletion rules to immutable evidence, quarantine payloads, tasks, outreach, audit, and indicator snapshots; deletion of a projection never deletes required clinical provenance.

### 12.2 Identity and inclusion

- Support verified Thai CID, passport/migrant ID, hospital HN/person ANC ID, and temporary local identity.
- Encrypt identifier values and use keyed lookup hashes.
- Make legacy HN/CID fields nullable through an explicit compatibility migration and update readers before enabling alternate-ID writes; do not fabricate placeholders.
- Never merge weak identities automatically.
- Provide a reviewed merge/split workflow with immutable evidence and rollback.
- Measure silent exclusion by identity type and hospital.

### 12.3 Respectful care

The UI and workflow should support communication, dignity, informed choice, privacy, and refusal/decline states. `PATIENT_DECLINED`, `NOT_PERFORMED`, `UNKNOWN`, and a failed service are distinct. Their indicator and task behavior must be approved explicitly. Do not use punitive labels for missed contacts or sensitive screening results.

---

## 13. Risks and Mitigations

| Risk | Likelihood/impact | Mitigation |
|---|---|---|
| Turning a registry into an unmanageable EHR | Medium/High | Maintain role boundary; use focused coordination tables; no prescribing/order entry |
| False confidence from ANC8 count | High/High | Separate contact, timeliness, content, data quality, and outcome indicators |
| Clinical rule drift | Medium/High | Versioned source/approval/effective dates, signed fixtures, annual/update-triggered review |
| Cross-source data loss during migration | Medium/Critical | Additive schema, source-scoped writes, backup/restore, shadow reconciliation, zero-tolerance stop gate |
| Legacy rows lack stable source IDs | High/Medium | Explicit inferred/unknown provenance; no silent authoritative backfill; review queue |
| Alert fatigue | Medium/High | Clinically approved triggers/SLAs, idempotent task key, prioritization, pilot measurement |
| Sensitive-screen harm | Medium/Critical | Restricted access, safe pathway, no general dashboard/messaging disclosure |
| Hospital workflow burden | High/Medium | Pilot with named owners, measure time-to-action/unowned tasks, training and feedback |
| PGlite-only false confidence | High/High | PostgreSQL 16 migration/concurrency/query-plan CI |
| WHO/local policy mismatch | Medium/High | Interpretation class and local adaptation governance; context-specific features off |
| Incomplete source integration | High/High | Baseline profiling, source contract versions, parity fixtures, completeness indicators |
| Identity merge error | Medium/Critical | Verified identifiers, manual weak-match review, reversible merge/split evidence |
| Mutable source row prevents audit/replay | Medium/Critical | Append-only encrypted normalized versions, supersession chain, retention, deterministic shadow replay |
| Broad authenticated journey/task access | High/Critical | Handler-level capability/access-mode/relationship guards and negative cross-hospital tests |
| LRMS cohort rate mislabelled provincial coverage | High/High | Explicit rate scopes and denominator-ascertainment activation gate |
| Manual outreach discloses pregnancy/sensitive information | Medium/Critical | Safe-contact consent/preferences, shared-phone/do-not-contact enforcement, neutral content |

### 13.1 Pre-mortem

Assume the rollout failed. The most likely causes would be:

1. A sender claimed a complete snapshot but delivered a subset, causing source-scoped retractions. Prevent with explicit snapshot boundary/watermark and shadow tombstone preview.
2. Staff received many alerts but no ownership capacity. Prevent with task-volume simulation, owner configuration, and pilot stop thresholds.
3. The dashboard improved visually while clinical data remained incomplete. Prevent with completeness and provenance displayed beside every result/indicator.
4. Local rules changed but old assessments were presented as current. Prevent with ruleset effective dates, stale/re-evaluation states, and versioned indicators.
5. Sensitive screening information was exposed through a broad worklist. Prevent with separate permissions, neutral general tasks, and privacy threat-model tests.
6. A historical correction overwrote the only source evidence or replay generated duplicate actions. Prevent with append-only versions, deterministic projections, retention, and replay idempotency tests.
7. An LRMS cohort percentage was presented as provincial coverage despite missing facilities/external contacts. Prevent with locked rate labels and a signed denominator-ascertainment gate.

---

## 14. Ownership and Suggested Delivery Sequence

### 14.1 Roles

| Role | Accountability |
|---|---|
| Provincial obstetric lead | Clinical rule/threshold/eligibility approval and golden cases |
| ANC nursing lead | Contact content, task ownership, outreach workflow, usability |
| Public-health/MCH lead | Indicator definitions, geography/age disaggregation, programme interpretation |
| Health-informatics lead | WHO/Thai traceability, terminology, source data dictionary, interoperability |
| Privacy/security owner | Sensitive data, identity, logging, authorization, outreach consent |
| Product owner | Scope boundary, pilot sites, training, operational ownership |
| Engineering | Data model, ingestion, transactions, UI, API, tests, observability, rollback |
| QA/test engineering | Clinical fixtures, source parity, concurrency, E2E, release evidence |
| Hospital source owner | HOSxP query/sender version, source IDs, snapshot/watermark guarantees |

### 14.2 Dependency-aware order

1. Immediate safety containment.
2. Clinical definitions and golden fixtures.
3. Read-only data profiling and sender inventory.
4. Additive schema/provenance and explicit migrations.
5. Canonical ingestion and cross-hospital preservation.
6. Identity/reconciliation/shadow projection.
7. Completeness-aware assessment and contact/care plans.
8. Tasks/appointments/outreach/referral link.
9. UI and authorization.
10. Indicators and operational monitoring.
11. Pilot, expand, then retire legacy reads.

Do not start task/referral automation before provenance-safe ingestion and approved clinical definitions. Do not publish coverage percentages before denominator and unknown-data validation.

---

## 15. Definition of Done

This programme is complete only when all applicable statements are true:

### Clinical safety

- [ ] Missing/invalid/pending/declined/not-performed/stale data is explicitly distinguished and never normal or complete.
- [ ] No healthy-value imputation remains in any maintained ANC ingestion path.
- [ ] Risk severity and completeness are separate and reproducible.
- [ ] Clinical rule sources, local adaptation, approval, and effective versions are recorded.
- [ ] Golden clinical fixtures are signed and pass.

### Data integrity and continuity

- [ ] Cross-hospital visits coexist and survive every resend/snapshot scenario.
- [ ] Every active visit/result has source provenance or an explicit legacy confidence state.
- [ ] Every correction/retraction preserves an immutable source version; deterministic replay rebuilds the active projection without duplicate tasks/referrals.
- [ ] Duplicate/out-of-order events are idempotent and safe under PostgreSQL concurrency.
- [ ] Journey summaries derive from all active provincial evidence.
- [ ] Episode status, care responsibility/transfer, outcome verification, and source-proven fetus/newborn outcome events remain separate; no pregnancy disappears through time inference.
- [ ] Alternate identity workflow uses nullable legacy identifiers, prevents silent exclusion, and supports reversible merge/split without unsafe auto-merge.

### Closed-loop operations

- [ ] Every approved actionable finding has one owner, due time, acknowledgement, action, and resolution evidence.
- [ ] Missed contact and unresolved outcome workflows retain history and accountability.
- [ ] Referral creation, arrival, and verified clinical completion are distinguished.
- [ ] Sensitive screens use restricted, safe workflows.
- [ ] Outreach requires a current safe-contact preference and never reveals pregnancy/sensitive content through an unsafe channel.

### User experience

- [ ] List/detail views distinguish unknown, invalid, pending, stale, normal, and abnormal.
- [ ] Provenance and observation time are visible.
- [ ] Contact/care plan and next action are understandable on mobile and without colour alone.
- [ ] Hospital/provincial/sensitive-data authorization tests pass.
- [ ] Handler-level role/capability/access-mode/relationship guards deny readonly and cross-hospital mutations even if middleware is bypassed.

### Measurement and operations

- [ ] ANC1/4/8, first-contact-by-12-weeks, content, follow-up, referral, outcome, and data-quality indicators have signed definitions.
- [ ] Every indicator includes rate scope, numerator, denominator, unknown/excluded semantics, cohort, source watermarks, as-of time, and calculation/ruleset version.
- [ ] LRMS cohort/facility rates cannot be labelled population/provincial coverage until denominator ascertainment passes.
- [ ] No PHI appears in logs, metrics, or aggregate endpoints.
- [ ] Reconciliation is clean or every remaining divergence is approved/documented.
- [ ] Backup/restore, rollback, and previous-image compatibility are proven.
- [ ] PGlite, PostgreSQL 16, production build, authenticated E2E, and pilot evidence pass.
- [ ] Active guideline metadata matches the deployed executable checksum/build; mismatch leaves ANC v2 not ready.

### Programme stop condition

Legacy ANC risk/contact reads may be retired only after at least one stable release with:

- zero fabricated-normal observations;
- zero cross-hospital record loss/re-attribution;
- zero duplicate canonical source visits;
- zero unowned severe actionable findings;
- zero unauthorized sensitive-data access;
- zero unauthorized cross-hospital/readonly clinical mutations;
- signed v1/v2 reconciliation and clinical acceptance.

---

## Appendix A — Immediate File-Level Work Map

| Area | Existing files to modify first | New files/tables likely needed |
|---|---|---|
| Unknown semantics | `src/services/anc-clinical.ts`; pregnancy detail/list pages; API types; current unit/component tests | Shared clinical status types |
| Risk completeness | `src/services/sync/anc.ts`; `src/config/anc-risk-rules.ts`; `src/services/anc-risk.ts`; `src/services/anc-screening.ts`; `cached_anc_risks` | `anc-assessment.ts`; guideline/ruleset version metadata |
| Source-safe ingestion | `src/services/webhook.ts`; `src/lib/browser-poll.ts`; browser-push route; maintained polling path | `anc-ingestion.ts`; `anc-normalization.ts`; ingestion event table |
| Visit provenance/evidence | `src/db/tables/cached-anc-visits.ts`; `src/db/tables/index.ts`; `src/app/api/startup.ts` | Append-only source versions, `anc_visits_v2`, retention/replay service, reconciliation tests; legacy index retained during rollback window |
| Schedule/contact | `src/services/anc-clinical.ts`; `src/config/anc-ops.ts`; `src/services/journey-list.ts`; pregnancy pages | `anc-scheduling.ts`; `anc_contact_plans`; `anc_appointments` |
| Outcome continuity | freshness/ops config; journey/newborn services/pages | separate episode/responsibility/verification states, source-proven outcome events, outcome-verification tasks |
| Closed-loop action | journey detail, dashboard, referral service/routes | `clinical_tasks`, task events/service/routes, referral task link |
| Care content/results | journey/visit API types and detail page | `anc_clinical_results`; `anc_care_plan_items`; guideline config |
| Identity/equity | journey matching in sync/webhook; non-null legacy identifiers | nullable-identifier migration, `maternal_journey_identifiers`, merge/split review workflow |
| Indicators | dashboard services/routes/pages; reconciliation service | `anc-indicators.ts`; scoped/cohort/as-of indicator snapshots/routes/tests |
| Authorization/privacy | middleware, session/admin/referral guards, logger | capability/relationship guards, safe-contact preferences, log-redaction/negative authorization tests |
| CI/verification | `.github/workflows/ci.yml`; Vitest/Playwright config | PostgreSQL 16 job; authenticated ANC roundtrip suite |

## Appendix B — Mandatory Defaults

Production defaults during rollout:

- `ANC_V2_WRITE_ENABLED=false`
- `ANC_V2_READ_ENABLED=false`
- `ANC_V2_TASKS_ENABLED=false`
- `ANC_V2_INDICATORS_ENABLED=false`
- `ANC_POPULATION_COVERAGE_LABELS_ENABLED=false`
- `ANC_SENSITIVE_SCREENS_ENABLED=false`
- `ANC_OUTREACH_ENABLED=false`
- per-hospital allowlists empty
- source payloads treated as `INCREMENTAL` unless an approved v2 snapshot boundary is declared
- context-specific and eligibility-dependent clinical rules disabled unless approved and versioned
- routine CTG, routine Doppler, and formal daily fetal-movement-counting prompts disabled
- live HOSxP validation opt-in and staging-only

The exact environment-variable names may follow the existing feature-flag framework, but their safe defaults and independent rollback controls are required.

## Appendix C — Explicit Non-Goals for the Initial Programme

- Autonomous diagnosis, prescribing, dose calculation, or unreviewed referral decisions.
- Writing clinical corrections back to HOSxP.
- A full medication/allergy/order-entry EHR replacement.
- Patient SMS/app messaging before a separate consent/privacy/design approval.
- Manual telephone/outreach before safe-contact consent, language/channel/time, shared-phone, neutral-content, and do-not-contact controls are approved.
- Universal home BP monitoring; use only under approved eligibility pathways.
- Automatically enabling malaria IPTp, deworming, or other context-specific recommendations not applicable under approved Thai/provincial policy.
- Universal routine CTG, Doppler ultrasound, or formal daily fetal-movement counting.
- Presenting anti-D, aspirin, calcium, or other eligibility-dependent prophylaxis as universally due; any production rule requires current Thai/local authority.
- Historical clinical reinterpretation without a separate, idempotent, dry-run, reviewed backfill plan.
- Treating ANC8 as proof of care quality or a good pregnancy outcome.
- Making live external HOSxP checks part of the cheap default CI suite.

## Appendix D — Review Checklist Before Implementation Starts

- [ ] Obstetric lead approves thresholds, eligibility, task priority, and golden cases.
- [ ] ANC nursing lead approves qualifying-contact content and workflow ownership.
- [ ] MCH lead approves indicators and disaggregation.
- [ ] Informatics lead approves source data dictionary, provenance, and sender contracts.
- [ ] Informatics/privacy owners approve immutable-evidence content, encryption, retention, quarantine, replay/refetch, and access.
- [ ] Privacy owner approves identity, sensitive screens, logging, safe-contact/outreach, and analytics.
- [ ] Security owner approves the action-by-role/capability/access-mode/hospital-relationship matrix and negative tests.
- [ ] MCH/data owners approve rate-scope labels and denominator-ascertainment criteria before any population/provincial coverage claim.
- [ ] Engineering proves migration/rollback on PostgreSQL 16.
- [ ] QA proves missing/partial/cross-hospital/out-of-order/concurrency cases fail before implementation and pass after it.
- [ ] Pilot hospitals have trained owners and a documented downtime/manual fallback.
- [ ] Feature flags, stop conditions, and escalation contacts are recorded in the release runbook.
