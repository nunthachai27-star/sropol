# Maternal Screen Evidence Register

**Status:** `PROVISIONAL_UNAPPROVED` — supports rule fixtures `maternal-screen-rules-v1.yaml`
(`ruleSetVersion: 0.1.0-provisional`) and `maternal-screen-acuity-v1.yaml`
(`ruleSetVersion: 0.1.0-provisional`).
**Approved by:** null. **Approved at:** null.

This register records the exact version/date of every source cited by the two
rule fixtures, per `docs/maternal-screen-plan.md` §2.5. Every `sourceId` value
referenced by a YAML rule's `controllingSourceId` or `supportingSourceIds`
MUST appear in the table below. No source in this register authorizes a
production alert until a clinical owner signs the decision tables in both
YAML fixtures.

## Sources

| sourceId | Citation | Version / date reviewed | Relevant sections | Role |
| --- | --- | --- | --- | --- |
| `LOCAL_PDF` | Local screening PDF, `docs/maternal-screen.pdf`. Cites verbatim, as extractable: "คู่มือการดูแลรักษาสตรีตั้งครรภ์ที่มีความเสี่ยงสูงฯ เขตสุขภาพที่ (ปรับปรุงครั้งที่ 3) หน้า 14–17." Health-region number, issuing body, edition date, and complete title are **not recoverable** from the supplied PDF; no exact authoritative online copy was confirmed. **The hospital must supply the complete source before Phase 0 approval.** | Extracted at design time; no independent publication date confirmed | Preeclampsia mild/moderate/severe table; antepartum hemorrhage suspected-condition table | Controlling source for every `LOCAL_PDF_TIER` rule in `maternal-screen-rules-v1.yaml` |
| `SRC-NICE-NG133` | NICE. [Hypertension in pregnancy: diagnosis and management, NG133 — Recommendations](https://www.nice.org.uk/guidance/ng133/chapter/recommendations). | Published 25 June 2019; updated 17 April 2023 at research time | Sections 1.2 and 1.5, Table 2, "Terms used in this guideline" | Supporting evidence for BP thresholds (140/90 hypertension definition, ~160/110 severe hypertension) and for the note that proteinuria is not required for every preeclampsia presentation |
| `SRC-ACOG-PREECLAMPSIA-FAQ` | ACOG. [Preeclampsia and High Blood Pressure During Pregnancy](https://www.acog.org/womens-health/faqs/preeclampsia-and-high-blood-pressure-during-pregnancy). Official patient-facing clinical education. | Retrieval checked 2026-07-16 | Diagnosis and severe features | Supporting evidence for severe-feature symptom list (headache, visual symptoms, epigastric pain, pulmonary edema) and severe BP threshold |
| `SRC-ACOG-DISTRICT-IV-HTN` | ACOG District IV. [Hypertensive Disorders — criteria for preeclampsia with or without severe features](https://www.acog.org/community/districts-and-sections/district-iv/whats-new/countdown-to-intern-year-week-3-hypertensive-disorders). Official educational material; **not** a substitute for the controlling ACOG Practice Bulletin or an approved local protocol. | Retrieval checked 2026-07-16 | Severe-feature criteria: platelets <100,000/µL, creatinine >1.1 mg/dL or doubling, liver dysfunction/RUQ pain, pulmonary edema, treatment-resistant headache/visual symptoms, BP ≥160/110 | Supporting evidence for `PE-LAB-SEVERE-CREATININE-1_1` and `PE-LAB-SEVERE-PLATELET-100K` numeric operators; also documents the creatinine-doubling and liver-dysfunction criteria that this fixture does **not** yet encode as a firing rule (decision 7.5-15) |
| `SRC-RCOG-GTG63-APH` | RCOG. [Antepartum Haemorrhage, Green-top Guideline No. 63](https://www.rcog.org.uk/guidance/browse-all-guidance/green-top-guidelines/antepartum-haemorrhage-green-top-guideline-no-63/). First edition. | Reviewed 5 December 2011; a second edition was reported in development at research time | Summary definition (APH from 24+0 weeks until birth) | Supporting/contextual evidence only — NOT adopted as the controlling local GA boundary (the local PDF's 26+0 threshold controls `APH-GA26-VAGINAL-BLEEDING`); also supports the placenta-previa "major APH cause" pattern |
| `SRC-ACOG-BLEEDING-FAQ` | ACOG. [Bleeding During Pregnancy](https://www.acog.org/womens-health/faqs/bleeding-during-pregnancy). | Retrieval checked 2026-07-16 | Abruption (bleeding + abdominal/back pain) and previa (bleeding often painless) | Supporting evidence for `APH-ABRUPTIO-PATTERN` and `APH-PREVIA-PATTERN` minimum-evidence definitions |
| `SRC-SMFM-CONSULT-37-VASA-PREVIA` | SMFM. [Consult Series #37: Diagnosis and management of vasa previa](https://publications.smfm.org/publications/215-society-for-maternal-fetal-medicine-consult-series-37/). | Published 2015; reaffirmed 2024 | Anatomic definition; suspicion when bleeding accompanies a sinusoidal fetal-heart tracing; rupture of membranes as critical context | Controlling supporting source for `APH-VASA-PREVIA-PATTERN` and `EA-FETAL-SINUSOIDAL-EMERGENCY` |
| `SRC-WHO-EMERGENCY-VAGINAL-BLEEDING` | WHO. [Managing complications in pregnancy and childbirth: vaginal bleeding in later pregnancy and labour](https://iris.who.int/bitstream/handle/10665/42644/9241545879.pdf). Older emergency manual — supporting evidence, not the controlling local policy. | No update date confirmed at research time | Concealed bleeding, uterine tenderness/tonicity, fetal compromise, shock, uterine rupture presentation (intra-abdominal/vaginal bleeding, decreasing pain, abnormal contour, easily palpable fetal parts, maternal tachycardia/shock, absent fetal movement/FHR), digital vaginal examination safety warning | Controlling source for the emergency-acuity fixture's instability findings (shock, consciousness, tachycardia, heavy bleeding) and for `APH-RUPTURE-UTERUS-PATTERN`'s expanded evidence beyond Bandl's ring |

## Sources cited by the design document but not encoded as a rule input in v1

These are recorded for traceability only; they do not back any `sourceId` used
in the YAML fixtures because no v1 rule consumes them yet.

- ACOG severe-feature confirmation timing (two readings ≥4 hours apart, or
  sooner if treatment is urgent) — deliberately **not** encoded as a workflow
  delay (see rules-v1.yaml decision 7.5-9; design doc §7.4.2).
- NICE's lower "clinical concern" thresholds (creatinine ≥1.0 mg/dL, platelets
  <150,000/µL) — recorded as contextual/`EXTERNAL_SAFETY` evidence only, not
  adopted as a `LOCAL_PDF_TIER` trigger in v1 (decision 7.5-7/7.5-8).
- WHO's 22-week and RCOG's 24+0-week APH gestational definitions — recorded
  as supporting evidence only; the local PDF's 26+0 boundary controls
  `APH-GA26-VAGINAL-BLEEDING` (decision 7.5-13).

## Open clinical decisions awaiting Phase 0 sign-off

Known provisional-behavior gaps recorded as unapproved decision entries in
`maternal-screen-acuity-v1.yaml` (`clinicalDecisions`), each pinned by
"P0-GAP"-named cases in `tests/fixtures/maternal-screen-clinical-cases.json`
so the current behavior is explicit, not accidental:

- `T1-VOICE-MODERATE-STABLE` — with all six stability-determination fields
  assessed and no rule firing, `consciousness: VOICE` and
  `bleedingRate: MODERATE` each currently yield `STABLE` (candidate at
  sign-off: escalate both to `URGENT`).
- `T1-BLEEDINGRATE-NONE` — `bleedingRate` has no `NONE` member, so
  "assessed, no bleeding" is inexpressible and an otherwise-normal screen
  yields `UNKNOWN` (conservative); Phase 0 must decide between adding `NONE`
  or treating `vaginalBleeding: false` as bleeding-stable.

The clinician-facing vehicle for resolving all of the above (and every
`clinicalDecision` entry in both YAML fixtures) is the Phase 0 sign-off bundle:
`docs/clinical/maternal-screen-phase0-signoff.md` — a bilingual decision-table
document for the authorized obstetric owner to review and sign.

## Outstanding evidence gap

The local PDF's own cited Thai-language source manual ("คู่มือการดูแลรักษาสตรีตั้งครรภ์ที่มีความเสี่ยงสูงฯ
เขตสุขภาพที่ (ปรับปรุงครั้งที่ 3) หน้า 14–17") has not been located or archived in
full. Per spec §11 Phase 0 task 6, the hospital must supply the complete
source (issuing organization, health region number, edition date, complete
title) before clinical sign-off. Until then, `LOCAL_PDF` in this register
refers only to the extractable content of `docs/maternal-screen.pdf`.
