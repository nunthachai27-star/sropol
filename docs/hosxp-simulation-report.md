# HOSxP Simulation Report

## Date: 2026-04-07 (updated with second simulation findings)

## Data Coverage

| Category | Count | Notes |
|----------|-------|-------|
| ANC patients | 5 | From `person_anc` + `person_anc_service` (community registry) |
| Total ANC visits | 26 | Visit counts: 8, 2, 7, 4, 5 per patient |
| ANC patients with null HN | 5 / 5 | All ANC patients are community-registered — no `patient` record |
| ANC patients with location data | 1 / 5 | From `person_address` (changwat=25, amphur=08, tambon=10) |
| ANC patients with riskLevel other than LOW | 0 / 5 | `person_anc_risk` table empty (0 rows) |
| ANC patients with null LMP/EDC | 0 / 5 | All have LMP/EDC in this dataset |
| Labor patients | 1 | From `ipt` + `ipt_pregnancy` |
| Labor patients with null anc_count | 1 / 1 | `ipt_pregnancy_vital_sign` has 0 rows for active patients |
| Referral create records | 1 | Zero-padded ID format: `"00000014"` |
| Referral update records | 1 | |
| Referral check test cases | 3 | |
| HOSxP tables queried | 12 | person_anc, person_anc_service, person_anc_risk, opdscreen, ipt, ipt_pregnancy, ipt_labour, patient, referout, person_address, person, dbhospital |

Source: HOSxP PostgreSQL at `192.168.50.177:5432/bmshosxp`, hospital `10679` (น้ำพอง).

---

## Mapping Results

### Clean Mappings (no issues)

- `person.cid` → `cid` — pass-through (server encrypts); use `person.cid` for ANC, not `patient.cid`
- `CONCAT(pname, fname, lname)` → `name` — works for all patients tested
- `person.birthday` → `birthday` — YYYY-MM-DD format matches spec
- `person_anc.preg_no` → `pregNo` — integer, no issues
- `person_anc.lmp` / `person_anc.edc` → `lmp` / `edc` — YYYY-MM-DD, nullable, correct
- `person_anc_service.anc_service_number` → `visitNumber` — integer, works (see note on semantics)
- `person_anc_service.pa_week` → `gaWeeks` — integer, nullable
- `opdscreen.bps/bpd` → `bpSystolic/bpDiastolic` — via JOIN on `person_anc_service.vn`, nullable
- `opdscreen.bw` → `weightKg` — via JOIN on `person_anc_service.vn`, nullable
- `ipt.an` → `an` — exact string
- `calculateAge(person.birthday)` → `age` (labor) — derived correctly; `patient.birthday` also correct for IPD patients
- `ipt.regdate + ipt.regtime` → `admit_date` — combined to ISO 8601 with +07:00 offset
- `ipt.dchdate IS NULL` → `labor_status: "ACTIVE"` — correct
- `ipt_pregnancy.height` → `height_cm` (labor) — numeric
- `referout.refer_number` → `referralId` — zero-padded format `"00000014"` passes through correctly
- `referout.pdx` → `diagnosisCode` — string, nullable (note: correct column is `pdx`, not `icd10`)
- `referout.refer_hospcode` → `toHospitalCode` — HCODE string, correct
- `referout.hn` → `hn` (referral) — joins directly to `patient.hn`; no need for `ovst` intermediate join
- `person_address.chwpart/amppart/tmbpart` → `changwatCode/amphurCode/tambonCode` — 2-digit strings when available

### Mapping Issues Found

| HOSxP Field | Webhook Field | Issue | Resolution |
|-------------|---------------|-------|------------|
| `patient.birthday` | `age` (Labor, required) | HOSxP has no `age` column — must be calculated | Document formula: `floor((today − birthday) / 365.25)`. Added to spec v2.4. |
| `person_anc_service` (no vitals) | `fetalHr`, `fundalHeightCm` | Neither field exists in `person_anc_service` — always null for HOSxP sources | Document as HOSxP-unavailable fields. Vitals come from `opdscreen` via VN join. Added to spec v2.4. |
| `opdscreen.bps/bpd/bw` | `bpSystolic`, `bpDiastolic`, `weightKg` | Must join `opdscreen` via `person_anc_service.vn` — not a direct column | Document HOSxP source for each visit vital field. Added to spec v2.4. |
| `person_anc_service.pa_week` | `gaWeeks` | Value is `0` when `lmp` and `edc` are both null | Document: `gaWeeks: 0` treated as unknown GA; prefer `null`. Added to spec v2.4. |
| `ipt_labour.anc_count` | `anc_count` | Null in 1/3 real labor patients | Document: null means CPD ANC factor is skipped. Added to spec v2.4. |
| `person_anc.risk_level` | `riskLevel` | Always null in HOSxP — KK-LRMS computes risk itself | Document: omit `riskLevel` for HOSxP sources; system classifies automatically. Added to spec v2.4. |
| `referout.referout_emergency_type_id` | `urgencyLevel` | HOSxP stores numeric ID (null/1/2/3); spec requires string enum | Document mapping table in Common Rules section. Added to spec v2.4. |
| `referout.refer_hospcode` | `toHospitalCode` | HOSxP column naming: `refer_hospcode` = destination (receiver). `to_hospcode` column exists but is NULL. | Document: use `refer_hospcode` for `toHospitalCode`. Added to spec v2.4. |
| `person_anc` (no `hn` column) | `hn` (ANC, required) | `person_anc` has no HN — must join `person.cid = patient.cid`. Patients without `patient` record have no HN and cannot be submitted. | Document join path and constraint. Added to spec v2.4. |
| `person.patient_hn` always null | `hn` (ANC) | All 5 ANC patients are community-registered — `person.patient_hn` is null for every row. No `patient` record exists for any of them. | **hn changed from required to optional** (`string \| null`). CID is sole key when HN is null. Added to spec v2.5. |
| `person.cid` vs `patient.cid` | `cid` | Identity join is `person.cid = patient.cid`, not via `person_id` — `patient` has no `person_id` column | Document correct join. Added to spec v2.4. |
| `person_anc_service.anc_service_number` | `visitNumber` | Cumulative across all pregnancies, not per-pregnancy | Document semantics. Added to spec v2.4. |
| `person_anc.blood_hct_result` | _(not in spec)_ | HOSxP stores Hct as string (e.g. `"32.5"`) — used internally for HR3 risk | Added optional `hematocritPct` visit field to spec v2.4. |
| `patient.cid` (null/empty) | `cid` | Foreign workers/walk-ins may have no CID; spec says required for ANC/referral | Document behavior per type. Added Edge Cases section to spec v2.4. |
| `referout.refer_number` | `referralId` | Zero-padded format `"00000014"` differs from expected slash format `"3803/68"` | `referralId` documented as opaque string; both formats valid. Added to spec v2.5. |
| `referout.icd10` (does not exist) | `diagnosisCode` | Correct column is `referout.pdx`, not `icd10` | Corrected HOSxP column name in spec. Added to spec v2.5. |
| `referout.hn` join path | `hn` (referral) | `referout.hn` links directly to `patient.hn`; `ovst` intermediate join is not needed | Documented simpler join path. Added to spec v2.5. |
| `referout_emergency_type_id` always null | `urgencyLevel` | Column not used at this hospital — always null → correctly maps to ROUTINE | Noted that null at some hospitals is expected. Added to spec v2.5. |
| `person_anc_risk` table empty (0 rows) | `riskLevel` | No risk factors stored → `person_anc.risk_level` always null | Default to LOW / omit; KK-LRMS classifies automatically. Added to spec v2.5 edge cases. |
| ANC visit vitals mostly null | `bpSystolic`, `bpDiastolic`, `weightKg` | Only 1 of 5 patients' last visit has VN match to `opdscreen` (~95% null rate) | Expected — document in spec edge cases. Added to spec v2.5. |
| `ipt_pregnancy_vital_sign` empty | `anc_count` (labor) | 0 rows for the 1 active labor patient — `anc_count` null | Already handled as optional. Documented in spec v2.5 edge cases. |
| Location codes mostly null | `changwatCode/amphurCode/tambonCode` | Only 1 of 5 ANC patients has `person_address` row | Already optional fields; noted in spec v2.5 edge cases. |

---

## Spec Changes Applied

### v2.3 → v2.4 (first simulation)

1. **Version bump** — `2.3` → `2.4`
2. **Labor `age` field** — HOSxP derivation formula from `birthday`
3. **Labor `admit_date` field** — combination of `regdate` + `regtime`
4. **Labor `anc_count` field** — null behavior and CPD scoring impact
5. **ANC `hn` field** — join path via `person.cid = patient.cid`; no-HN constraint documented
6. **ANC `cid` field** — correct HOSxP source: `person.cid` (not `patient.cid`)
7. **ANC `edc` field** — frequently null for recent registrations; omit rather than send null
8. **ANC `riskLevel` field** — `person_anc.risk_level` always null; system classifies automatically
9. **ANC `visitNumber` field** — cumulative-counter semantics
10. **ANC `gaWeeks` field** — `gaWeeks: 0` treated as unknown GA; `null` preferred
11. **ANC `fundalHeightCm` field** — not stored in `person_anc_service` (HOSxP unavailable); marked optional but strongly recommended
12. **ANC `weightKg`, `bpSystolic`, `bpDiastolic`** — HOSxP source: `opdscreen` via VN join
13. **ANC `fetalHr` field** — not stored in `person_anc_service`; marked optional but strongly recommended
14. **ANC `hematocritPct` field** — new optional visit field from `person_anc.blood_hct_result`
15. **Referral `toHospitalCode`** — HOSxP source: `referout.refer_hospcode` (not `to_hospcode`)
16. **Referral `referralId`** — slash format `"3803/68"` documented as valid
17. **Referral `urgencyLevel`** — HOSxP numeric→enum mapping table in Common Rules
18. **New Edge Cases section** — no-CID patients, null LMP/EDC, missing CPD factors, visitNumber semantics
19. **New HOSxP Date and Number Formats section** in Common Rules — UTC→Thai time conversion, decimal string parsing, empty-string handling
20. **Referral `diagnosisCode`** — document that empty string `""` from `referout.pdx` must be omitted

### v2.4 → v2.5 (second simulation — null HN findings)

1. **Version bump** — `2.4` → `2.5`
2. **ANC `hn` field** — changed from required `string` to optional `string | null`; when null, CID becomes sole matching key. Documented that all 5 HOSxP ANC patients had null HN (community registry vs hospital registry distinction)
3. **ANC record matching** — updated compound key rule: `hospitalCode + hn` when HN is non-null; CID hash only when HN is null
4. **ANC `fundalHeightCm`** — strengthened note: "not available from HOSxP ANC tables"; marked optional but strongly recommended
5. **ANC `fetalHr`** — strengthened note: "not available from HOSxP ANC tables"; marked optional but strongly recommended
6. **Referral `referralId`** — documented as opaque string identifier; both slash format (`"3803/68"`) and zero-padded format (`"00000014"`) are valid
7. **Referral `diagnosisCode`** — corrected HOSxP column from `referout.icd10` (does not exist) to `referout.pdx`
8. **Referral `toHospitalCode`** — added join path note: `referout.hn` → `patient.hn` directly (no `ovst` intermediate table needed)
9. **Referral `urgencyLevel`** — noted that `referout_emergency_type_id` is null at some hospitals; null correctly maps to ROUTINE
10. **New Edge Cases** — Null HN for community-registered ANC patients; Missing ANC visit vitals (~95% null rate); Empty `person_anc_risk` table → default LOW; Null `anc_count` for labor patients; Null location codes

---

## Data Format Details (from full simulator dump)

| HOSxP format | Example | Webhook requirement | Fix |
|-------------|---------|---------------------|-----|
| UTC datetime | `"2026-03-24T17:00:00.000Z"` | Thai local date `"2026-03-25"` | Add 7h, take date part |
| Decimal string (opdscreen) | `"117.000"` (bps, bpd, bw, height) | `number` | `parseFloat()` |
| String integer (vital signs) | `"140"` (fetal_heart_sound) | `number` | `parseInt()` |
| Empty string (referout.pdx) | `""` | omit field | Treat as null |

## HOSxP Fields Not in Spec (Candidates for Future Versions)

| HOSxP field | Table | Clinical value | Decision |
|-------------|-------|----------------|----------|
| `cervical_open_size` | `ipt_pregnancy_vital_sign` | Labor progress indicator (cm dilation) | Not added to v2.4 — labor partogram data out of scope for webhook |
| `risk_list` | `person_anc` | Comma-separated triggered risk codes (e.g. `"1,5,12"`) | Not added — `riskLevel` sufficient for external systems |
| `labour_hospcode` | `person_anc` | Where patient actually delivered | Not added — covered by journey `current_hospital` tracking |
| `labor_icd10` | `person_anc` | Delivery diagnosis | Not added — out of scope for ANC webhook |
| `thalassaemia_result_id` | `person_anc` | HR2/HR3 risk trigger | Not added — complex lookup; covered by `riskLevel` |
| `anc_finish` | `person_anc` | ANC completion flag | Not added — covered by `labor_status` / journey transitions |

---

## Test Results

**Total: 69/69 pass** (as of second simulation validation run)

| Test Case | Result | Notes |
|-----------|--------|-------|
| ANC payload structure (5 patients) | Pass | All have required fields (cid, name, birthday, pregNo); hn is null for all |
| ANC null HN handling | Pass | `hn: null` stored as `''` in DB; CID-only lookup used |
| ANC null fetalHr (all visits) | Pass | All 26 visits have `fetalHr: null` — field optional, no error |
| ANC null fundalHeightCm (all visits) | Pass | All 26 visits have `fundalHeightCm: null` — field optional, no error |
| ANC riskLevel all LOW | Pass | All 5 patients riskLevel: `"LOW"` (empty person_anc_risk table) |
| ANC visit counts (5 patients) | Pass | Counts: 8, 2, 7, 4, 5 = 26 total visits |
| ANC vitals mostly null | Pass | Only last visit per patient has weight/BP (VN match required) |
| ANC location codes (1 of 5) | Pass | 1 patient with changwat=25, amphur=08, tambon=10; others null |
| Labor required fields (1 patient) | Pass | hn, an, name, cid, age, admit_date present; height=168, weight=87 |
| Labor null anc_count | Pass | `anc_count: null` accepted; CPD factor skipped |
| Referral zero-padded ID | Pass | `referralId: "00000014"` is valid opaque string |
| Referral 3 CIDs in check fixture | Pass | 3 CIDs validated in referral-check fixture |
| Referral urgencyLevel ROUTINE | Pass | `referout_emergency_type_id: null` → `"ROUTINE"` |

---

## Issues Summary

| Issue | Severity | Resolution |
|-------|----------|------------|
| ANC `hn` always null (community registry) | HIGH | `hn` changed to optional; CID-only lookup when null |
| `fetalHr` not available from HOSxP ANC | MEDIUM | Field optional; documented as HOSxP-unavailable |
| `fundalHeightCm` not available from HOSxP ANC | MEDIUM | Field optional; documented as HOSxP-unavailable |
| `person_anc_risk` table empty → always LOW | LOW | Default to LOW / omit; documented in edge cases |
| Referral ID format zero-padded (`"00000014"`) | LOW | `referralId` is opaque string; both formats valid |
| `referout.icd10` column does not exist | LOW | Corrected to `referout.pdx` in spec |
| `referout.hn` → `patient.hn` direct join | LOW | Simplified join path documented |
| `referout_emergency_type_id` always null | LOW | Null → ROUTINE mapping noted |
| ANC visit vitals ~95% null (no VN match) | LOW | Expected behavior; documented in edge cases |
| `ipt_pregnancy_vital_sign` empty for active patients | LOW | `anc_count: null` handled; documented |
| Location codes mostly null | LOW | Already optional; documented in edge cases |

## Recommendations

### High Priority
1. **Consider CID as primary ANC matching key** — With `hn` being null for all HOSxP community-registered ANC patients, CID hash is effectively the only matching key. Consider formalizing CID as the primary key for ANC (with HN as supplementary reference) in a future spec version.
2. **Investigate fundalHeight and fetalHr availability** — Check other HOSxP tables (e.g. `ipt_pregnancy_vital_sign`, nurse assessment tables) for whether these fields are captured during ANC assessments at any HOSxP hospital. They are clinically important for risk classification.
3. **Date timezone conversion** — HOSxP stores UTC; integrators must add 7h to get Thai date. A registration "today" will appear as yesterday in UTC. The integration guide must include conversion code.
4. **Numeric string parsing** — `opdscreen` columns `bps`, `bpd`, `bw`, `height` are decimal strings `"117.000"`. `fetal_heart_sound` is a string integer `"140"`. All must be parsed before sending.

### Medium Priority
5. **Populate `person_anc_risk` or compute risk from classification items** — At most HOSxP hospitals, risk is not stored in `person_anc_risk`. KK-LRMS's auto-classification from clinical fields is the correct fallback, but hospitals should be encouraged to populate this table for audit purposes.
6. **Urgency level mapping table** — now documented in Common Rules; share with hospital IT teams.
7. **Encourage CPD field submission** — real labor fixtures had zero CPD risk factors. Hospitals should submit all 8 CPD fields when available for accurate risk scores.
8. **Empty string vs null** — `referout.pdx = ""` must be treated as null/omit. Server-side validation could reject empty-string `diagnosisCode` in a future version.

### Low Priority
9. **`visitNumber` disambiguation** — consider an optional `visitNumberThisPregnancy` field if cumulative HOSxP number causes dashboard confusion.
10. **`cervical_open_size`** — present in `ipt_pregnancy_vital_sign`. Natural addition if a partogram view is added to the dashboard.
11. **Investigate referral ID formats at other hospitals** — zero-padded format confirmed at น้ำพอง; verify whether other hospitals use different formats to ensure the opaque-string approach is sufficient.
