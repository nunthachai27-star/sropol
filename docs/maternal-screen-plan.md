# Maternal Risk Screening While Awaiting Labor — Implementation Plan

**Status:** Proposed implementation plan  
**Primary local source:** `docs/maternal-screen.pdf`  
**Prepared:** 2026-07-16  
**Evidence review updated:** 2026-07-16  
**Scope:** Labor admission and intrapartum maternal screening in KK-LRMS  
**Clinical activation:** Blocked until the rule-combination semantics and thresholds are approved by the designated obstetric clinical owner

## 1. Purpose

Implement a structured maternal risk screen for pregnant patients awaiting labor that:

1. Classifies preeclampsia findings as `MILD`, `MODERATE`, or `SEVERE` according to the approved local rule set.
2. Treats suspected antepartum hemorrhage at gestational age 26 weeks or later as a severe obstetric emergency.
3. Identifies evidence supporting abruptio placentae, placenta previa, uterine rupture, or vasa previa.
4. Records the raw clinical observations, calculated result, matched rule identifiers, missing data, assessment time, assessor, and rule-set version.
5. Shows the result consistently on labor admission, patient-detail, maternity-ward, alert-summary, and audit/history surfaces.
6. Reuses the current partograph alert pipeline where appropriate without changing the meaning of the existing ANC risk levels or partograph alerts.

This document is an engineering plan. It does not independently approve clinical rules. The source PDF must be reconciled with the current hospital protocol by an authorized obstetric clinician before production activation.

The `MILD`, `MODERATE`, and `SEVERE` labels in this document describe the **local PDF screening tiers**. They must not be presented as internationally standardized diagnostic categories. Current NICE and ACOG guidance instead distinguishes hypertension, preeclampsia, severe hypertension, and preeclampsia with severe features using different combinations and terminology.

## 2. Source-document summary

The source PDF contains two screening domains.

### 2.1 Preeclampsia

The document presents three columns:

| Domain | Mild | Moderate | Severe |
| --- | --- | --- | --- |
| Clinical | PIH diagnosed at GA 20 weeks or later; no headache or blurred vision | Mild/tolerable headache | Headache, blurred vision, epigastric tightness/pain, or pulmonary edema |
| Blood pressure | “BP at least 140 mmHg”; the PDF does not identify systolic versus diastolic in this cell | SBP at least 150 mmHg or DBP at least 100 mmHg | SBP at least 160 mmHg or DBP at least 110 mmHg |
| Laboratory | Proteinuria 1+ | Proteinuria 1–2+ | Proteinuria 2–3+, serum creatinine greater than 1.1 mg/dL, or platelet count below 100,000/µL |

The PDF layout does not make the combination semantics fully explicit. Before implementation, clinical review must determine whether:

- the highest individual finding wins;
- every domain in a severity column is required;
- symptoms, blood pressure, and laboratory findings form separate `anyOf` groups;
- a diagnosis of PIH or preeclampsia is an input prerequisite; and
- repeated blood-pressure measurements or a minimum time interval are required.

The source table is intentionally literal. “Severe headache” must not be substituted for the PDF's unqualified severe-column “headache” without clinical approval; likewise, `BP >= 140` must not be assumed to mean SBP alone. Proteinuria 2+ appears in both moderate and severe columns and therefore has no deterministic tier until the overlap is resolved.

### 2.2 Antepartum hemorrhage

The document defines antepartum hemorrhage as vaginal bleeding from GA 26 weeks until delivery and classifies it as a severe obstetric emergency. It asks clinicians to consider:

| Suspected condition | Evidence listed in the PDF |
| --- | --- |
| Abruptio placentae | Vaginal bleeding; abdominal or back pain; frequent uterine contractions; uterine tenderness; fetal distress |
| Placenta previa | Vaginal bleeding; usually painless; abnormal presentation such as breech or transverse lie; FHR normally 110–160 bpm |
| Uterine rupture | Continuous uterine contraction where duration exceeds interval; suprapubic tenderness; Bandl's ring |
| Vasa previa rupture | Vaginal bleeding with ruptured membranes; fetal distress |

The implementation must describe these conditions as **suspected patterns**, not definitive diagnoses.

### 2.3 Evidence reconciliation with authoritative guidance

The source PDF is a local screening artifact. The following official sources were reviewed to identify corroboration, conflicts, and missing safety requirements.

| Topic | Authoritative evidence | Engineering consequence |
| --- | --- | --- |
| Hypertension definition | NICE NG133 defines hypertension in pregnancy as SBP at least 140 or DBP at least 90 mmHg after 20 weeks for gestational hypertension/preeclampsia assessment | Capture both BP components and GA; do not diagnose from a single tier label |
| Severe hypertension | NICE and ACOG use approximately 160 systolic or 110 diastolic as severe hypertension | PDF severe BP thresholds are corroborated, but confirmation/treatment timing remains protocol-specific |
| Severe-feature BP confirmation | ACOG educational criteria describe two severe readings at least 4 hours apart unless treatment begins sooner; urgent-treatment workflows may use shorter confirmation because delaying treatment can be unsafe | Store every BP reading and timestamp; never encode “wait four hours” as a hard workflow delay |
| Preeclampsia without proteinuria | NICE defines preeclampsia as new hypertension after 20 weeks with proteinuria **or** other new maternal organ dysfunction/uteroplacental dysfunction | Do not require proteinuria when approved severe organ features are present |
| Proteinuria | NICE recommends quantitative PCR/ACR confirmation after positive dipstick screening and does not routinely recommend 24-hour collection; its definition lists 2+ dipstick only when used as a diagnostic alternative | Treat dipstick as screening evidence with method/provenance, not a universal severity score |
| Severe features | ACOG lists platelets below 100,000/µL, creatinine above 1.1 mg/dL or doubling, impaired liver function/RUQ pain, pulmonary edema, persistent treatment-resistant headache/visual symptoms, and BP at least 160/110 | PDF platelet/creatinine/symptom severe criteria are substantially corroborated; liver dysfunction and renal-baseline comparison are missing from the PDF |
| NICE laboratory concern | NICE uses a lower concern threshold in surveillance examples: creatinine at least 1.0 mg/dL and platelet count below 150,000/µL | Separate “diagnostic severe feature” from “clinical concern/escalation”; do not collapse them into one cutoff |
| APH gestational definition | RCOG Green-top 63 defines APH from 24+0 weeks until birth; the local PDF starts at 26 weeks; older WHO emergency material describes later-pregnancy bleeding from 22 weeks | Store the local threshold in rule configuration and display its provenance; do not hard-code 26 as a universal definition |
| Placental abruption | ACOG describes vaginal bleeding with abdominal/back pain; WHO emergency material also recognizes concealed bleeding, uterine tenderness/tonicity, fetal compromise, and shock | Absence of visible vaginal bleeding cannot rule out abruption; add concealed-bleeding-compatible signs and maternal stability |
| Placenta previa | ACOG notes bleeding is often painless; RCOG identifies placenta previa as a major APH cause | Etiology remains suspected until imaging/clinical evaluation; the screen must not diagnose previa from painless bleeding alone |
| Uterine rupture | WHO emergency material describes bleeding that may be intra-abdominal or vaginal, severe pain that may decrease after rupture, abnormal uterine contour, easily palpable fetal parts, maternal tachycardia/shock, and absent fetal movement/FHR | Expand beyond Bandl's ring and contraction timing; treat it as an immediate emergency pattern |
| Vasa previa | SMFM Consult Series 37, reaffirmed 2024, defines vasa previa anatomically and advises suspicion when bleeding accompanies a sinusoidal fetal-heart tracing; rupture of membranes is a critical context | Do not diagnose vasa previa from bleeding plus ruptured membranes alone; label it suspected and capture fetal tracing pattern when available |
| Examination safety | WHO-linked emergency guidance warns against digital vaginal examination in late-pregnancy bleeding until placenta previa has been excluded | UI must not prompt or imply routine digital examination before the local safety condition is satisfied |

### 2.4 Evidence-backed corrections to the initial interpretation

1. **Proteinuria is not required for every preeclampsia presentation.** New hypertension plus approved maternal organ dysfunction can meet a modern preeclampsia definition without proteinuria.
2. **Dipstick grade is a screening measurement, not a reliable universal severity ladder.** Preserve the PDF mapping only as a versioned local rule; capture PCR/ACR or other quantitative tests separately.
3. **“Moderate preeclampsia” is not a universal modern category.** The PDF's SBP 150/DBP 100 tier should be named `LOCAL_MODERATE_SCREEN` internally until the hospital approves the user-facing terminology.
4. **Visible bleeding is not required for placental abruption or uterine rupture.** The input model must represent suspected concealed/internal bleeding.
5. **FHR 110–160 is a screening band, not sufficient evidence of placental etiology.** A normal FHR does not prove placenta previa, and an abnormal FHR does not identify a specific cause.
6. **Maternal stability must be assessed independently of suspected cause.** Bleeding amount can underestimate severity; shock, pulse, BP trend, consciousness, perfusion, and fetal status require their own emergency-acuity result.

### 2.5 Reference register

The implementation and clinical fixture should record the exact version/date reviewed rather than relying on an unversioned URL.

1. NICE. [Hypertension in pregnancy: diagnosis and management, NG133 — Recommendations](https://www.nice.org.uk/guidance/ng133/chapter/recommendations). Published 25 June 2019; updated 17 April 2023 at research time. Relevant locations: sections 1.2 and 1.5, Table 2, and “Terms used in this guideline.”
2. ACOG. [Preeclampsia and High Blood Pressure During Pregnancy](https://www.acog.org/womens-health/faqs/preeclampsia-and-high-blood-pressure-during-pregnancy). Official patient-facing clinical education; relevant sections: diagnosis and severe features. Retrieval checked 2026-07-16.
3. ACOG District IV. [Hypertensive Disorders — criteria for preeclampsia with or without severe features](https://www.acog.org/community/districts-and-sections/district-iv/whats-new/countdown-to-intern-year-week-3-hypertensive-disorders). Official educational material summarizing criteria; it is not a substitute for the controlling ACOG Practice Bulletin or an approved local protocol. Retrieval checked 2026-07-16.
4. RCOG. [Antepartum Haemorrhage, Green-top Guideline No. 63](https://www.rcog.org.uk/guidance/browse-all-guidance/green-top-guidelines/antepartum-haemorrhage-green-top-guideline-no-63/). First edition, reviewed 5 December 2011; relevant location: summary definition. A second edition was reported in development at research time.
5. ACOG. [Bleeding During Pregnancy](https://www.acog.org/womens-health/faqs/bleeding-during-pregnancy).
6. SMFM. [Consult Series #37: Diagnosis and management of vasa previa](https://publications.smfm.org/publications/215-society-for-maternal-fetal-medicine-consult-series-37/). Published 2015; reaffirmed 2024.
7. WHO. [Managing complications in pregnancy and childbirth: vaginal bleeding in later pregnancy and labour](https://iris.who.int/bitstream/handle/10665/42644/9241545879.pdf). This older emergency manual is supporting evidence, not the controlling local policy.

The local PDF cites, verbatim as extractable, “คู่มือการดูแลรักษาสตรีตั้งครรภ์ที่มีความเสี่ยงสูงฯ เขตสุขภาพที่ (ปรับปรุงครั้งที่ 3) หน้า 14–17.” The health-region number, issuing body, edition date, and complete title are not recoverable from the supplied PDF and no exact authoritative online copy was confirmed. The hospital must supply the complete source before Phase 0 approval.

## 3. Current repository assessment

### 3.1 Existing reusable behavior

| Capability | Current implementation | Reuse decision |
| --- | --- | --- |
| ANC BP interpretation | `src/services/anc-clinical.ts:9-43` marks SBP at least 140 or DBP at least 90 abnormal, with lower amber bands | Reuse input-normalization patterns, not the exact severity mapping |
| FHR interpretation | `src/services/anc-clinical.ts:13-14,46-49` uses 110–160 bpm | Reuse constants after verifying boundary semantics |
| ANC urine protein | `src/services/anc-clinical.ts:59-64` recognizes any plus sign as abnormal | Replace with a normalized ordinal grade for this screen |
| Preeclampsia work-up data | `src/services/anc-clinical.ts:18-22`, `src/types/api.ts:467-468`, and maternal journey persistence support 24-hour protein and creatinine | May enrich the labor screen if values are current and provenance is shown |
| ANC danger signs | `src/services/webhook.ts:110-129` and `cached_anc_visits.danger_signs_json` accept structured danger-sign codes | Reuse code vocabulary where meanings match; do not treat an old ANC answer as a current labor assessment |
| Partograph FHR alerts | `src/services/partogram.ts:153-204` alerts outside 110–160 and escalates extreme or consecutive values | Reuse current observation and alert presentation; maternal screen keeps its own rule result |
| Partograph BP alerts | `src/services/partogram.ts:507-551` emits alerts at SBP 140/160 and DBP 90/110 | Reuse current observations; add local-screen moderate thresholds without altering existing partograph behavior |
| Partograph orchestrator | `src/services/partogram.ts:631-644` combines FHR, liquor, cervix, contractions, maternal, urine, and time-gap analysis | Integrate maternal-screen alerts after the standalone rules are implemented and tested |
| Admission snapshot | `src/db/tables/cached-patients.ts:37-48` stores admission BP, pulse, RR, temperature, and cervical exam | Reuse existing BP and admission identity; do not overload this row with the complete assessment history |
| Stored partograph severity | `src/db/tables/cached-patients.ts:52-53` stores highest partograph severity and alert count | Add separate maternal-screen summary columns to avoid semantic collision |

### 3.2 Missing capability

The repository does not currently contain a complete labor-waiting maternal screen. It lacks a unified, versioned classification and structured labor-assessment fields for:

- headache severity;
- blurred vision;
- epigastric pain or tightness;
- pulmonary edema;
- urine protein grade for the current assessment;
- current creatinine and platelet count;
- liver transaminases, right-upper-quadrant pain, oliguria, and creatinine baseline/doubling when the approved protocol includes modern severe features;
- vaginal bleeding and estimated onset;
- bleeding amount/rate and suspected concealed or intra-abdominal bleeding;
- abdominal or back pain;
- uterine tenderness;
- contraction duration exceeding interval;
- suprapubic tenderness;
- Bandl's ring;
- membrane rupture in the context of bleeding;
- suspected hemorrhage patterns; and
- assessment completeness.

It also lacks a dedicated emergency-acuity model for maternal consciousness, pulse trend, perfusion/shock findings, oxygen saturation, urine output, bleeding trajectory, and fetal tracing status. Etiology classification and emergency acuity must be calculated separately.

The existing ANC `LOW/HR1/HR2/HR3` classifier in `src/config/anc-risk-rules.ts` is not the correct home for this feature. Those levels express pregnancy/referral risk, while the PDF expresses the severity of a current labor-triage presentation.

### 3.3 Existing threshold conflicts that must remain explicit

| Finding | Existing behavior | PDF behavior | Required decision |
| --- | --- | --- | --- |
| Moderate SBP | Partograph has alert from 140; no distinct 150 tier | Moderate at 150 | Add maternal-screen-only 150 tier; do not silently change partograph severity |
| Moderate DBP | Partograph has alert from 90; no distinct 100 tier | Moderate at 100 | Add maternal-screen-only 100 tier |
| Creatinine | ANC display highlights greater than 1.1; HR3 rule uses greater than 1.5 | Severe above 1.1 | Use a named maternal-screen threshold after clinical approval |
| Proteinuria | ANC visit helper treats any `+` as abnormal; HR3 uses 24-hour quantity above 500 mg | Mild 1+, moderate 1–2+, severe 2–3+ | Normalize dipstick grade and define overlap precedence |
| FHR | Partograph has alert and critical sub-bands beyond 110–160 | Fetal distress outside 110–160 | Reuse the abnormal boundary but preserve richer partograph alerts |
| APH starting GA | No unified APH screen | Local PDF: 26 weeks; RCOG: 24+0; older WHO material: 22 weeks | Version the local threshold and retain source provenance |
| Platelets | No labor-screen field | PDF/ACOG severe feature below 100,000; NICE surveillance concern below 150,000 | Model separate rule purposes instead of choosing one universal cutoff |

## 4. Goals and non-goals

### 4.1 Goals

- Produce deterministic, auditable results from structured inputs.
- Preserve unknown and not-assessed states; never convert missing data to normal.
- Store every assessment as an immutable clinical event, with correction/supersession metadata when needed.
- Surface the current local tier, emergency acuity, completeness, and exact evidence.
- Keep clinical rule definitions centralized and versioned.
- Maintain backward compatibility for existing labor and partograph webhook senders.
- Permit safe shadow-mode validation before alerts influence clinical workflow.

### 4.2 Non-goals

- Diagnosing placental abruption, placenta previa, uterine rupture, or vasa previa.
- Replacing clinician judgment or emergency protocols.
- Reclassifying the existing ANC `LOW/HR1/HR2/HR3` model.
- Changing the existing 32-rule partograph CDSS thresholds in the first release.
- Inferring symptoms from free-text notes.
- Treating a historical ANC danger sign as a current labor-screen answer.
- Auto-referring or auto-transferring patients in the first release.
- Recommending treatment, medication, delivery mode, or timing.
- Replacing CTG interpretation, ultrasound diagnosis, laboratory confirmation, or an emergency-response protocol.

## 5. Design principles

1. **Raw facts before conclusions:** persist the observed inputs and the computed result.
2. **Unknown is not normal:** missing required data produces an incomplete marker.
3. **Highest proven result wins within each axis:** a lower local tier cannot replace a higher proven local tier, and a lower acuity cannot replace a higher proven emergency acuity.
4. **Suspected, not diagnosed:** hemorrhage patterns are decision support labels.
5. **Version every rule set:** historical results remain explainable after criteria change.
6. **Separate clinical concepts:** maternal-screen local tier, emergency acuity, completeness, partograph severity, and ANC referral risk remain distinct.
7. **Fail visible:** calculation failure leaves raw data stored and raises an operational error; it must not emit a normal result.

## 6. Proposed domain model

### 6.1 Input types

Create `src/types/maternal-screening.ts`:

```ts
export type MaternalScreenLocalTier =
  | 'LOCAL_MILD'
  | 'LOCAL_MODERATE'
  | 'LOCAL_SEVERE'
  | 'NO_LOCAL_MATCH';

export type MaternalEmergencyAcuity =
  | 'STABLE'
  | 'URGENT'
  | 'EMERGENCY'
  | 'UNKNOWN';

export type ProteinuriaGrade =
  | 'NEGATIVE'
  | 'TRACE'
  | 'ONE_PLUS'
  | 'TWO_PLUS'
  | 'THREE_PLUS'
  | 'FOUR_PLUS'
  | 'UNKNOWN';

export type HeadacheSeverity = 'NONE' | 'MILD' | 'SEVERE' | 'UNKNOWN';

export interface MaternalScreenInput {
  gaWeeks: number | null;
  gaDays: number | null;
  piHDiagnosed: boolean | null;

  systolicBp: number | null;
  diastolicBp: number | null;
  proteinuriaGrade: ProteinuriaGrade;
  creatinineMgDl: number | null;
  creatinineBaselineMgDl: number | null;
  plateletPerUl: number | null;
  astIuL: number | null;
  altIuL: number | null;
  urineOutputMlPerHour: number | null;

  headache: HeadacheSeverity;
  blurredVision: boolean | null;
  epigastricPain: boolean | null;
  pulmonaryEdema: boolean | null;
  rightUpperQuadrantPain: boolean | null;

  vaginalBleeding: boolean | null;
  estimatedBleedingMl: number | null;
  bleedingRate: 'SPOTTING' | 'LIGHT' | 'MODERATE' | 'HEAVY' | 'UNKNOWN';
  concealedBleedingSuspected: boolean | null;
  abdominalOrBackPain: boolean | null;
  uterineTenderness: boolean | null;
  frequentContractions: boolean | null;
  contractionDurationExceedsInterval: boolean | null;
  suprapubicTenderness: boolean | null;
  bandlsRing: boolean | null;
  membranesRuptured: boolean | null;
  abnormalPresentation: boolean | null;
  fetalHeartRateBpm: number | null;
  fetalTracingPattern: 'REASSURING' | 'NON_REASSURING' | 'SINUSOIDAL' | 'UNKNOWN';

  maternalPulseBpm: number | null;
  respiratoryRatePerMin: number | null;
  oxygenSaturationPct: number | null;
  consciousness: 'ALERT' | 'VOICE' | 'PAIN' | 'UNRESPONSIVE' | 'UNKNOWN';
  shockSignsPresent: boolean | null;

  placentaPreviaExcluded: boolean | null;
  placentaLocationSource: 'ULTRASOUND' | 'OTHER_DOCUMENTED' | 'UNKNOWN';
}
```

Boolean values are nullable intentionally:

- `true`: assessed and present;
- `false`: assessed and absent;
- `null`: not assessed or unavailable.

### 6.2 Result types

```ts
export type SuspectedMaternalCondition =
  | 'PREECLAMPSIA'
  | 'ANTEPARTUM_HEMORRHAGE'
  | 'ABRUPTIO_PLACENTAE'
  | 'PLACENTA_PREVIA'
  | 'UTERINE_RUPTURE'
  | 'VASA_PREVIA';

export interface MaternalScreenMatch {
  ruleId: string;
  purpose: 'LOCAL_PDF_TIER' | 'EXTERNAL_SAFETY' | 'EMERGENCY_ACUITY';
  controllingSourceId: string;
  supportingSourceIds: string[];
  localTier?: Exclude<MaternalScreenLocalTier, 'NO_LOCAL_MATCH'>;
  emergencyAcuity?: Exclude<MaternalEmergencyAcuity, 'UNKNOWN'>;
  condition: SuspectedMaternalCondition;
  evidence: Array<{ field: keyof MaternalScreenInput; value: unknown }>;
}

export interface MaternalScreenResult {
  localTier: MaternalScreenLocalTier;
  emergencyAcuity: MaternalEmergencyAcuity;
  isComplete: boolean;
  suspectedConditions: SuspectedMaternalCondition[];
  matches: MaternalScreenMatch[];
  missingRequiredFields: Array<keyof MaternalScreenInput>;
  ruleSetVersion: string;
  evaluatedAt: string;
}
```

`NO_LOCAL_MATCH` means no approved local-tier rule matched. Completeness is always orthogonal: a proven `LOCAL_SEVERE` or `EMERGENCY` result may coexist with `isComplete: false` and a non-empty missing-field list. Missing information never competes with or replaces a proven severe result.

The final implementation should prefer orthogonal fields over a single overloaded severity enum:

- `localTier`: reproduction of the approved PDF classification;
- `emergencyAcuity`: immediate maternal/fetal instability;
- `suspectedConditions`: non-diagnostic etiologic patterns;
- `isComplete`: whether required screening data were assessed.

This prevents a hemodynamically unstable patient from being represented merely as “moderate” because a local preeclampsia tier matched.

## 7. Rule-engine design

Create `src/services/maternal-screening.ts` as a pure, deterministic module with no database, network, or UI dependencies.

### 7.1 Rule representation

Use explicit declarative rules rather than a single nested conditional:

```ts
interface MaternalScreenRule {
  id: string;
  version: string;
  purpose: 'LOCAL_PDF_TIER' | 'EXTERNAL_SAFETY' | 'EMERGENCY_ACUITY';
  controllingSourceId: string;
  supportingSourceIds: string[];
  condition: SuspectedMaternalCondition;
  localTier?: Exclude<MaternalScreenLocalTier, 'NO_LOCAL_MATCH'>;
  emergencyAcuity?: Exclude<MaternalEmergencyAcuity, 'UNKNOWN'>;
  evaluate(input: MaternalScreenInput): MaternalScreenMatch | null;
}
```

Rule IDs must remain stable, for example:

- `PE-HEADACHE-IN-LOCAL-SEVERE-COLUMN`
- `PE-BP-MODERATE-SBP-150`
- `PE-BP-SEVERE-DBP-110`
- `PE-LAB-SEVERE-CREATININE-1_1`
- `PE-LAB-SEVERE-PLATELET-100K`
- `APH-GA26-VAGINAL-BLEEDING`
- `APH-ABRUPTIO-PATTERN`
- `APH-PREVIA-PATTERN`
- `APH-RUPTURE-UTERUS-PATTERN`
- `APH-VASA-PREVIA-PATTERN`

### 7.2 Evaluation order

1. Normalize and validate input values.
2. Evaluate independent severe emergency triggers first.
3. Calculate emergency acuity independently of suspected cause and visible blood volume.
4. Evaluate suspected hemorrhage patterns, including concealed/internal bleeding patterns.
5. Evaluate preeclampsia diagnostic evidence and severe features.
6. Evaluate the approved local PDF tier as a separate projection.
7. Select the highest matched local tier using an explicit rank map.
8. Calculate completeness independently.
9. Return all matches, not only the highest one.

Externally derived findings must never silently become local PDF-tier rules. Every rule declares its purpose and controlling source. Supporting references may corroborate or challenge a local rule, but do not control production behavior unless the local clinical approval artifact explicitly adopts them.

### 7.3 Proposed antepartum-hemorrhage invariant

Subject to local clinical approval, the PDF-compatible trigger is:

```text
GA >= 26 weeks AND vaginal bleeding = SEVERE antepartum hemorrhage
```

Additional findings label suspected patterns but do not reduce or gate the severe classification. If GA is unknown and vaginal bleeding is present, return an urgent severe-compatible warning plus `gaWeeks` in `missingRequiredFields`; clinical review must approve the final representation.

This local 26-week trigger must coexist with a broader emergency invariant: late-pregnancy bleeding or suspected concealed bleeding is never downgraded merely because GA is unknown or below the local APH definition. The system should calculate emergency acuity and prompt the approved emergency workflow independently of whether the record satisfies the locally named `ANTEPARTUM_HEMORRHAGE` rule.

### 7.4 Safety constraints that are not ordinary decision rules

1. A digital vaginal examination must not be prompted as routine workflow for late-pregnancy bleeding until placenta previa has been excluded according to the approved protocol. Even then, a recorded exclusion value never authorizes, enables, or recommends an examination; the decision remains clinician-controlled under local protocol.
2. The system must not delay escalation while waiting for a second BP, a four-hour interval, a urine result, or a complete questionnaire when an emergency finding is already present.
3. Bleeding volume must not be used as the only acuity determinant because blood may be concealed.
4. A normal FHR must not downgrade maternal instability or prove placenta previa.
5. A normal maternal BP must not rule out hemorrhage when other shock findings are present.
6. The screen may recommend activation of an approved local emergency pathway, but must not generate treatment orders in this feature scope.

### 7.5 Clinical decisions required before coding rules

The clinical owner must sign a machine-readable decision table covering:

1. Whether one severe symptom alone establishes severe preeclampsia screening.
2. Whether PIH diagnosis and GA at least 20 weeks are prerequisites for all preeclampsia levels.
3. Whether `SBP >= 140` alone is mild when DBP is normal or missing.
4. Whether moderate BP is `SBP >=150 OR DBP >=100`.
5. Whether severe BP is `SBP >=160 OR DBP >=110`.
6. Whether proteinuria 2+ belongs to moderate, severe, or both, and which wins.
7. Whether creatinine `1.1` is normal and only values strictly greater than `1.1` are severe.
8. Whether platelet count exactly `100,000/µL` is non-severe.
9. Whether BP must be confirmed by repeated measurements and at what interval.
10. Whether FHR exactly 110 and exactly 160 are normal.
11. Minimum evidence required to label each suspected hemorrhage condition.
12. How to handle vaginal bleeding below 26 weeks and unknown GA.
13. Whether the local system adopts a 24+0, 26+0, or other APH definition and how the UI names bleeding outside that window.
14. Which findings determine `emergencyAcuity`, independent of the PDF tier.
15. Whether the approved preeclampsia model includes liver dysfunction, oliguria, creatinine doubling, and uteroplacental dysfunction.
16. Which BP confirmation interval applies to screening, diagnosis, and urgent treatment contexts.
17. Which quantitative protein method is preferred and how dipstick-only evidence is displayed.
18. What documented evidence constitutes “placenta previa excluded” before examination workflows change.
19. Whether the screen captures a sinusoidal CTG pattern as structured data or consumes it from a separate CTG system.

No production alert activation may occur until these decisions are recorded in the rule-set fixture and approved.

## 8. Persistence design

### 8.1 New assessment table

Add `src/db/tables/maternal-screening-assessments.ts` and register it through the repository's table-definition/schema-sync mechanism. Use `labor_admission_id` (or `cached_patient_id`) rather than ambiguous `patient_id`, because the intended parent is the labor-admission row in `cached_patients`, not a maternal journey or global patient entity. Confirm the exact FK and deletion behavior from existing table conventions during implementation before finalizing the schema.

Recommended columns:

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | UUID PK | Assessment identity |
| `labor_admission_id` | UUID FK | Labor admission in `cached_patients`; final FK/deletion behavior requires repository-convention verification |
| `hospital_id` | UUID FK | Tenant boundary and query efficiency |
| `source_system` | string | `HOSXP`, `WEBHOOK`, `MANUAL_UI`, or approved source |
| `source_pk` | string nullable | Idempotency identity from source |
| `assessed_at` | datetime | Clinical assessment time |
| `assessed_by` | string nullable | Staff/source identity without unnecessary personal data |
| `input_json` | JSON | Immutable normalized input snapshot |
| `local_tier` | string | Approved PDF-compatible tier |
| `emergency_acuity` | string | Independent stability/urgency result |
| `is_complete` | boolean | Completeness independent of severity |
| `suspected_conditions_json` | JSON | Condition codes |
| `matches_json` | JSON | Rule IDs and evidence |
| `missing_fields_json` | JSON | Explicit missing fields |
| `rule_set_version` | string | Reproducibility |
| `supersedes_id` | UUID nullable | Correction chain |
| `created_at` | datetime | Audit timestamp |

Indexes and constraints:

- unique `(hospital_id, source_system, source_pk)` when `source_pk` is present;
- index `(labor_admission_id, assessed_at DESC)`;
- index `(hospital_id, emergency_acuity, assessed_at DESC)`;
- foreign keys consistent with current tenant and patient deletion behavior;
- no in-place mutation of a completed clinical assessment except a documented administrative correction path.

### 8.2 Cached current summary

Add nullable summary fields to `cached_patients` for fast dashboards:

- `maternal_screen_local_tier`;
- `maternal_screen_emergency_acuity`;
- `maternal_screen_condition_codes`;
- `maternal_screen_assessed_at`;
- `maternal_screen_is_complete`;
- `maternal_screen_rule_set_version`.

These are projections of the latest valid assessment. The assessment table remains the source of truth.

### 8.3 Retention and crash behavior

- Persist normalized raw input and computed output in one transaction.
- Update the cached patient summary in that same transaction.
- Publish SSE or notification events only after commit.
- If evaluation throws, reject the assessment write and emit an operational error; never store `NO_LOCAL_MATCH`, `LOCAL_MILD`, or `STABLE` as a fallback.
- If the database commits but notification publishing fails, the next page refresh or reconciliation job must recover from persisted state.
- Corrections create a new row referencing `supersedes_id`; history remains intact.

## 9. Webhook and API changes

### 9.1 Labor webhook extension

Extend `WebhookPatientPayload` in `src/services/webhook.ts` with an optional object:

```ts
maternal_screening?: {
  source_pk?: string;
  assessed_at: string;
  assessed_by?: string | null;
  piH_diagnosed?: boolean | null;
  proteinuria_grade?: string | null;
  creatinine_mg_dl?: number | null;
  platelet_per_ul?: number | null;
  creatinine_baseline_mg_dl?: number | null;
  ast_iu_l?: number | null;
  alt_iu_l?: number | null;
  urine_output_ml_per_hour?: number | null;
  headache?: string | null;
  blurred_vision?: boolean | null;
  epigastric_pain?: boolean | null;
  pulmonary_edema?: boolean | null;
  right_upper_quadrant_pain?: boolean | null;
  vaginal_bleeding?: boolean | null;
  estimated_bleeding_ml?: number | null;
  bleeding_rate?: string | null;
  concealed_bleeding_suspected?: boolean | null;
  abdominal_or_back_pain?: boolean | null;
  uterine_tenderness?: boolean | null;
  frequent_contractions?: boolean | null;
  contraction_duration_exceeds_interval?: boolean | null;
  suprapubic_tenderness?: boolean | null;
  bandls_ring?: boolean | null;
  membranes_ruptured?: boolean | null;
  abnormal_presentation?: boolean | null;
  fetal_heart_rate_bpm?: number | null;
  fetal_tracing_pattern?: string | null;
  maternal_pulse_bpm?: number | null;
  respiratory_rate_per_min?: number | null;
  oxygen_saturation_pct?: number | null;
  consciousness?: string | null;
  shock_signs_present?: boolean | null;
  placenta_previa_excluded?: boolean | null;
  placenta_location_source?: string | null;
};
```

Correct the final property casing during implementation (`pih_diagnosed` at the transport boundary, `piHDiagnosed` internally). Existing senders remain valid because the object is optional.

Admission BP and GA can be reused only from the same payload/assessment context. Do not silently combine new symptoms with stale cached vitals. The normalizer must record the timestamp and provenance used for every reused value.

Do not accept `placenta_previa_excluded: true` without an approved provenance value and timestamp. This field supports a clinician's safety assessment but must never automatically authorize, enable, or recommend digital examination. It requires stronger validation and audit than ordinary observations.

### 9.2 Validation

Validate:

- ISO timestamp and future-time tolerance;
- numeric ranges that reject impossible values without rejecting clinically extreme plausible values;
- enum values;
- tenant/patient identity;
- idempotency keys;
- nullable Boolean semantics;
- maximum JSON sizes; and
- malformed or unknown rule inputs.

Return the repository-standard validation envelope and field-specific errors. Invalid assessments must not partially update the cached summary.

### 9.3 Read API

Extend `GET /api/patients/[an]` or add a bounded nested endpoint to return:

- latest maternal-screen summary;
- raw normalized inputs appropriate for the caller's authorization;
- matched rules and evidence;
- missing fields;
- assessment history with pagination; and
- supersession/correction markers.

Prefer a nested endpoint if assessment history materially increases the existing patient response size:

```text
GET /api/patients/{an}/maternal-screenings?limit=20&cursor=...
```

### 9.4 Manual assessment API

If the UI must capture assessments directly, add:

```text
POST /api/patients/{an}/maternal-screenings
```

Authorization must match clinical write operations already used in the maternity ward. Do not accept client-calculated local tier, emergency acuity, or completeness; the server always evaluates raw input.

### 9.5 Documentation

Update `docs/WEBHOOK-SPEC.md` with:

- optional payload schema;
- examples for each local tier, emergency-acuity state, and hemorrhage pattern;
- unknown versus false semantics;
- source timestamp requirements;
- idempotency behavior;
- rule-set version behavior;
- backward compatibility; and
- error examples.

Update the HOSxP Pascal sender only after mapping the required source tables and confirming which findings are actually structured in HOSxP. Unavailable fields must be sent as null, not inferred from text.

## 10. UI and workflow design

### 10.1 Labor admission screen

Add a structured section with:

- automatically populated GA, BP, and FHR with timestamp/source labels;
- symptom and bleeding questions with `Yes`, `No`, and `Not assessed` states;
- urine/laboratory fields;
- a completeness indicator;
- immediate severe-emergency banner when a severe invariant matches; and
- explicit save/assess action.

When bleeding is present and placenta previa has not been excluded, the UI must show the locally approved examination-safety warning. It must not offer a routine digital-examination checklist action that could be misread as authorization.

The form must remain usable if some laboratory results are pending. Pending labs must not hide severe clinical or BP findings.

### 10.2 Patient detail

Add a `Maternal screening` card near the existing admission snapshot and partograph alert summary:

- local tier and emergency acuity;
- assessment age;
- complete/incomplete state;
- suspected conditions;
- exact matched evidence;
- missing required data;
- rule-set version; and
- history link.

### 10.3 Maternity ward/dashboard

Expose the latest result on bed tiles and relevant patient lists:

- severe: persistent high-visibility emergency treatment;
- moderate: distinct warning treatment;
- mild: lower-intensity but visible status;
- incomplete: neutral/amber data-quality marker, never green;
- stale: show the age of the assessment and follow the approved reassessment interval.

Do not merge either field with `partographSeverity`. A patient may have `LOCAL_SEVERE`, `EMERGENCY`, and a separate partograph alert state simultaneously.

### 10.4 Alert events

Add an SSE event such as:

```ts
type MaternalScreenStateChangedEvent = {
  type: 'maternal_screen_state_changed';
  patientId: string;
  previousLocalTier: MaternalScreenLocalTier | null;
  localTier: MaternalScreenLocalTier;
  previousEmergencyAcuity: MaternalEmergencyAcuity | null;
  emergencyAcuity: MaternalEmergencyAcuity;
  isComplete: boolean;
  suspectedConditions: SuspectedMaternalCondition[];
  assessedAt: string;
};
```

Broadcast only after transaction commit and only for a meaningful state transition. Replayed idempotent payloads must not emit duplicate events.

## 11. Implementation phases

### Phase 0 — Clinical rule approval and executable fixture

**Files:**

- `docs/maternal-screen-plan.md`
- proposed `docs/clinical/maternal-screen-rules-v1.yaml`
- proposed `docs/clinical/maternal-screen-acuity-v1.yaml`
- proposed `tests/fixtures/maternal-screen-clinical-cases.json`
- proposed `docs/clinical/maternal-screen-evidence-register.md`

**Tasks:**

1. Convert every PDF criterion into a stable rule ID.
2. Record `allOf`/`anyOf` groupings, exact boundaries, prerequisites, required fields, and labels.
3. Add approved positive, negative, boundary, incomplete, and multi-condition examples.
4. Record approver, approval date, source version, and rule-set version.
5. Define reassessment/staleness requirements and emergency acknowledgement behavior.
6. Obtain the complete Thai source manual cited by the PDF and record issuing organization, health region, revision, publication date, and pages.
7. Decide which external evidence updates the local protocol versus remaining contextual evidence.
8. Define a separate machine-readable emergency-acuity/escalation table with positive, negative, boundary, interaction, and missing-data cases.
9. Record independent approval metadata for both the local-tier fixture and emergency-acuity fixture.

**Exit gate:** Clinical owner signs both decision tables and their expected cases. Until then, externally derived acuity, concealed-bleeding, rupture, and CTG findings are capture-only/shadow evidence and cannot drive production alerts.

### Phase 1 — Pure types, normalization, and rule engine

**Files:**

- new `src/types/maternal-screening.ts`
- new `src/services/maternal-screening.ts`
- new `tests/unit/services/maternal-screening.test.ts`

**Tasks:**

1. Implement enums and discriminated result types.
2. Normalize transport values, especially proteinuria grade.
3. Implement versioned rules using approved fixtures.
4. Calculate local tier, emergency acuity, and completeness independently.
5. Return all matched rule evidence.
6. Prohibit unknown-as-normal defaults.

**Exit gate:** All approved fixture cases and boundary tests pass; the service has no I/O dependencies.

### Phase 2 — Persistence and transactional service

**Files:**

- new `src/db/tables/maternal-screening-assessments.ts`
- table registry/schema-sync files discovered during implementation
- `src/db/tables/cached-patients.ts`
- new `src/services/maternal-screening-store.ts`
- new unit and PGlite integration tests

**Tasks:**

1. Add immutable assessment storage and indexes.
2. Add cached latest-summary fields.
3. Implement idempotent upsert-by-source behavior.
4. Implement correction/supersession.
5. Update assessment and cached summary atomically.
6. Add reconciliation for cached-summary drift.

**Exit gate:** Integration tests prove insert, idempotent replay, correction, rollback, tenant isolation, and latest-summary projection.

### Phase 3 — Webhook and API contracts

**Files:**

- `src/services/webhook.ts`
- webhook route/validation files identified through graph impact analysis
- `src/types/api.ts`
- `src/app/api/patients/[an]/route.ts` or new nested routes
- `docs/WEBHOOK-SPEC.md`
- webhook/API tests

**Tasks:**

1. Add optional maternal-screen payload.
2. Validate enums, ranges, timestamps, and nullable answers.
3. Evaluate only on the server.
4. Persist within the current patient-processing transaction boundary or a clearly documented adjacent transaction.
5. Return latest assessment and paginated history.
6. Document backward-compatible behavior.

**Exit gate:** Old webhook fixtures remain green; new end-to-end API tests prove a real stored assessment and returned result.

### Phase 4 — Patient-detail and assessment UI

**Files:**

- `src/app/(provincial)/patients/[an]/page.tsx`
- new `src/components/patient/MaternalScreeningCard.tsx`
- new assessment form component if manual input is in scope
- component/page tests

**Tasks:**

1. Render latest local tier, emergency acuity, suspected conditions, evidence, completeness, age, and version.
2. Add assessment history.
3. Add tri-state inputs if manual entry is authorized.
4. Ensure keyboard navigation, semantic labels, focus behavior, and non-color status cues.
5. Prevent stale or incomplete assessments from looking normal.

**Exit gate:** Component tests cover all states; accessibility checks pass; severe evidence is visible without opening secondary panels.

### Phase 5 — Ward alerts and event propagation

**Files:**

- ward query/projection files identified through the graph
- `src/components/maternity/BedTile.tsx`
- `src/components/maternity/BedTileFull.tsx`
- alert-summary components
- SSE event types and publishing service
- event and dashboard tests

**Tasks:**

1. Add summary fields to ward projections.
2. Display local tier and emergency acuity separately from partograph severity.
3. Broadcast local-tier or emergency-acuity transitions after commit.
4. Deduplicate replayed events.
5. Add staleness display and approved reassessment prompts.

**Exit gate:** Integration or browser-level test proves webhook/manual assessment → database → API → ward UI/event.

### Phase 6 — HOSxP mapping and controlled rollout

**Files:**

- `docs/hosxp/KKLRMSWebhookUnit.pas`
- HOSxP source mapping documentation
- simulation profiles and smoke checks

**Tasks:**

1. Map structured HOSxP sources for every field.
2. Leave unavailable fields null.
3. Add representative simulation profiles for each local tier, emergency-acuity state, and hemorrhage pattern.
4. Run shadow mode without workflow-changing alerts.
5. Compare system output with clinician assessments.
6. Activate UI alerts only after clinical acceptance metrics are met.

**Exit gate:** Shadow-mode review has no unexplained severe false negatives in the approved validation cohort, and all mismatches are adjudicated before activation.

## 12. Test strategy

### 12.1 Unit tests

Use table-driven cases for every approved boundary:

- GA 19+6, 20+0, 25+6, and 26+0;
- SBP 139, 140, 149, 150, 159, and 160;
- DBP 99, 100, 109, and 110, plus clinically approved lower boundaries;
- creatinine 1.10 and the smallest supported value greater than 1.10;
- creatinine doubling from a known baseline and missing baseline;
- platelets 100,000 and 99,999;
- platelets 150,000 and 149,999 when NICE-style concern rules are adopted;
- FHR 109, 110, 160, and 161;
- every supported proteinuria spelling and grade;
- each symptom independently;
- each hemorrhage pattern;
- concealed abruption with no visible bleeding;
- suspected uterine rupture with intra-abdominal signs and no vaginal bleeding;
- vasa-previa-compatible bleeding with ruptured membranes and sinusoidal tracing;
- painless bleeding that remains suspected, not diagnosed placenta previa;
- normal FHR that does not downgrade maternal instability;
- bleeding with GA 23+6, 24+0, 25+6, 26+0, and unknown GA;
- contradictory and incomplete inputs;
- multiple simultaneous severe findings;
- severe plus missing unrelated fields;
- stable rule IDs and rule-set version.

### 12.2 Integration tests

Prove:

- schema creation and indexes;
- tenant isolation;
- assessment transactionality;
- cached latest-summary consistency;
- idempotent webhook replay;
- correction/supersession;
- backward compatibility for legacy payloads;
- invalid payload rollback;
- result retrieval and history pagination;
- post-commit event emission only.

### 12.3 UI tests

Cover:

- all local-tier and emergency-acuity states;
- complete versus incomplete;
- unknown answers;
- suspected-condition evidence;
- stale assessment;
- history and correction markers;
- loading, empty, and API error states;
- keyboard-only completion;
- screen-reader names;
- color-independent status identification;
- narrow and wide layouts.

### 12.4 End-to-end smoke test

The smoke test must prove a real effect:

1. Submit a severe antepartum-hemorrhage assessment through the supported input path.
2. Confirm the assessment row and cached patient summary are committed.
3. Fetch the patient API and verify the severe result and matched rule IDs.
4. Open the patient/ward surface and verify the severe badge and evidence.
5. Confirm one transition event was emitted.
6. Replay the identical payload and confirm no duplicate row or event.

### 12.5 Regression gates

Run, as applicable:

```bash
npm test -- tests/unit/services/maternal-screening.test.ts
npm test -- <maternal-screen integration and UI test paths>
npm run typecheck
npm run lint
npm test
npm run build
```

Use the repository's actual package scripts discovered at execution time; do not assume these names if `package.json` differs.

## 13. Acceptance criteria

1. Every clinically approved PDF criterion has a stable rule ID and at least one positive, negative, and boundary test.
2. The approved rule fixture records exact `AND`/`OR` semantics and carries clinical approval metadata.
3. Missing values never evaluate as healthy or negative findings.
4. A qualifying antepartum-hemorrhage case produces `SEVERE` and lists the exact evidence.
5. Preeclampsia moderate and severe BP boundaries behave exactly as the approved fixture specifies.
6. Proteinuria grades are ordinal and deterministic across accepted source formats.
7. Creatinine and platelet boundary behavior matches approved strict/inclusive operators.
8. The server ignores client-supplied local tier, emergency acuity, and completeness and recomputes them from raw inputs.
9. Assessment input, result, matched rules, missing fields, timestamp, and rule-set version are stored atomically.
10. Idempotent replay creates neither duplicate history nor duplicate events.
11. Corrections preserve the original assessment and create an auditable supersession chain.
12. The latest cached summary can be reconstructed from assessment history.
13. Existing webhook clients remain compatible when the new object is absent.
14. Maternal-screen local tier and emergency acuity are never stored or displayed as partograph severity or ANC risk level.
15. Patient and ward UI show local tier, emergency acuity, completeness, assessment age, suspected condition, and evidence without relying only on color.
16. The end-to-end test proves input → persistence → API → visible UI/event behavior.
17. Shadow mode is the default production rollout state until clinical acceptance is recorded.
18. Production activation is controlled by a documented feature flag and rollback procedure.
19. Local PDF tiers, evidence-based diagnostic features, and emergency acuity are returned as separate fields.
20. The system never requires visible vaginal bleeding to flag a concealed-abruption or internal-bleeding pattern.
21. No system state, provenance value, or placenta-previa exclusion record ever authorizes, enables, or recommends digital examination. Valid evidence may only affect the warning/display state defined by an approved local protocol; examination remains clinician-controlled.
22. Every active clinical rule cites its controlling local source and records supporting or conflicting external guidance.
23. Every rule declares `purpose`, `controllingSourceId`, and supporting sources; external supporting evidence cannot implicitly activate a local tier.
24. Emergency-acuity production logic has its own signed machine-readable fixture and cannot activate merely because the PDF-tier fixture is approved.
25. Completeness remains independent of local tier and emergency acuity in domain types, persistence, API responses, and UI.

## 14. Observability and operations

Add structured metrics/logs without patient-identifying content:

- assessment counts by hospital, source, local tier, emergency acuity, and completeness;
- rule-match counts by rule ID and rule-set version;
- evaluation failures;
- rejected payloads by validation code;
- idempotent replay counts;
- cached-summary reconciliation mismatches;
- event publish failures;
- assessment-to-display latency; and
- stale-assessment counts.

Operational alerts should trigger for evaluation exceptions, sustained event failures, summary drift, or a sudden disappearance of assessments from an active hospital. Local-tier and emergency-acuity events must follow the hospital's approved acknowledgement/escalation workflow; application observability is not a substitute for that workflow.

## 15. Security, privacy, and audit

- Apply existing hospital tenant isolation to every assessment query and write.
- Store only fields required for clinical screening and audit.
- Avoid names, CID, or free-text clinical narratives in logs and event payloads.
- Record source and assessor identity according to existing authorization policy.
- Authorize assessment creation and correction separately if current roles require it.
- Protect history from silent mutation.
- Include rule-set version and evidence in audit exports.
- Review retention requirements with the project's clinical-record policy.

## 16. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Ambiguous PDF grouping | Incorrect classification | Phase 0 clinical decision table is a hard gate |
| Conflicting existing thresholds | Unexpected changes to ANC/partograph behavior | Separate rule set and explicit named constants |
| Missing HOSxP fields | False reassurance | Nullable tri-state inputs and incomplete status |
| Stale ANC/labor values combined | Incorrect current assessment | Timestamp/provenance rules; no silent cross-visit merge |
| Overdiagnosis language | Misleading clinical UI | Use “suspected pattern” and show evidence |
| Duplicate webhook delivery | Duplicate alerts/history | Source idempotency constraint and event transition checks |
| Evaluation or notification crash | Lost/incorrect alert state | Atomic persistence, post-commit events, reconciliation |
| Alert fatigue | Important signals ignored | Shadow mode, tier/acuity-specific presentation, clinician validation |
| Rule changes invalidate history | Unexplainable old decisions | Immutable result plus rule-set version |
| Dashboard query regression | Slower ward view | Cached latest summary and indexed queries |

## 17. Rollout and rollback

### 17.1 Feature flags

Use separate controls:

- `BMS_MATERNAL_SCREEN_INGEST_ENABLED`: accept and store assessments;
- `BMS_MATERNAL_SCREEN_SHADOW_MODE`: calculate but suppress workflow-changing alerts;
- `BMS_MATERNAL_SCREEN_UI_ENABLED`: show result surfaces;
- `BMS_MATERNAL_SCREEN_EVENTS_ENABLED`: emit transition events.

Exact naming should follow the repository's existing environment-variable convention discovered during implementation.

### 17.2 Rollout sequence

1. Deploy schema and dormant code.
2. Enable ingestion in one approved test hospital.
3. Enable shadow calculation and review clinician/system agreement.
4. Enable read-only UI with a shadow label.
5. Resolve and document all severe mismatches.
6. Enable transition events and active presentation for the approved cohort.
7. Expand hospital-by-hospital with monitoring.

### 17.3 Rollback

- Disable UI/events first; continue retaining raw assessments if safe and approved.
- Disable ingestion if input processing is defective.
- Do not destructively remove assessment data during emergency rollback.
- Rebuild cached summaries after corrected rules are deployed only through an explicit, versioned re-evaluation operation; never rewrite original historical results.

## 18. Execution guidance

Before each implementation phase:

1. Call the code-review graph minimal-context tool.
2. Use graph impact and tests-for queries for the files in that phase.
3. Keep migrations, services, APIs, UI, and tests in reviewable vertical slices.
4. Run targeted tests before broader quality gates.
5. Update this plan when discovered repository constraints materially change a phase.

Recommended commit slices:

1. Clinical fixture and pure rule engine.
2. Persistence and transactional store.
3. Webhook/API contract.
4. Patient assessment UI.
5. Ward/event propagation.
6. HOSxP mapping, simulation, observability, and rollout documentation.

Every commit must follow the repository's Lore Commit Protocol and report tested and not-tested surfaces.

## 19. Definition of done

The feature is complete only when:

- Phase 0 clinical approval is recorded;
- all acceptance criteria pass;
- targeted, integration, UI, typecheck, lint, full test, and build gates are green or an explicit approved exception exists;
- the end-to-end effect is demonstrated;
- observability and rollback controls are operational;
- webhook and operator documentation are current;
- no known severe false-negative case remains unexplained in the approved validation cohort; and
- production activation is explicitly recorded per hospital/rule-set version.

## 20. Open decisions checklist

- [ ] Approve preeclampsia `AND`/`OR` grouping.
- [ ] Approve PIH/GA prerequisites.
- [ ] Approve BP repeat-measurement requirements.
- [ ] Resolve proteinuria 2+ overlap.
- [ ] Approve creatinine and platelet operators.
- [ ] Approve FHR boundaries and definition of fetal distress for this screen.
- [ ] Approve hemorrhage suspected-pattern minimum evidence.
- [ ] Define behavior for bleeding with GA below 26 or unknown.
- [ ] Define required versus optional fields.
- [ ] Define reassessment/staleness interval.
- [ ] Define acknowledgement and escalation workflow.
- [ ] Confirm manual UI entry scope and authorized roles.
- [ ] Confirm HOSxP structured-field availability.
- [ ] Approve shadow-mode cohort and acceptance metrics.
- [ ] Obtain and archive the complete Thai source manual cited by the PDF.
- [ ] Decide whether the product displays `MILD/MODERATE/SEVERE` or explicitly prefixes them as local screening tiers.
- [ ] Approve independent emergency-acuity inputs and escalation behavior.
- [ ] Approve concealed-bleeding and uterine-rupture patterns.
- [ ] Approve examination-safety warning and placenta-previa-exclusion provenance.
- [ ] Decide whether PCR/ACR, 24-hour protein, dipstick, or multiple methods are supported.
- [ ] Decide how evidence updates are reviewed when NICE, ACOG, RCOG, SMFM, WHO, or Thai guidance changes.
