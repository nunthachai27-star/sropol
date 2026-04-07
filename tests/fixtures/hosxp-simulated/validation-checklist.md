# HOSxP Simulated Fixture Validation Checklist

Generated from real HOSxP PostgreSQL data at hospital code 10679.
Validated by: data-validator agent (Task #2)
Date: 2026-04-07

---

## Security & Privacy

- [x] CID encrypted with AES-256-GCM before DB storage (`encrypt()` from `@/lib/encryption`)
- [x] CID stored in DB as base64 ciphertext (never plaintext 13-digit string)
- [x] CID hash (SHA-256) computed for cross-hospital lookup
- [x] Patient names encrypted with AES-256-GCM
- [x] No raw PII in `maternal_journeys` or `cached_referrals` tables
- [x] PDPA compliant: decrypt only at display layer

---

## ANC Data (5 patients — anc-patients.json)

- [x] `type: "anc_data"`, `hospitalCode: "10679"`
- [x] Exactly 5 patients (all from `person_anc` community registry)
- [x] All 5 patients have `hn: null` (community ANC patients not in hospital `patient` table)
- [x] All 5 patients have `riskLevel: "LOW"` (`person_anc_risk` table has 0 rows)
- [x] Visit counts per patient: [8, 2, 7, 4, 5] = 26 total visits
- [x] Visit dates span 2024-07-30 to 2025-02-25 (multi-month real data)
- [x] `fetalHr` always null — no FHR column in `person_anc_service`
- [x] `fundalHeightCm` always null — no dedicated fundal height column
- [x] Only the last visit per patient has weight/BP (from `opdscreen` join)
- [x] Earlier visits have null weight and null BP
- [x] Visit dates are chronological within each patient
- [x] 1 of 5 patients has location data: CID `1869900365675`, changwat=25, amphur=08, tambon=10
- [x] 4 of 5 patients have null changwat/amphur/tambon
- [x] CIDs are unique within the payload
- [x] All CIDs are exactly 13 digits
- [x] Birthdays in YYYY-MM-DD format
- [x] LMP/EDC dates in YYYY-MM-DD format

### Null HN Handling (Critical Bug Found and Fixed)

Real HOSxP data reveals `person_anc.patient_hn` is null for all ANC patients. Fix applied:
- `WebhookAncPatient.hn` type updated from `string` to `string | null`
- `processAncWebhook` uses `patient.hn ?? ''` when calling `createJourney`
- `getJourneyByHn` fallback skipped when `patient.hn` is null (avoids empty-string DB lookup)
- DB stores empty string `''` for null-HN patients (satisfies NOT NULL constraint)

---

## Labor Data (1 patient — labor-patients.json)

- [x] `hospitalCode: "10679"`, `mode: "incremental"`
- [x] Exactly 1 active labor patient: AN=`690000004`, HN=`006800004`
- [x] `admit_date: "2026-03-25T15:02:13+07:00"` — ISO 8601 with timezone
- [x] `height_cm: 168`, `weight_kg: 87.0` present
- [x] `anc_count: null` — known gap: IPD admit records don't carry ANC count
- [x] `labor_status: "ACTIVE"`, `gravida: 1`, `ga_weeks: 40`, `age: 30`
- [x] CPD score calculation works with partial data (many factors missing)
- [x] `missingFactors` array populated for absent CPD inputs

### CPD Risk Factor Coverage

| Factor | Present in Fixture |
|--------|--------------------|
| gravida | Yes (1) |
| ga_weeks | Yes (40) |
| anc_count | null |
| height_cm | Yes (168) |
| weight_diff_kg | null |
| fundal_height_cm | null |
| us_weight_g | null |
| hematocrit_pct | null |

---

## Referral Data

### Create (referral-create.json)

- [x] `type: "referral"`, `hospitalCode: "10679"`, `toHospitalCode: "11304"`
- [x] `referralId: "00000014"` — zero-padded integer format (NOT slash format "3803/68")
- [x] Compound key `fromHospitalId + referNumber` prevents duplicate on re-send
- [x] `urgencyLevel: "ROUTINE"` — mapped from null `referout_emergency_type_id`
- [x] `diagnosisCode: "S330"` from `referout.pdx` (column `icd10` does not exist)
- [x] CID `0809764095723` (13 digits)

### Update (referral-update.json)

- [x] `type: "referral_update"`, `hospitalCode: "11304"` (receiving hospital)
- [x] `fromHospitalCode: "10679"` matches create fixture
- [x] `status: "ACCEPTED"`
- [x] `reason` contains Thai text: "รับส่งต่อ — เตียงแผนกสูติกรรมว่าง"

---

## Referral Check (referral-check.json)

- [x] 3 CIDs in fixture:
  - `1770401294201` — ANC patient (first in anc-patients.json)
  - `0999991049501` — labor patient
  - `0000000000000` — unknown, no journey in DB
- [x] Known ANC CID → journey found via CID hash → `care_stage: PREGNANCY`
- [x] Unknown CID `0000000000000` → no journey → `canRefer: false`

---

## Integration

- [x] Hospital `connection_status` set to `ONLINE` after successful webhook processing
- [x] `last_sync_at` updated after webhook processing
- [x] SSE `journey_update` events broadcast for each ANC patient (5 events)
- [x] SSE `sync-complete` event broadcast after labor processing
- [x] SSE `referral_update` event broadcast on referral create
- [x] Upsert: second webhook call updates, does not duplicate journeys or visits
- [x] ANC visits replaced (delete-insert strategy) on re-submit

---

## Mapping Gaps Summary

| Field | Spec Expectation | Real HOSxP Reality | Severity |
|-------|------------------|--------------------|----------|
| `hn` (ANC patients) | non-empty string | null (community registry) | **Critical** — compound key broken |
| `fetalHr` | number | always null | High — no FHR in `person_anc_service` |
| `fundalHeightCm` | number | always null | High — no fundal height column |
| `riskLevel` | LOW/HR1/HR2/HR3 | always LOW | High — `person_anc_risk` table empty |
| `changwatCode/amphurCode/tambonCode` | from address table | 80% null | Medium — partial coverage |
| `anc_count` (labor) | number | null | Medium — not in IPD admit data |
| `referralId` format | slash format "3803/68" | zero-padded int "00000014" | Low — spec updated |
| `referout.icd10` | column name | `.pdx` (correct column) | Spec fixed |
| `referout_emergency_type_id` | ROUTINE/URGENT/EMERGENCY | always null | Low — defaults to ROUTINE |
| Labor vital signs | from `ipt_pregnancy_vital_sign` | 0 rows for active patients | High — no labor vitals |
