# HOSxP Field-Source Map — `maternal_screening` Webhook Object (Task H1)

**Date:** 2026-07-17 · **Drives:** Task H2 (Pascal sender extension in `KKLRMSWebhookUnit.pas`)
**Transport contract:** spec `docs/maternal-screen-plan.md` §9.1, validated by
`MS_KNOWN_TRANSPORT_KEYS` in `src/services/webhook.ts` (verified 2026-07-17: **37 keys** —
4 scalar + 17 three-state boolean + 11 bounded numeric + 5 enum; this document maps all 37).

## Binding rule — GC-H1 (never fabricate)

A field with **no structured HOSxP source is sent as `null`** ("not assessed"). It is NEVER
inferred from free text (nurse narrative, `prediag`, `pe_abdomen`, `ultrasound_result`),
NEVER defaulted, and a boolean is NEVER sent as `false` merely because nothing was recorded
(`false` means *assessed and absent*; `null` means *not assessed*). The server's
UNKNOWN/incomplete machinery is designed for sparse input — a mostly-null object is the
**correct** output at hospitals whose HOSxP has no structured labor-triage form.

**Status vocabulary used below**

| Status | Meaning | Sender behavior (H2) |
|---|---|---|
| AVAILABLE | Verified structured column, direct value (unit-safe) | Send when non-null in source |
| PARTIAL | Structured source verified, but needs per-site item/master mapping, a unit check, or a clinically-approved threshold/derivation | Send **null** until the named precondition is signed off / configured |
| NOT AVAILABLE | No structured source exists | Always send `null` (or omit the key) |

**Evidence key**

| Key | Ground |
|---|---|
| (a) | Repo SQL already run against live HOSxP: `src/config/hosxp-queries.ts` |
| (b) | Existing sender: `docs/hosxp/KKLRMSWebhookUnit.pas` (SQL + helpers it already uses) |
| (c) | HOSxP knowledge-MCP lookup — every (c) citation is logged verbatim in [Appendix A](#appendix-a--mcp-evidence-log) |

Anything not groundable in (a)/(b)/(c) is marked NOT AVAILABLE. No column below is guessed.

---

## 1. Main mapping table

### 1.1 Anchor / identity fields

| Field | Status | HOSxP source | Extraction condition / SQL sketch | Value mapping | Evidence |
|---|---|---|---|---|---|
| `source_pk` | **AVAILABLE** (constructed) | `ipt.an` + `ipt_labour_partograph.ipt_labour_partograph_id` (primary) or `ipd_nurse_note.nurse_note_id` (fallback) | See [§2 recommendation](#2-source_pk--assessed_at-recommendation) | String ≤150 chars (server rejects longer — it is the idempotency key) | (a) |
| `assessed_at` | **AVAILABLE** | `ipt_labour_partograph.observe_datetime` (primary) or `ipd_nurse_note.note_date` + `note_time` (fallback) | Latest row per AN: `ORDER BY observe_datetime DESC, ipt_labour_partograph_id DESC LIMIT 1` / `ORDER BY note_date DESC, note_time DESC, nurse_note_id DESC LIMIT 1` (repo latest-row pattern, `WARD_BEDS_OCCUPANCY_FULL`) | Strict ISO-8601 **with offset** — the unit's existing `ISO8601()` helper (`yyyy-mm-dd"T"hh:nn:ss` + `+07:00`) already satisfies `MATERNAL_SCREEN_ISO_8601_PATTERN`. Required field; ≤24 h future tolerance | (a),(b) |
| `assessed_by` | **AVAILABLE** | `ipt_labour_partograph.entry_staff` (primary) or `ipd_nurse_note.doctor_code` (fallback) | Same anchor row as `assessed_at` | Trimmed string ≤150 or null. Staff loginname/code — acceptable; server echoes length only (PDPA) | (a) |

### 1.2 PIH & laboratory fields

| Field | Status | HOSxP source | Extraction condition / SQL sketch | Value mapping | Evidence |
|---|---|---|---|---|---|
| `pih_diagnosed` | **PARTIAL** | `iptdiag` (`an`, `icd10`, `diagtype`; UK (`an`,`icd10`)) | `SELECT 1 FROM iptdiag WHERE an = :an AND (icd10 LIKE 'O13%' OR icd10 LIKE 'O14%' OR icd10 LIKE 'O11%' OR icd10 LIKE 'O16%') LIMIT 1` — code list is a **candidate pending clinical sign-off** | Row found → `true`; none → **`null`** (NEVER `false` — IPD coding usually happens at discharge, so absence of a coded row is not absence of disease) | (c1) |
| `proteinuria_grade` | **AVAILABLE** | `ipt_labour_partograph.urine_protein` | Latest partograph row (anchor row) | **Send the raw string** (`"1+"`, `"trace"`, `"ลบ"`, `"ไม่พบ"`, `"+++"`, …). Server normalizes via `normalizeProteinuriaGrade`; unrecognized spellings become UNKNOWN (never rejected, only non-strings are) | (a) |
| `creatinine_mg_dl` | **PARTIAL** | `lab_order.lab_order_result` via `lab_head` | See [lab query sketch](#13-shared-lab-extraction-sketch). Per-site `lab_items_code` (int, hospital-assigned) must come from **config**, keyed where possible by `lab_items.tmlt_code`/`loinc_code` | Parse with `ParseLabFloat` precedent. **UNIT HAZARD:** confirm `lab_items.lab_items_unit` is mg/dL — a µmol/L value (e.g. 88 ≈ 1.0 mg/dL) passes the server's 0.05–100 bounds as a silent ~88× error | (b),(c2),(c3) |
| `platelet_per_ul` | **PARTIAL** | `lab_order.lab_order_result` via `lab_head` | Same sketch; per-site platelet item code from config | If `lab_items_unit` is 10³/µL (common CBC convention) → **×1000** before sending; if /µL send raw. Server bounds 500–5,000,000 reject an un-converted thousands value (e.g. 250) — a safe failure, but configure the conversion per site | (b),(c2),(c3) |
| `creatinine_baseline_mg_dl` | **NOT AVAILABLE → null** | — | No structured "baseline creatinine" designation exists anywhere in the lab schema; choosing "earliest result this pregnancy" is a clinical rule that has not been approved (GC-H1: not defaulted) | `null` | (c2),(c3) searched; none found |
| `ast_iu_l` | **PARTIAL** | `lab_order.lab_order_result` via `lab_head` | Same sketch; per-site AST/SGOT item code from config | `ParseLabFloat`; IU/L is the standard Thai reporting unit — confirm via `lab_items_unit`. Server bounds 1–50,000 | (b),(c2),(c3) |
| `alt_iu_l` | **PARTIAL** | `lab_order.lab_order_result` via `lab_head` | Same; per-site ALT/SGPT item code | Same as AST | (b),(c2),(c3) |
| `urine_output_ml_per_hour` | **PARTIAL** | `ipd_nurse_note.fluid_output_urine` (per-entry volume); also `ipt_labour_partograph.urine_volume_ml` (per-void volume) | Volumes are recorded per shift/entry with **no structured interval on the row** — HOSxP's own chart scores urine per 8 h / 4 h / 1 h depending on site charting practice | Converting volume→ml/h requires per-site interval semantics (`ipd_nurse_shift_id`) that are not yet confirmed. **Send `null`** until a site's hourly-charting convention is verified — dividing by a guessed interval fabricates a rate (GC-H1) | (a),(c4),(c5) |

### 1.3 Shared lab extraction sketch

Grounded in (c2) table structures and the (c2) trend-chart SQL precedent
(`WHERE o.lab_order_result IS NOT NULL AND o.lab_items_code = {code} ORDER BY h.report_date`):

```sql
SELECT o.lab_order_result, h.report_date, h.order_date
FROM lab_head h
JOIN lab_order o ON o.lab_order_number = h.lab_order_number
WHERE h.hn = :hn
  AND h.order_date >= :regdate          -- THIS admission only (never stale pre-admission labs)
  AND o.lab_items_code = :cfg_item_code -- per-site config; NEVER hardcoded
  AND o.confirm = 'Y'                   -- confirmed results only
  AND o.lab_order_result IS NOT NULL
ORDER BY h.report_date DESC, h.lab_order_number DESC
LIMIT 1
```

Why `hn + order_date >= regdate` and not AN: `lab_head` is verified to carry `hn`, `vn`,
`order_date` (c2); whether IPD lab orders store the AN in `vn` (as `referout.vn` does per
the repo's `PATIENT_REFEROUT_BY_AN` precedent) is **not verified** — the HN + admission-date
window is the fully grounded condition. Labs resulted during the admission but *before* the
anchor observation are acceptable screening inputs (they are this admission's labs), and the
server stores raw inputs with `assessed_at` provenance.

### 1.4 Symptom fields (pre-eclampsia review of systems)

| Field | Status | Reason / near-miss | Evidence |
|---|---|---|---|
| `headache` | **NOT AVAILABLE → null** | No structured symptom capture in the labor or IPD-nursing modules; symptoms live only in free-text nurse narrative (GC-H1 bans free-text inference) | (a),(c4),(c6) |
| `blurred_vision` | **NOT AVAILABLE → null** | Same | (c6) |
| `epigastric_pain` | **NOT AVAILABLE → null** | `ipd_nurse_note.pain_score` exists (a) but is an unlocalized 0–10 scale — cannot yield a location-specific boolean | (a),(c4) |
| `pulmonary_edema` | **NOT AVAILABLE → null** | `iptdiag` could in principle carry J81, but IPD coding is a discharge-time artifact, not a triage-time observation — timing-unsafe for an acute finding | (c1) |
| `right_upper_quadrant_pain` | **NOT AVAILABLE → null** | Same as epigastric pain | (a),(c4) |

### 1.5 Bleeding assessment fields

| Field | Status | Reason / near-miss | Evidence |
|---|---|---|---|
| `vaginal_bleeding` | **NOT AVAILABLE → null** | Near-misses rejected: `labor.placenta_bloodloss` (a) is **third-stage postpartum** blood loss, not an intrapartum bleeding symptom; ANC classifying item 11 "เลือดออกทางช่องคลอด" (b) is ANC-history context, weeks stale | (a),(b) |
| `estimated_bleeding_ml` | **NOT AVAILABLE → null** | Same — `placenta_bloodloss` is the wrong clinical moment | (a) |
| `bleeding_rate` | **NOT AVAILABLE → null** | No structured intrapartum bleeding-rate capture (SPOTTING/LIGHT/MODERATE/HEAVY has no HOSxP counterpart) | (c6) |
| `concealed_bleeding_suspected` | **NOT AVAILABLE → null** | Pure clinical suspicion; nowhere structured | (c6) |

### 1.6 Labor-mechanics fields (abruption / obstructed labor / rupture)

| Field | Status | HOSxP source | Condition / mapping | Evidence |
|---|---|---|---|---|
| `abdominal_or_back_pain` | **NOT AVAILABLE → null** | — | Unlocalized `pain_score` only (see §1.4) | (a),(c4) |
| `uterine_tenderness` | **NOT AVAILABLE → null** | — | `ipt_pregnancy_vital_sign.pe_abdomen` is a **free-text** PE finding (varchar) — GC-H1 bans inference from it | (c7) |
| `frequent_contractions` | **PARTIAL** | `ipt_labour_partograph.contraction_per_10min` (anchor row) | Structured numeric exists, but the transport field is a **boolean** with no raw-count sibling — deriving it embeds a clinical threshold (candidate: ≥5/10 min, tachysystole) that requires clinical sign-off. **Send `null`** until approved | (a) |
| `contraction_duration_exceeds_interval` | **PARTIAL** | `ipt_labour_partograph.contraction_per_10min` + `contraction_duration_sec` (anchor row) | Deterministic derivation exists: with n contractions/10 min of d seconds each, rest interval ≈ (600/n) − d, so the flag is `d > (600/n) − d`. Still a derived clinical construct — **send `null`** until signed off | (a) |
| `suprapubic_tenderness` | **NOT AVAILABLE → null** | — | No structured capture | (c6) |
| `bandls_ring` | **NOT AVAILABLE → null** | — | No structured capture | (c6) |
| `membranes_ruptured` | **PARTIAL** | `ipt_pregnancy_vital_sign.labour_amniotic_type_id` (admission) / `ipt_labour_partograph.labour_amniotic_type_id` + `amniotic_fluid` (anchor row), FK → `labour_amniotic_type` ("Amniotic fluid types (I/A/B/M)"); also `ipt_labour.membrane_explode_type_id` FK → membrane-rupture-type master — but that is part of the **delivery record**, typically filled at/after delivery | Candidate mapping: partograph amniotic code `I` (intact) → `false`; fluid-character codes (clear/meconium/blood) → `true`. `labour_amniotic_type` is a site-editable master, so the canonical code set must be confirmed **per site** and the mapping clinically signed off. **Send `null`** until then | (a),(c7),(c8) |
| `abnormal_presentation` | **PARTIAL** | `ipt_pregnancy_vital_sign.pregnancy_position_id` FK → `labour_pregnancy_position` master (admission exam) | Structured fetal-position FK exists, but which master values count as "abnormal presentation" is a per-site master mapping requiring clinical sign-off. ANC `baby_position` (b) is ANC-context — weeks stale, must NOT be reused (spec §9.1 same-context rule). **Send `null`** until mapping approved | (b),(c7) |

### 1.7 Fetal status fields

| Field | Status | HOSxP source | Condition / mapping | Evidence |
|---|---|---|---|---|
| `fetal_heart_rate_bpm` | **AVAILABLE** | `ipt_labour_partograph.fetal_heart_rate` | Anchor (latest) partograph row | Numeric bpm; server accepts 0–350 and `0` = documented absent FHR (a real finding — do NOT suppress it with a `>0` guard the way admission vitals are guarded). (`ipt_pregnancy_vital_sign.fetal_heart_sound` is an admission varchar — do not use as the live value) | (a) |
| `fetal_tracing_pattern` | **PARTIAL** | `ipt_pregnancy_vital_sign.pregnancy_nst_id` FK → `labour_pregnancy_nst` master ("EFM/NST") | A structured EFM/NST classification exists **only as an admission-time snapshot**, and the master's value set is site-configurable — mapping Thai master rows → `REASSURING|NON_REASSURING|SINUSOIDAL` needs per-site config + clinical sign-off. No per-observation tracing-result table was found. **Send `null`** until approved | (c7),(c8) |

### 1.8 Maternal stability fields

| Field | Status | HOSxP source | Condition / mapping | Evidence |
|---|---|---|---|---|
| `maternal_pulse_bpm` | **AVAILABLE** | `ipt_labour_partograph.pulse` (anchor row); fallback `COALESCE(ipd_nurse_note.pulse, ipd_nurse_note.heart_rate)` when nurse-note-anchored | Same-context rule: only from the anchor row, or a supplement row inside the context window (§2) | Numeric bpm (0–350) | (a) |
| `respiratory_rate_per_min` | **AVAILABLE** | `ipd_nurse_note.respiratory_rate` | Latest nurse note, subject to the §2 context window when the anchor is a partograph row (`ipt_pregnancy_vital_sign.rr` is an admission-only snapshot — not the live value) | Numeric /min (0–150) | (a) |
| `oxygen_saturation_pct` | **AVAILABLE** | `COALESCE(ipd_nurse_note.spo2_ra, ipd_nurse_note.spo2_o2)` — room-air preferred, exact repo precedent (`WARD_BEDS_OCCUPANCY_FULL`) | Same context window as RR | Numeric % (0–100) | (a),(c4) |
| `consciousness` | **NOT AVAILABLE → null** | — | Transport wants AVPU (`ALERT|VOICE|PAIN|UNRESPONSIVE`). Nearest structured neighbor is `ipd_nurse_note.sedation_score` (0 = awake) — a **sedation scale, not AVPU**; converting is clinical inference. No GCS columns confirmed in `ipd_nurse_note` | (c4),(c5) |
| `shock_signs_present` | **NOT AVAILABLE → null** | — | A composite clinical judgment with no structured capture. The raw vitals it summarizes (pulse, BP, SpO2) already travel in their own fields, and the server-side evaluator derives acuity — the sender must not pre-judge | (c6) |

### 1.9 Placenta-previa safety fields

| Field | Status | Reason | Evidence |
|---|---|---|---|
| `placenta_previa_excluded` | **NOT AVAILABLE → null** | `ipt_pregnancy_vital_sign.ultrasound_result` is **TEXT free text** — GC-H1 bans inference, and the server independently rejects `true` without a documented `placenta_location_source` (ULTRASOUND/OTHER_DOCUMENTED). The Pascal sender must **never emit `true`** for this field | (a),(c7) |
| `placenta_location_source` | **NOT AVAILABLE → null** | Follows the above; `null` maps to UNKNOWN server-side | (a),(c7) |

---

## 2. `source_pk` + `assessed_at` recommendation

**Anchor row = the clinical observation the screening object represents.**

1. **Primary anchor: latest `ipt_labour_partograph` row** for the AN
   (`ORDER BY observe_datetime DESC, ipt_labour_partograph_id DESC LIMIT 1`). It is the labor
   observation record and single-handedly carries the most mappable fields (FHR, maternal
   pulse, urine protein, contraction raw data, staff, timestamp).
   - `assessed_at` = `observe_datetime` → `ISO8601()` (+07:00)
   - `assessed_by` = `entry_staff`
   - `source_pk` = `AN:{an}:LP:{ipt_labour_partograph_id}`
2. **Fallback anchor (no partograph rows yet): latest `ipd_nurse_note` row**
   (`ORDER BY note_date DESC, note_time DESC, nurse_note_id DESC LIMIT 1`).
   - `assessed_at` = `note_date` + `note_time` (combine exactly like the unit's existing
     `regdate`+`regtime` pattern in `BuildLabourPatient`)
   - `assessed_by` = `doctor_code`
   - `source_pk` = `AN:{an}:NN:{nurse_note_id}`
3. **Neither exists → send no `maternal_screening` object at all.** `assessed_at` is
   required and must be a real observation time — never `Now` (that would assert an
   assessment that did not happen).

**Cross-source supplement (RR / SpO2 with a partograph anchor):** take them from the latest
`ipd_nurse_note` row **only if** `note_date+note_time` is within a bounded window of the
anchor `observe_datetime` (recommend ±60 min; the exact window needs clinical sign-off —
spec §9.1 forbids silently mixing a fresh anchor with stale vitals). When a supplement row is
used, extend the key: `AN:{an}:LP:{id}:NN:{nurse_note_id}` — a replay with a newer nurse note
then correctly registers as a new observation rather than an idempotent duplicate. Worst-case
length ≈ 40 chars, far under the 150-char server cap.

**Why row PKs and not timestamps in the key:** PKs are immutable and collision-free per site;
timestamps can be edited in HOSxP after the fact, which would silently break idempotency.

**Labs' provenance:** lab values ride the same object with the anchor's `assessed_at`; the
server stores raw inputs + timestamp, satisfying §9.1's provenance requirement. Do not
re-anchor `assessed_at` onto `report_date`.

---

## 3. Summary

| Category | Count | Fields |
|---|---|---|
| **AVAILABLE** | **8** | source_pk, assessed_at, assessed_by, proteinuria_grade, fetal_heart_rate_bpm, maternal_pulse_bpm, respiratory_rate_per_min, oxygen_saturation_pct |
| **PARTIAL** (structured source verified; null until per-site config / clinical sign-off) | **11** | pih_diagnosed, creatinine_mg_dl, platelet_per_ul, ast_iu_l, alt_iu_l, urine_output_ml_per_hour, frequent_contractions, contraction_duration_exceeds_interval, membranes_ruptured, abnormal_presentation, fetal_tracing_pattern |
| **NOT AVAILABLE → null** | **18** | creatinine_baseline_mg_dl, headache, blurred_vision, epigastric_pain, pulmonary_edema, right_upper_quadrant_pain, vaginal_bleeding, estimated_bleeding_ml, bleeding_rate, concealed_bleeding_suspected, abdominal_or_back_pain, uterine_tenderness, suprapubic_tenderness, bandls_ring, consciousness, shock_signs_present, placenta_previa_excluded, placenta_location_source |
| **Total** | **37** | = `MS_KNOWN_TRANSPORT_KEYS` exactly |

**Honest statement (expected, correct outcome):** most symptom/assessment booleans
(headache, visual disturbance, localized pain/tenderness, bleeding assessment, shock signs,
consciousness) are **NOT AVAILABLE in structured HOSxP data and will be `null` until a
structured labor-triage form exists** in HOSxP or the KK-LRMS UI (spec §10.1). This is the
correct GC-H1 outcome — the downstream UNKNOWN/incomplete machinery (three-state booleans,
UNKNOWN enums, completeness scoring) is designed for exactly this sparsity. Day-one HOSxP
sends will meaningfully populate: the anchor identity, dipstick proteinuria, FHR, maternal
pulse, RR, SpO2 — plus admission BP/GA which already ride the same labor payload
(`bp_systolic_admit`/`bp_diastolic_admit`/`ga_weeks`/`ga_day`) and are reused server-side as
same-payload screening inputs.

---

## 4. Notes for H2 (Pascal sender)

1. **`SQL_LABOUR` cannot simply be extended.** It reads `ipt_pregnancy_vital_sign` — a
   one-row-per-AN *admission snapshot* with no timestamp. The screening object needs
   **two new queries** per patient: latest `ipt_labour_partograph` row and latest
   `ipd_nurse_note` row (mirror `WARD_BEDS_OCCUPANCY_FULL`'s ordered-subquery pattern).
   For the labs (when enabled), a third parameterized query per configured lab item (§1.3).
2. **Gating:** the unit has no optional-section gating precedent → per plan Task H2, wrap in
   a const flag default **false** (e.g. `KKLRMS_SEND_MATERNAL_SCREENING: Boolean = False`),
   plus per-feature sub-flags for each PARTIAL group as its precondition is signed off.
3. **Strict server contract (all verified in `src/services/webhook.ts`):**
   - Unknown keys are **rejected** (whole screening object) — emit exactly the documented keys.
   - Booleans must be JSON `true|false|null` — never `'Y'/'N'` strings, never 0/1.
   - `assessed_at` must match the strict ISO pattern **with offset** — the unit's existing
     `ISO8601()` helper is compliant; `FormatDateTime` without the `+07:00` suffix is not.
   - A rejected screening never blocks the patient upsert or the batch; errors come back in
     `maternalScreenIngestErrors[]` — log them like the existing counters in `PostWebhook`.
   - Object size cap 16 KB (irrelevant for scalars, but do not attach anything extra).
4. **Numeric guard difference from admission vitals:** `BuildLabourPatient` suppresses
   zero vitals (`f.AsFloat > 0`). For the screening object, **0 is a real finding** for
   `fetal_heart_rate_bpm`, `urine_output_ml_per_hour`, `estimated_bleeding_ml`,
   `maternal_pulse_bpm` — send 0 when the source row genuinely records 0; send null when the
   column is NULL. (Server bounds already reject impossible zeros for creatinine/platelet/
   AST/ALT — those use sub-zero-excluding minimums.)
5. **Admission-context tightening:** when (and only when) a `maternal_screening` object rides
   along, the server *validates* the payload's `ga_weeks` (4–45), `ga_day` (0–6),
   `bp_systolic_admit` (30–400), `bp_diastolic_admit` (0–350) — an out-of-range value fails
   the screening. Guard these in Pascal (omit-out-of-range) before attaching a screening.
6. **Unit conversions (labs — configure per site, grounded in `lab_items.lab_items_unit`):**
   - **Platelet:** if the site's CBC reports 10³/µL (e.g. result "250"), multiply ×1000 →
     `platelet_per_ul: 250000`. Un-converted values are rejected by bounds (500–5,000,000) —
     a visible, safe failure.
   - **Creatinine:** the dangerous one — µmol/L values (×~88) **pass** the mg/dL bounds
     silently. The per-site config MUST record the unit; refuse to enable creatinine for a
     site whose `lab_items_unit` is not verifiably mg/dL.
   - **AST/ALT:** IU/L standard; verify per site.
   - Prefer keying site lab config by `lab_items.tmlt_code` / `loinc_code` when populated
     (national standard codes, columns verified) — `lab_items_code` is a per-hospital integer
     and MUST NOT be hardcoded in the shared unit (27 hospitals, 27 catalogs).
7. **Result parsing:** reuse the unit's `ParseLabFloat` (strips `%`/whitespace, comma
   decimals, returns False on garbage → omit/null, never 0).
8. **Testing:** this unit is reference Pascal for hospitals and cannot be unit-tested in this
   repo. Task H3's dev-simulation profiles exercise the **identical transport shape**
   end-to-end against the real webhook validator — that is the executable test for H2's
   output contract. State this in the unit's comments.

---

## Appendix A — MCP evidence log

Every (c) citation above, verbatim query → grounding result (all run 2026-07-17):

| Ref | Tool + query | What it returned (grounding) |
|---|---|---|
| (c1) | `mcp__knowledge-mcp__search_knowledge` "iptdiag table columns icd10 diagnosis IPD an diagtype" | `HOSxPIPDRegistryPackage_KnowledgeBase_Full_v2.md`: `iptdiag` DB-verified — PK `ipt_diag_id`, UK (`an`,`icd10`), 14 cols, `diagtype` (principal/co-morbid/complication), FK `icd10`→`icd101.code`; `IPD_KnowledgeBase_Part4.md` D1–D8 SQL (`SELECT * FROM iptdiag WHERE an=:an ORDER BY diagtype, diag_no`) |
| (c2) | `mcp__bms-mantis__search_hosxp_knowledge` "lab_head lab_order table structure lab result columns lab_items_code" | `Laborary_HOSxPLabOrderPackage_KnowledgeBase.md` + `HOSxPIPDDoctorOrderPackage_FULL.md`: `lab_head` (PK `lab_order_number`, `hn`, `vn`, `order_date`, `report_date`, `form_name`), `lab_order` (`lab_order_number` FK, `lab_items_code` FK, `confirm`, `lab_order_result`, `abnormal_result`), `lab_items` (PK `lab_items_code`); `Laborary_KnowledgeBase_Part2_SQL.md`: trend-chart SQL `WHERE o.lab_order_result IS NOT NULL AND o.lab_items_code={code} ORDER BY h.report_date` |
| (c3) | `mcp__bms-mantis__search_hosxp_knowledge` "lab_items columns unit tmlt_code standard code lab_items_name" | `HOSxPSystemSettingLabPackage_FULL.md`: full `lab_items` DDL — `lab_items_code` int PK (site-assigned), `lab_items_unit` varchar(150) free text, `tmlt_code` varchar(10), `loinc_code` varchar(15), `lab_items_normal_value`; confirms per-site catalog + standard-code hooks |
| (c4) | `mcp__knowledge-mcp__search_knowledge` "ipd_nurse_note columns consciousness GCS glasgow coma eye verbal motor sedation" | `IPD_KnowledgeBase_Part2.md` chart-unit SQL #11–18: `ipd_nurse_note` columns `note_date`, `note_time`, `temperature`, `pulse`, `respiratory_rate`, `bp_systolic`, `bp_diastolic`, `spo2_ra`, `spo2_o2`, `sos_score`, `sedation_score`, `weight`, `height`, `bmi`. **No GCS/AVPU columns found**; Mantis #7849 confirms `sedation_score` semantics (0 = ผู้ป่วยตื่นดี / awake) |
| (c5) | `mcp__knowledge-mcp__search_knowledge` "ipd_nurse_note urine output intake oral parenteral columns chart" | Mantis #8708 (field list from BMS dev): `fluid_intake_oral`, `fluid_output_urine`, `urine_qty`, `stools_qty`, `sos_score`, `sedation_score` all in `ipd_nurse_note`; `IPD_KnowledgeBase_Part2.md` SQL #19–20 (`fluid_intake_oral`/`fluid_intake_parenteral` by `ipd_nurse_shift_id`); Mantis #7023: HOSxP scores urine per 8 h/4 h/1 h — interval not on the row |
| (c6) | `mcp__bms-mantis__search_hosxp_knowledge` "ipt_labour table columns membrane rupture presentation bleeding labour_type" | `HOSxPLaborPackage_FULL.md` §5.1: **complete `ipt_labour` field list** (ipt_labour_id PK, an, g/t/p/a/l, ga, ga_day, lmp, edc, `membrane_explode_type_id`, `membrane_type_id`, delivery_type_id, labor_date, prediag, pdx, entry_staff …) — **no structured symptom/bleeding/tenderness columns**; `HOSxPLaborPackage_KnowledgeBase_Full_v2.md`: full labor-module table census (55 tables) incl. masters `labour_amniotic_type` (I/A/B/M), `labour_pregnancy_nst`, `labour_pregnancy_position` — no triage-symptom table exists |
| (c7) | `mcp__bms-mantis__search_hosxp_knowledge` "ipt_pregnancy_vital_sign columns table structure vital sign labor" | `HOSxPLaborPackage_FULL.md` §5.4: **complete `ipt_pregnancy_vital_sign` field list** — an FK (no timestamp → admission snapshot), bw, height, temperature, bps, bpd, rr, hr, `pe_lung`/`pe_heart`/`pe_abdomen` (free-text varchar), fetal_heart_sound, `pregnancy_position_id` FK, cervical_open_size, eff, station, labour_sac_type_id, `labour_amniotic_type_id` FK, hct, `pregnancy_nst_id` FK ("EFM/NST"), `ultrasound_result` TEXT |
| (c8) | same (c6)/(c7) responses | `labour_pregnancy_nst` and `labour_amniotic_type` confirmed as **lookup/master tables** only; no per-observation NST/tracing result table found → tracing pattern is admission-snapshot FK at best |

Non-findings are evidence too: searches (c4)/(c6) specifically looked for AVPU/GCS,
structured symptom, bleeding-assessment, and tenderness columns and found none — those
fields' NOT AVAILABLE status is a verified negative, not an omission.
