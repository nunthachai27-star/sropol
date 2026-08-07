# KK-LRMS Webhook API Specification

**Version:** 2.7
**Base URL:** `https://kk-lrms.bmscloud.in.th`
**Contact:** สำนักงานสาธารณสุขจังหวัดขอนแก่น (สสจ.ขอนแก่น)

## Overview

The KK-LRMS Webhook API allows **non-HOSxP hospitals** (private hospitals, hospitals using other HIS systems) to submit patient data into the centralized monitoring system. The API supports the full pregnancy continuum:

| Data Type | Description | Payload `type` |
|-----------|-------------|----------------|
| **Labor** | Active labor room patients | _(none — default)_ |
| **ANC** | Pregnancy registration + prenatal visit data | `"anc_data"` |
| **Referral Create** | Initiate inter-hospital referral (sent by รพ.ต้นทาง) | `"referral"` |
| **Referral Update** | Update referral status (sent by รพ.ปลายทาง) | `"referral_update"` |

All data receives identical processing to HOSxP-polled data:

- Patient name and CID encrypted (AES-256-GCM, PDPA compliant)
- CPD Risk Score calculated automatically (labor patients)
- ANC Risk Level classified by 4-tier model (pregnancy patients)
- Cross-hospital transfer detection via CID hash
- Real-time SSE broadcast to dashboard clients
- Hospital connection status updated to ONLINE

---

## Authentication

All webhook requests require a **Bearer token** in the `Authorization` header.

```
Authorization: Bearer kklrms_a1b2c3d4e5f6789012345678901234567890
```

### API Key Format

| Property     | Value                          |
|-------------|--------------------------------|
| Prefix      | `kklrms_`                      |
| Key length  | 47 characters (prefix + 40 hex)|
| Storage     | SHA-256 hash (raw key never stored) |
| Scope       | Bound to one hospital          |
| Revocation  | Immediate, irreversible        |

> **Important:** The raw API key is shown **only once** when created. Store it securely.

### Obtaining an API Key

Contact the KK-LRMS administrator (สสจ.ขอนแก่น) to register your hospital and receive an API key. The admin will:

1. Register your hospital in the system (assign HCODE)
2. Generate an API key bound to your hospital
3. Provide the raw key (one-time display)

---

## Common Rules

### Hospital Code Validation

All payloads require a `hospitalCode` field. The system validates that `hospitalCode` matches the API key's hospital. If mismatched → **403 Forbidden**.

```json
{ "error": "hospitalCode \"10679\" ไม่ตรงกับ API key ของโรงพยาบาล \"10670\"" }
```

### Patient Identity — CID as Primary Key

**CID (เลขบัตรประชาชน)** is the primary patient identifier across all hospitals. The same CID from any hospital maps to the same patient record:

- Same CID from different hospitals → updates the **same** maternal journey
- HN (Hospital Number) is stored as reference only — it is hospital-specific
- CID is encrypted (AES-256-GCM) and stored as SHA-256 hash for matching
- The plain CID is **never stored** — only the encrypted form and hash

> **Multiple pregnancies:** One CID can have multiple journeys (one per pregnancy). The system tracks the most recent journey. When a new pregnancy is detected (different `pregNo` or `lmp`), a new journey is created. If the previous pregnancy is still active (PREGNANCY/LABOR), a **pregnancy overlap warning** is broadcast.

### Record Matching (Compound Keys)

Every record type uses `hospitalCode` + a natural key for matching:

| Type | Compound Key | Create | Update | Delete |
|------|-------------|--------|--------|--------|
| Labor | `hospitalCode` + `an` | New `an` → auto-insert | Existing `an` → auto-update | `action: "delete"` |
| ANC | `hospitalCode` + `hn` (when non-null); `cid` hash (when `hn` is null) | New key → auto-insert | Existing key → auto-update | `action: "delete"` |
| Referral Create | `hospitalCode` + `referralId` | New → auto-insert | Existing → auto-update | `action: "delete"` |
| Referral Update | `fromHospitalCode` + `referralId` | _(create via `type: "referral"`)_ | `status` change | `action: "delete"` |

### Delete Operations

All types support `action: "delete"` for human error correction. Deletes remove the record and all related child data.

### HOSxP Date and Number Formats

HOSxP stores data in formats that require transformation before sending to the webhook:

| HOSxP format | Webhook format | Transformation |
|-------------|----------------|----------------|
| UTC datetime string `"2026-03-24T17:00:00.000Z"` | Thai date `"2026-03-25"` | Add 7 hours, take date part: `new Date(utc).toLocaleDateString('sv', {timeZone: 'Asia/Bangkok'})` |
| Decimal string `"117.000"` (bps, bpd, bw, height in `opdscreen`) | number | `parseFloat("117.000")` → `117` |
| String `"140"` (`fetal_heart_sound` in `ipt_pregnancy_vital_sign`) | number | `parseInt("140", 10)` → `140` |
| Empty string `""` (e.g. `referout.pdx`) | omit field | Treat as null — omit rather than send `""` |

> **Timezone note:** HOSxP stores all datetimes in UTC. Thailand is UTC+7. A patient registered on 2026-03-25 at 08:00 Thai time appears in HOSxP as `"2026-03-24T01:00:00.000Z"`. Always convert to Thai local time before using date values.

### HOSxP urgencyLevel Mapping

For hospitals integrating from HOSxP, the referral urgency is stored as a numeric `referout_emergency_type_id`. Map to the `urgencyLevel` string enum as follows:

| `referout_emergency_type_id` | `urgencyLevel` | Description |
|------------------------------|----------------|-------------|
| `null` or `1`                | `"ROUTINE"`    | ส่งต่อตามปกติ |
| `2`                          | `"URGENT"`     | ด่วน |
| `3`                          | `"EMERGENCY"`  | ฉุกเฉิน |

---

## Endpoint

```
POST /api/webhooks/patient-data
```

### Headers

| Header          | Value                              | Required |
|----------------|------------------------------------|----------|
| Content-Type   | `application/json`                 | Yes      |
| Authorization  | `Bearer <api-key>`                 | Yes      |

### Routing

The system routes to the appropriate handler based on the `type` field:

| `type` field | Handler |
|-------------|---------|
| _(absent)_ | Labor patient processing |
| `"anc_data"` | ANC pregnancy processing |
| `"referral"` | Referral create (sent by sending hospital) |
| `"referral_update"` | Referral status update (sent by receiving hospital) |

---

## 1. Labor Patient Data (default)

Submit labor room patient data. Supports up to **100 patients** per request.

### Request Body

```json
{
  "hospitalCode": "10679",
  "mode": "incremental",
  "patients": [
    {
      "hn": "HN-001",
      "an": "AN-2026-001",
      "name": "นาง ทดสอบ ระบบ",
      "cid": "1100500012345",
      "age": 28,
      "gravida": 3,
      "para": 2,
      "abortion": 0,
      "living_children": 2,
      "preg_no": 3,
      "ga_weeks": 38,
      "ga_day": 4,
      "anc_count": 9,
      "admit_date": "2026-03-08T08:00:00+07:00",
      "height_cm": 148,
      "weight_kg": 75,
      "weight_diff_kg": 20,
      "pre_pregnancy_weight_kg": 55,
      "fundal_height_cm": 37,
      "us_weight_g": 4000,
      "hematocrit_pct": 29,
      "bp_systolic_admit": 145,
      "bp_diastolic_admit": 92,
      "pulse_admit": 88,
      "rr_admit": 18,
      "temperature_admit": 37.2,
      "cervical_open_cm_admit": 4,
      "effacement_pct_admit": 80,
      "station_admit": "-1",
      "labor_status": "ACTIVE"
    }
  ]
}
```

### Required Fields

| Field        | Type   | Description                                    |
|-------------|--------|------------------------------------------------|
| `hospitalCode` | string | Hospital HCODE (must match API key) |
| `hn`        | string | Hospital Number (unique within hospital)  |
| `an`        | string | Admission Number (**match key** for upsert) |
| `name`      | string | Patient full name (auto-encrypted per PDPA)    |
| `cid`       | string | เลขบัตรประชาชน 13 หลัก (auto-encrypted, SHA-256 hash for cross-hospital matching) |
| `age`       | number | Patient age in years (whole years). **HOSxP note:** HOSxP stores `birthday` (YYYY-MM-DD), not `age` — calculate as `floor((today − birthday) / 365.25)` |
| `admit_date`| string | Admission datetime (ISO 8601). **HOSxP note:** combine `ipt.regdate` + `ipt.regtime` → `"2026-03-25T13:26:22+07:00"` |

### Optional Fields — Obstetric Formula (G_P_A_L)

The standard obstetric history pill displayed on the patient card is `G3 P2 A0 L2 — GA 38⁺⁴`. Send all four parts when known so the UI renders the full formula instead of a `G3` placeholder. **HOSxP sources:** `ipt_labour.g/p/a/l/preg_no/ga/ga_day`.

| Field             | Type   | Description |
|-------------------|--------|-------------|
| `gravida`         | number | Pregnancy count G (total pregnancies including current). |
| `para`            | number | Para P (term births ≥ 37 wk). |
| `abortion`        | number | Abortion A (losses < 20 wk). |
| `living_children` | number | Living children L. |
| `preg_no`         | number | Current pregnancy number ("ครรภ์ที่ X"). May differ from `gravida` when prior pregnancies overlap with miscounted gravida. |
| `ga_weeks`        | number | Gestational age in completed weeks. |
| `ga_day`          | number | GA day-of-week precision (0–6). When non-null, the UI renders `38⁺4` instead of `38`. |

### Optional Fields — CPD Risk Factors

| Field                       | Type   | Description                         | CPD Score Impact |
|----------------------------|--------|-------------------------------------|-----------------|
| `gravida`                  | number | Pregnancy count (ครรภ์ที่)           | Gravida=1 → +2 pts |
| `ga_weeks`                 | number | Gestational age in weeks            | ≥40 → +1.5 pts |
| `anc_count`                | number | Antenatal care visits. If null/omitted, ANC-count CPD factor is skipped (scored as 0, flagged in `missingFactors`). **HOSxP source:** `ipt_labour.anc_count` (can be null). | <4 → +1.5 pts |
| `height_cm`                | number | Maternal height in cm               | <150 → +2 pts |
| `weight_kg`                | number | Current weight in kg (at admission). **HOSxP source:** `ipt_pregnancy_vital_sign.bw`. | — |
| `weight_diff_kg`           | number | Weight gain during pregnancy. When omitted, the server **derives it** as `weight_kg − pre_pregnancy_weight_kg` (see below). Sender-supplied value wins. | >20 → +2 pts |
| `pre_pregnancy_weight_kg`  | number | Pre-pregnancy weight (first ANC visit). **HOSxP source:** earliest `person_anc_screen.bw` for this woman, joined via `person.cid → patient.cid`. Lets the dashboard render the gain narrative `"55 → 75 = +20 kg"`. | — (anchor for `weight_diff_kg`) |
| `fundal_height_cm`         | number | Fundal height in cm                 | >36 → +2 pts |
| `us_weight_g`              | number | Estimated fetal weight by U/S       | >3500 → +2 pts |
| `hematocrit_pct`           | number | Hematocrit percentage. **HOSxP source:** `ipt_pregnancy_vital_sign.hct`. | <30 → +1.5 pts |
| `labor_status`             | string | `"ACTIVE"` (default) or `"DELIVERED"` | — |
| `action`                   | string | `"upsert"` (default) or `"delete"` | — |

### Optional Fields — Admission Snapshot

These are the **one-shot vitals and cervical exam captured at the moment of `ipt` admission**, distinct from the ongoing partograph time-series. They drive the "ADMISSION SNAPSHOT" card on the provincial dashboard, which lets receiving hospitals see "she came in with BP 145/92, cervix 4 cm" before the partograph rows arrive. **HOSxP source for all of these:** the single row of `ipt_pregnancy_vital_sign` joined on `an`. Omit any field whose source value is null/0 — the dashboard hides the whole card when no admission data is sent.

| Field                        | Type   | Description |
|-----------------------------|--------|-------------|
| `bp_systolic_admit`         | number | Systolic BP at admission (mmHg). **HOSxP:** `ipt_pregnancy_vital_sign.bps`. UI severity: ≥160 abnormal (severe HT), 140–159 borderline (gestational HT), <90 borderline (hypotension). |
| `bp_diastolic_admit`        | number | Diastolic BP at admission (mmHg). **HOSxP:** `ipt_pregnancy_vital_sign.bpd`. UI severity: ≥110 abnormal, 90–109 borderline, <60 borderline. |
| `pulse_admit`               | number | Pulse at admission (bpm). **HOSxP:** `ipt_pregnancy_vital_sign.hr`. UI severity: ≥120 or <50 abnormal, 100–119 or 50–59 borderline. |
| `rr_admit`                  | number | Respiratory rate at admission (/min). **HOSxP:** `ipt_pregnancy_vital_sign.rr`. |
| `temperature_admit`         | number | Temperature at admission (°C). **HOSxP:** `ipt_pregnancy_vital_sign.temperature`. UI severity: ≥38.5 or <35.5 abnormal, ≥37.5 borderline. |
| `cervical_open_cm_admit`    | number | Cervical dilation at admission (cm). **HOSxP:** `ipt_pregnancy_vital_sign.cervical_open_size`. UI severity: ≥8 abnormal ("Late presentation"), 4–7 borderline ("Active phase"), <4 normal ("Latent"). |
| `effacement_pct_admit`      | number | Cervical effacement at admission (%). **HOSxP:** `ipt_pregnancy_vital_sign.eff`. |
| `station_admit`             | string | Fetal head station at admission. Free-form (`-3`, `-2`, `-1`, `0`, `+1`, `+2`, `+3`). **HOSxP:** `ipt_pregnancy_vital_sign.station`. |

### Optional Fields — Maternal Labor-Triage Screening (PROVISIONAL, flag-gated)

> **⚠️ PROVISIONAL / UNAPPROVED.** This object is evaluated against a
> provisional, clinically-unsigned-off rule set (`ruleSetVersion:
> "0.1.0-provisional"`). It has **no effect at all** unless the server-side
> flag `MATERNAL_SCREEN_INGEST_ENABLED=true` is set (default **OFF**). When
> the flag is off, `maternal_screening` is silently ignored — no validation
> runs, nothing is stored, and the labor payload behaves exactly as it always
> has (see **Backward Compatibility** below). Even when the flag is on, the
> server **always recomputes** `localTier` / `emergencyAcuity` /
> `isComplete` from the raw fields you send — there is no field in this
> object for a sender-supplied tier, acuity, or completeness.

Attach one `maternal_screening` object to a labor patient entry to record a
preeclampsia/eclampsia/hemorrhage/obstructed-labor/fetal-instability triage
screening performed at (or shortly after) admission. It rides on the same
patient entry as every other labor field — there is no separate endpoint.

```json
{
  "hn": "HN-12345",
  "an": "AN-2026-0001",
  "name": "นาง สมศรี ใจดี",
  "cid": "1100500012345",
  "age": 28,
  "admit_date": "2026-07-16T06:00:00+07:00",
  "bp_systolic_admit": 165,
  "bp_diastolic_admit": 112,
  "maternal_screening": {
    "source_pk": "SCR-0001",
    "assessed_at": "2026-07-16T06:05:00+07:00",
    "assessed_by": "RN สมหญิง",
    "pih_diagnosed": false,
    "proteinuria_grade": "2+",
    "headache": "SEVERE",
    "blurred_vision": true,
    "epigastric_pain": false,
    "vaginal_bleeding": false,
    "fetal_heart_rate_bpm": 140,
    "maternal_pulse_bpm": 88,
    "consciousness": "ALERT",
    "shock_signs_present": false
  }
}
```

**Admission BP and GA are NOT part of this object.** They are reused from the
**same payload's** `bp_systolic_admit` / `bp_diastolic_admit` / `ga_weeks` /
`ga_day` — never from a previously-cached vital. If you have new screening
findings but stale/unknown admission vitals, omit those `*_admit`/`ga_*`
fields (they become `null` inputs, not fabricated values).

| Field                                    | Type              | Description |
|-------------------------------------------|-------------------|-------------|
| `source_pk`                                | string ≤150       | Sender idempotency key. Replaying the same key on the same admission is a no-op (see **Idempotency** below). Omit for one-off manual entries. |
| `assessed_at`                              | string (required) | **Strict** ISO 8601 instant with a `Z` or `±HH:MM` offset (e.g. `"2026-07-16T06:05:00+07:00"`) — a bare local time without an offset is rejected. May lead the server clock by at most 24 hours. |
| `assessed_by`                              | string ≤150 \| null | Free-text assessor identity (name/role), snapshotted as-is — not a user-account reference. |
| `pih_diagnosed`                            | boolean \| null   | Pre-existing/gestational hypertension diagnosis on record. |
| `proteinuria_grade`                        | string \| null    | Dipstick grade. Accepts `NEGATIVE`, `TRACE`, `ONE_PLUS`…`FOUR_PLUS`, or common shorthand — `"negative"`, `"neg"`, `"nil"`, `"-"`, `"0"`, `"trace"`, `"tr"`, `"1+"`…`"4+"`, `"1 plus"`, Thai `"ลบ"` / `"ไม่พบ"` / `"ร่องรอย"` — case-insensitive. Unrecognized text maps to `UNKNOWN`, never rejected. |
| `creatinine_mg_dl`                         | number \| null    | Serum creatinine (mg/dL). Bound 0.05–100. |
| `creatinine_baseline_mg_dl`                | number \| null    | Pre-pregnancy/early-pregnancy baseline creatinine, for acute-rise comparison. Bound 0.05–100. |
| `platelet_per_ul`                          | number \| null    | Platelet count (/µL). Bound 500–5,000,000. |
| `ast_iu_l` / `alt_iu_l`                    | number \| null    | Liver transaminases (IU/L). Bound 1–50,000. |
| `urine_output_ml_per_hour`                 | number \| null    | Urine output (mL/h). Bound 0–5,000 (`0` = anuria, a real finding — kept). |
| `headache`                                 | string \| null    | `NONE` \| `MILD` \| `SEVERE`. |
| `blurred_vision`, `epigastric_pain`, `pulmonary_edema`, `right_upper_quadrant_pain` | boolean \| null | Preeclampsia-spectrum symptoms. |
| `vaginal_bleeding`                         | boolean \| null   | `false` means **visibly assessed absent** — it does NOT rule out concealed/internal bleeding (see abruptio pattern below). |
| `estimated_bleeding_ml`                    | number \| null    | Bound 0–20,000 (0 = assessed, no visible loss). |
| `bleeding_rate`                            | string \| null    | `SPOTTING` \| `LIGHT` \| `MODERATE` \| `HEAVY`. |
| `concealed_bleeding_suspected`              | boolean \| null   | Clinician suspicion of internal/concealed hemorrhage — can be `true` even when `vaginal_bleeding` is `false`. |
| `abdominal_or_back_pain`, `uterine_tenderness`, `frequent_contractions`, `contraction_duration_exceeds_interval`, `suprapubic_tenderness`, `bandls_ring` | boolean \| null | Abruptio-placentae / uterine-rupture pattern findings. |
| `membranes_ruptured`, `abnormal_presentation` | boolean \| null | Obstructed-labor findings. |
| `fetal_heart_rate_bpm`                     | number \| null    | Bound 0–350 (`0` = assessed absent FHR, a real finding). |
| `fetal_tracing_pattern`                    | string \| null    | `REASSURING` \| `NON_REASSURING` \| `SINUSOIDAL`. |
| `maternal_pulse_bpm`                       | number \| null    | Bound 0–350. |
| `respiratory_rate_per_min`                 | number \| null    | Bound 0–150. |
| `oxygen_saturation_pct`                    | number \| null    | Bound 0–100 (a value over 100 is physically impossible and is rejected). |
| `consciousness`                            | string \| null    | `ALERT` \| `VOICE` \| `PAIN` \| `UNRESPONSIVE` (AVPU scale). |
| `shock_signs_present`                      | boolean \| null   | Clinical gestalt "shock" (any combination of pulse/BP/consciousness/skin findings). |
| `placenta_previa_excluded`                 | boolean \| null   | See safety rule below — **do not** send `true` without `placenta_location_source`. |
| `placenta_location_source`                 | string \| null    | `ULTRASOUND` \| `OTHER_DOCUMENTED`. Required whenever `placenta_previa_excluded: true` is sent. |

All boolean and enum fields are **three-state**: `true`/a named enum value
(assessed, present), `false`/`NONE`-type value (assessed, absent), or
`null`/omitted (not assessed). See **Unknown vs. False Semantics** below —
never substitute one for another.

**Enum values are case-insensitive** (`"severe"`, `"SEVERE"`, and `"Severe"`
all match); an unrecognized enum value (other than `proteinuria_grade`, which
falls back to `UNKNOWN`) is a **validation error** for that patient, not a
silent drop — fix the spelling.

**Safety rule — `placenta_previa_excluded`:** the server will **reject** the
whole `maternal_screening` object if `placenta_previa_excluded: true` is sent
without a `placenta_location_source` of `ULTRASOUND` or `OTHER_DOCUMENTED`.
This field supports a clinician's own documented safety assessment; it must
never be inferable from convenience, and it never authorizes or recommends a
digital pelvic examination.

#### Unknown vs. False Semantics (GC1)

An unassessed finding and a negative finding are **never interchangeable**.
Sending `false`/`NONE` asserts *"this was checked and is absent"*; omitting
the field or sending `null` asserts *"this was not checked"*. The scoring
engine treats `null`/`UNKNOWN` as **unknown**, not as a reassuring/normal
result — a screening with several unassessed fields can still surface
`isComplete: false` alongside a proven severe/emergency finding from the
fields that *were* assessed. Do not send `false` "to be safe" for a field
you didn't actually check — that suppresses a legitimate "needs assessment"
signal on the dashboard.

#### Idempotency

`source_pk` scopes uniqueness to `(hospitalCode, source_pk)` **within one
labor admission**. Replaying the exact same `source_pk` for the same
admission is a safe no-op (no duplicate row, summary unchanged). Reusing the
same `source_pk` for a **different** admission is treated as a sender error
and is rejected — use a fresh key per admission (e.g. include the AN in your
key). Omit `source_pk` entirely for manual/one-off entries that have no
natural idempotency key; each omitted-key save creates a new row.

To **correct** a prior assessment (not merely replay it), this is a
Phase-4/manual-UI capability — the webhook ingest path does not currently
accept a correction reference. Send corrected findings as a new assessment
with a new `source_pk`; the dashboard's read API exposes the full history so
a clinician can see the sequence.

#### Rule-Set Version

Every stored assessment is stamped with the rule-set version that evaluated
it (currently `"0.1.0-provisional"`). Senders never supply this — it is
purely a server-side provenance marker so a future clinical sign-off/version
bump can be distinguished from the provisional data that came before it in
the assessment history.

#### Backward Compatibility

`maternal_screening` is **entirely optional**. Every existing sender that
has never heard of this field keeps working byte-for-byte unchanged:
`patientsProcessed`/`newAdmissions`/`discharges`/`transfers`/`deleted` are
the only response keys, no `maternal_screening_assessments` row is ever
written, and no extra validation runs. This holds **even when the server
flag is ON** — the object is simply absent from those payloads, so there is
nothing to evaluate.

#### Examples

```bash
# LOCAL TIER — preeclampsia-with-severe-features pattern (LOCAL_SEVERE)
curl -X POST https://kk-lrms.bmscloud.in.th/api/webhooks/patient-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kklrms_your_api_key_here" \
  -d '{
    "hospitalCode": "10679",
    "patients": [{
      "hn": "HN-20001", "an": "AN-2026-2001",
      "name": "นาง ทดสอบ หนึ่ง", "cid": "1100500099001", "age": 32,
      "admit_date": "2026-07-16T06:00:00+07:00",
      "bp_systolic_admit": 165, "bp_diastolic_admit": 112,
      "maternal_screening": {
        "source_pk": "SCR-2001-01",
        "assessed_at": "2026-07-16T06:05:00+07:00",
        "proteinuria_grade": "2+",
        "headache": "SEVERE",
        "blurred_vision": true,
        "vaginal_bleeding": false,
        "fetal_heart_rate_bpm": 140,
        "maternal_pulse_bpm": 88,
        "consciousness": "ALERT",
        "shock_signs_present": false
      }
    }]
  }'

# EMERGENCY ACUITY — maternal shock (EMERGENCY), independent of local tier
curl -X POST https://kk-lrms.bmscloud.in.th/api/webhooks/patient-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kklrms_your_api_key_here" \
  -d '{
    "hospitalCode": "10679",
    "patients": [{
      "hn": "HN-20002", "an": "AN-2026-2002",
      "name": "นาง ทดสอบ สอง", "cid": "1100500099002", "age": 27,
      "admit_date": "2026-07-16T06:10:00+07:00",
      "bp_systolic_admit": 90, "bp_diastolic_admit": 60,
      "maternal_screening": {
        "source_pk": "SCR-2002-01",
        "assessed_at": "2026-07-16T06:12:00+07:00",
        "maternal_pulse_bpm": 128,
        "respiratory_rate_per_min": 26,
        "oxygen_saturation_pct": 91,
        "consciousness": "VOICE",
        "shock_signs_present": true,
        "vaginal_bleeding": false
      }
    }]
  }'

# HEMORRHAGE PATTERN — suspected concealed abruptio (visible bleeding ABSENT)
curl -X POST https://kk-lrms.bmscloud.in.th/api/webhooks/patient-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kklrms_your_api_key_here" \
  -d '{
    "hospitalCode": "10679",
    "patients": [{
      "hn": "HN-20003", "an": "AN-2026-2003",
      "name": "นาง ทดสอบ สาม", "cid": "1100500099003", "age": 30,
      "admit_date": "2026-07-16T06:15:00+07:00",
      "bp_systolic_admit": 100, "bp_diastolic_admit": 65,
      "maternal_screening": {
        "source_pk": "SCR-2003-01",
        "assessed_at": "2026-07-16T06:20:00+07:00",
        "vaginal_bleeding": false,
        "concealed_bleeding_suspected": true,
        "abdominal_or_back_pain": true,
        "uterine_tenderness": true,
        "frequent_contractions": true,
        "fetal_heart_rate_bpm": 90,
        "fetal_tracing_pattern": "NON_REASSURING",
        "maternal_pulse_bpm": 110
      }
    }]
  }'
```

#### Errors — `maternal_screening`-specific

Validation failures for `maternal_screening` are **per-patient, non-fatal**:
the rest of the batch (including that patient's own labor upsert) still
processes normally. The failure surfaces in the response's
`maternalScreenIngestErrors` array (see the extended **Response** section
below) rather than as an HTTP 4xx for the whole request.

| Condition | Example message |
|-----------|------------------|
| Unknown field | `patients[0].maternal_screening has unrecognized field(s): shock_sign_present — check for typos; only documented maternal_screening keys are accepted (spec §9.1)` |
| Missing/malformed `assessed_at` | `patients[0].maternal_screening.assessed_at is required and must be a strict ISO 8601 instant (...); got "2026-07-16"` |
| `assessed_at` too far in the future | `patients[0].maternal_screening.assessed_at is more than 24 hours in the future (got "...") — check the sender clock/timezone offset` |
| Impossible numeric value | `patients[0].maternal_screening.oxygen_saturation_pct 130 is outside the physiologically possible range 0–100 — send null when not assessed` |
| Bad enum value | `patients[0].maternal_screening.headache must be one of NONE\|MILD\|SEVERE\|UNKNOWN or null (got "bad")` |
| Non-three-state boolean | `patients[0].maternal_screening.shock_signs_present must be true, false, or null (three-state assessed/absent/not-assessed; got "yes")` |
| Previa exclusion without provenance | `patients[0].maternal_screening.placenta_previa_excluded=true requires placenta_location_source ULTRASOUND or OTHER_DOCUMENTED — previa exclusion is not accepted without documented provenance` |
| `source_pk` reused across admissions | Assessment rejected with `INVALID_PARAMS`; the sender must use a distinct key per admission. |
| Screening object on a `delete` action | `patients[0].maternal_screening: ignored because the patient is marked action:'delete' — screening cannot attach to a deleted admission; send it on an upsert` |
| Ingest flag OFF | No error at all — the object is silently ignored (GC7); nothing is validated or stored. |

### Ingestion Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `incremental` (default) | Upsert patients in payload. Others **unchanged**. | Event-driven systems |
| `full_snapshot` | Upsert patients in payload. Others **auto-discharged**. | Periodic batch exports |

### Response

```json
{
  "success": true,
  "patientsProcessed": 1,
  "newAdmissions": 1,
  "discharges": 0,
  "transfers": 0,
  "deleted": 0,
  "timestamp": "2026-03-08T08:00:05.123Z"
}
```

**Maternal screening extension (PROVISIONAL, flag-gated):** when
`MATERNAL_SCREEN_INGEST_ENABLED=true` AND at least one patient in the batch
carried a `maternal_screening` object, three extra keys appear. Legacy
responses (flag off, or no `maternal_screening` sent) stay **byte-identical**
to the shape above — these keys are never present otherwise (GC7):

```json
{
  "success": true,
  "patientsProcessed": 1,
  "newAdmissions": 1,
  "discharges": 0,
  "transfers": 0,
  "deleted": 0,
  "timestamp": "2026-07-16T06:05:05.123Z",
  "maternalScreenAssessments": 1,
  "maternalScreenDuplicates": 0,
  "maternalScreenIngestErrors": []
}
```

| Field | Type | Description |
|-------|------|-------------|
| `maternalScreenAssessments` | number | Screenings newly written this request (new rows — corrections count here too). |
| `maternalScreenDuplicates` | number | Screenings that were an idempotent replay of an existing `source_pk` (no row written). |
| `maternalScreenIngestErrors` | string[] | PHI-free, actionable `patients[i].maternal_screening…` messages for any screening that was rejected — see **Errors — `maternal_screening`-specific** above. The rest of the batch (including that patient's labor upsert) is unaffected. |

### Examples

```bash
# CREATE — new labor admission
curl -X POST https://kk-lrms.bmscloud.in.th/api/webhooks/patient-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kklrms_your_api_key_here" \
  -d '{
    "hospitalCode": "10679",
    "patients": [{
      "hn": "HN-12345",
      "an": "AN-2026-0001",
      "name": "นาง สมศรี ใจดี",
      "cid": "1100500012345",
      "age": 28,
      "gravida": 1,
      "ga_weeks": 41,
      "anc_count": 3,
      "admit_date": "2026-03-19T08:00:00+07:00",
      "height_cm": 148,
      "weight_diff_kg": 20,
      "fundal_height_cm": 37,
      "us_weight_g": 4000,
      "hematocrit_pct": 29
    }]
  }'

# UPDATE — same AN, updated vitals
curl -X POST https://kk-lrms.bmscloud.in.th/api/webhooks/patient-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kklrms_your_api_key_here" \
  -d '{
    "hospitalCode": "10679",
    "patients": [{
      "hn": "HN-12345",
      "an": "AN-2026-0001",
      "name": "นาง สมศรี ใจดี",
      "cid": "1100500012345",
      "age": 28,
      "ga_weeks": 42,
      "admit_date": "2026-03-19T08:00:00+07:00",
      "hematocrit_pct": 28
    }]
  }'

# DISCHARGE — mark as delivered
curl -X POST https://kk-lrms.bmscloud.in.th/api/webhooks/patient-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kklrms_your_api_key_here" \
  -d '{
    "hospitalCode": "10679",
    "patients": [{
      "hn": "HN-12345",
      "an": "AN-2026-0001",
      "name": "นาง สมศรี ใจดี",
      "cid": "1100500012345",
      "age": 28,
      "admit_date": "2026-03-19T08:00:00+07:00",
      "labor_status": "DELIVERED"
    }]
  }'

# DELETE — remove wrong admission
curl -X POST https://kk-lrms.bmscloud.in.th/api/webhooks/patient-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kklrms_your_api_key_here" \
  -d '{
    "hospitalCode": "10679",
    "patients": [{
      "hn": "HN-12345",
      "an": "AN-2026-0001",
      "name": "นาง สมศรี ใจดี",
      "cid": "1100500012345",
      "age": 28,
      "admit_date": "2026-03-19T08:00:00+07:00",
      "action": "delete"
    }]
  }'

# FULL SNAPSHOT — send all active patients (missing = auto-discharged)
curl -X POST https://kk-lrms.bmscloud.in.th/api/webhooks/patient-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kklrms_your_api_key_here" \
  -d '{
    "hospitalCode": "10679",
    "mode": "full_snapshot",
    "patients": [
      { "hn": "HN-001", "an": "AN-001", "name": "Patient A", "cid": "1100500011111", "age": 25, "admit_date": "2026-03-19T08:00:00+07:00" },
      { "hn": "HN-002", "an": "AN-002", "name": "Patient B", "cid": "1100500022222", "age": 30, "admit_date": "2026-03-19T10:00:00+07:00" }
    ]
  }'

# MIX — create + update + delete in one request
curl -X POST https://kk-lrms.bmscloud.in.th/api/webhooks/patient-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kklrms_your_api_key_here" \
  -d '{
    "hospitalCode": "10679",
    "patients": [
      { "hn": "HN-NEW", "an": "AN-NEW", "name": "คนใหม่", "cid": "1100500033333", "age": 25, "admit_date": "2026-03-19T12:00:00+07:00" },
      { "hn": "HN-001", "an": "AN-001", "name": "Patient A", "cid": "1100500011111", "age": 25, "admit_date": "2026-03-19T08:00:00+07:00", "ga_weeks": 40 },
      { "hn": "HN-ERR", "an": "AN-ERR", "name": "ข้อมูลผิด", "cid": "1100500044444", "age": 20, "admit_date": "2026-03-19T06:00:00+07:00", "action": "delete" }
    ]
  }'
```

---

## 2. ANC Data (`type: "anc_data"`)

Submit pregnancy registration and prenatal visit data.

### Request Body

```json
{
  "type": "anc_data",
  "hospitalCode": "10679",
  "patients": [
    {
      "hn": "650010",
      "name": "มาลี รักษาครรภ์",
      "cid": "1100700123456",
      "birthday": "1998-05-15",
      "pregNo": 1,
      "lmp": "2025-09-01",
      "edc": "2026-06-08",
      "riskLevel": "HR1",
      "changwatCode": "40",
      "amphurCode": "01",
      "tambonCode": "01",
      "visits": [
        {
          "date": "2025-12-01",
          "visitNumber": 1,
          "gaWeeks": 13,
          "fundalHeightCm": 12,
          "weightKg": 52,
          "bpSystolic": 110,
          "bpDiastolic": 70,
          "fetalHr": 150
        }
      ]
    }
  ]
}
```

### Patient Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `hn` | string \| null | No | Hospital Number. When non-null, used as the **compound match key** with `hospitalCode`. When null, `cid` becomes the sole matching key for this patient. **HOSxP note:** ANC patients are registered in the community `person` registry (not the hospital `patient` table). `person_anc` has no `hn` column — obtain HN by joining `person.cid = patient.cid`. Community-registered patients who have no `patient` record will have `hn: null`; send `null` (do not omit) so the system falls back to CID-only lookup. |
| `name` | string | Yes | Patient name (auto-encrypted) |
| `cid` | string | Yes | เลขบัตรประชาชน 13 หลัก (auto-encrypted, cross-hospital matching). **HOSxP note:** use `person.cid`, not `patient.cid` — the join is `person.cid = patient.cid`. |
| `birthday` | string | Yes | Date of birth (YYYY-MM-DD) |
| `pregNo` | number | Yes | Pregnancy number (ครรภ์ที่) |
| `lmp` | string | No | Last menstrual period (YYYY-MM-DD) |
| `edc` | string | No | Expected date of confinement. **HOSxP note:** `person_anc.edc` is frequently null for recently registered pregnancies — omit rather than send null. |
| `riskLevel` | string | No | `LOW`, `HR1`, `HR2`, `HR3`. **HOSxP note:** `person_anc.risk_level` is null in HOSxP — KK-LRMS computes risk from clinical data. For external non-HOSxP hospitals that do have a risk classification, send it here; otherwise omit and the system will classify automatically. |
| `changwatCode` | string | No | จังหวัด 2-digit (e.g. `"40"` = ขอนแก่น) — for GIS mapping |
| `amphurCode` | string | No | อำเภอ 2-digit (e.g. `"01"` = เมืองขอนแก่น) |
| `tambonCode` | string | No | ตำบล 2-digit (e.g. `"01"` = ในเมือง) |
| `visits` | array | No | ANC visit records |
| `action` | string | No | `"upsert"` (default) or `"delete"` |

### Visit Fields

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | Visit date (YYYY-MM-DD) |
| `visitNumber` | number | Visit sequence number. **HOSxP note:** `person_anc_service.anc_service_number` is cumulative across all pregnancies — a 2nd-pregnancy patient may have `visitNumber: 5` for her 1st visit of this pregnancy. Stored and displayed as-is. |
| `gaWeeks` | number | Gestational age at visit in weeks. When `lmp` and `edc` are both null and GA cannot be computed, prefer `null` over `0` — `gaWeeks: 0` is treated as **unknown GA** (not literally zero weeks pregnant) and GA-based risk factors will be skipped. |
| `fundalHeightCm` | number | Fundal height (cm). Optional but strongly recommended when available. **HOSxP note:** `person_anc_service` has no dedicated fundal height column — this field is not available from HOSxP ANC tables and will always be null for HOSxP sources. Non-HOSxP hospitals that record fundal height should send it. |
| `weightKg` | number | Maternal weight (kg). **HOSxP source:** `opdscreen.bw` via VN join from `person_anc_service.vn`. |
| `bpSystolic` | number | Blood pressure systolic. **HOSxP source:** `opdscreen.bps` via VN join. |
| `bpDiastolic` | number | Blood pressure diastolic. **HOSxP source:** `opdscreen.bpd` via VN join. |
| `fetalHr` | number | Fetal heart rate. Optional but strongly recommended when available. **HOSxP note:** `person_anc_service` has no fetal heart rate column — this field is not available from HOSxP ANC tables and will always be null for HOSxP sources. Commonly null before ~12 weeks GA (fetal heart not yet detectable by Doppler). Non-HOSxP hospitals that record FHR should send it. |
| `hematocritPct` | number | Hematocrit % at this visit (for ANC anemia risk: Hct<28% = HR3 severe anemia). **HOSxP source:** parse `person_anc.blood_hct_result` string to float (e.g. `"32.5"` → `32.5`). |

### ANC Risk Levels (4-Tier Classification)

Risk level classification follows the **เกณฑ์คัดกรองหญิงตั้งครรภ์ตามความเสี่ยง จ.ขอนแก่น** (Khon Kaen Provincial ANC Risk Screening Criteria). External hospitals should classify patients using the criteria below and send the appropriate `riskLevel` value.

| Level | Thai | Clinical Criteria (ตัวอย่างปัจจัยเสี่ยง) | Facility | Provider |
|-------|------|------------------------------------------|----------|----------|
| `LOW` | ความเสี่ยงต่ำ | ไม่มีปัจจัยเสี่ยงใดๆ (No risk factors) | รพ.สต. | พยาบาล/จนท. |
| `HR1` | เสี่ยงสูง ระดับ 1 | อายุ <17 หรือ ≥35, BMI <18.5 หรือ 23-30, ส่วนสูง <145 ซม., O2sat <95%, เลือดออกทางช่องคลอด, ประวัติทารกตายในครรภ์, ประวัติครรภ์เป็นพิษ, ประวัติเบาหวานในครรภ์ | รพ.ชุมชน | แพทย์/พยาบาล |
| `HR2` | เสี่ยงสูง ระดับ 2 | BMI 30-40, ความดัน ≥140/90, ครรภ์ที่ ≥5, Rh Negative, HBsAg/Syphilis/HIV positive, Thalassemia disease, เคยคลอดก่อนกำหนด, เคยผ่าตัดคลอด, โรคประจำตัว (HT/DM/thyroid), Twin DCDA | รพช.แม่ข่าย/รพท. | สูติแพทย์ |
| `HR3` | เสี่ยงสูง ระดับ 3 | BMI ≥40, Severe anemia (Hct<28%/Hb<9), NIPT high risk, Twin MCDA/Triplet+, Abnormal fetal U/S, Placenta accreta, โรคหัวใจ WHO ≥2, โรคไต/APS/SLE, โรคจิตเวชควบคุมไม่ได้ | รพ.จังหวัด/รพศ. | สูติแพทย์/MFM |

> **Note:** The highest triggered rule determines the overall risk level. If a patient triggers both HR1 and HR2 criteria, the level is `HR2`. The full 38-rule classification engine is described in the [KK-LRMS ANC Risk Screening Guide](docs/pregnancy/).

### Response

```json
{
  "success": true,
  "patientsProcessed": 1,
  "created": 1,
  "updated": 0,
  "deleted": 0,
  "timestamp": "2026-03-19T08:00:05.123Z"
}
```

### Examples

```bash
# CREATE — register new pregnancy with visits
curl -X POST https://kk-lrms.bmscloud.in.th/api/webhooks/patient-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kklrms_your_api_key_here" \
  -d '{
    "type": "anc_data",
    "hospitalCode": "10679",
    "patients": [{
      "hn": "650010",
      "name": "มาลี รักษาครรภ์",
      "cid": "1100700123456",
      "birthday": "1998-05-15",
      "pregNo": 1,
      "lmp": "2025-09-01",
      "edc": "2026-06-08",
      "riskLevel": "HR1",
      "visits": [
        { "date": "2025-12-01", "visitNumber": 1, "gaWeeks": 13, "fundalHeightCm": 12, "weightKg": 52, "bpSystolic": 110, "bpDiastolic": 70, "fetalHr": 150 },
        { "date": "2026-02-01", "visitNumber": 2, "gaWeeks": 22, "fundalHeightCm": 22, "weightKg": 55, "bpSystolic": 118, "bpDiastolic": 75, "fetalHr": 145 }
      ]
    }]
  }'

# UPDATE — same HN, add visit + change risk level
curl -X POST https://kk-lrms.bmscloud.in.th/api/webhooks/patient-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kklrms_your_api_key_here" \
  -d '{
    "type": "anc_data",
    "hospitalCode": "10679",
    "patients": [{
      "hn": "650010",
      "name": "มาลี รักษาครรภ์",
      "cid": "1100700123456",
      "birthday": "1998-05-15",
      "pregNo": 1,
      "riskLevel": "HR2",
      "visits": [
        { "date": "2026-03-15", "visitNumber": 3, "gaWeeks": 28, "bpSystolic": 145, "bpDiastolic": 92, "fetalHr": 142 }
      ]
    }]
  }'

# DELETE — wrong pregnancy record
curl -X POST https://kk-lrms.bmscloud.in.th/api/webhooks/patient-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kklrms_your_api_key_here" \
  -d '{
    "type": "anc_data",
    "hospitalCode": "10679",
    "patients": [{
      "hn": "650010",
      "name": "มาลี รักษาครรภ์",
      "cid": "1100700123456",
      "birthday": "1998-05-15",
      "pregNo": 1,
      "action": "delete"
    }]
  }'
```

> **Delete cascades:** Removing a pregnancy record also removes all related ANC visits, risk assessments, newborn records, and referrals.

---

## 3. Referral — Two-Hospital Workflow

Referrals involve **two hospitals**: the sending hospital (รพ.ต้นทาง) and the receiving hospital (รพ.ปลายทาง). Each hospital uses its own API key.

```
รพ.ต้นทาง (sender)                                     รพ.ปลายทาง (receiver)
 ┌──────────────┐    type: "referral"                   ┌──────────────┐
 │ HIS ระบบเดิม  │ ─── CREATE referral ──────────────→  │  KK-LRMS     │
 │ (API key A)   │                                      │  Dashboard   │
 └──────────────┘                                       └──────┬───────┘
                                                               │ แจ้งเตือน
                  ┌──────────────┐    type: "referral_update"  │
                  │ HIS ระบบเดิม  │ ←── ACCEPT/REJECT ────────┘
                  │ (API key B)   │ ─── IN_TRANSIT ──────────→  KK-LRMS
                  └──────────────┘ ─── ARRIVED ──────────────→  KK-LRMS
```

### 3a. Create Referral (`type: "referral"`) — sent by รพ.ต้นทาง

```json
{
  "type": "referral",
  "hospitalCode": "10679",
  "referralId": "REF-2026-0001",
  "hn": "650010",
  "cid": "1100700123456",
  "name": "มาลี รักษาครรภ์",
  "toHospitalCode": "10670",
  "reason": "Preeclampsia ครรภ์ 34 สัปดาห์",
  "diagnosisCode": "O14.1",
  "urgencyLevel": "URGENT",
  "changwatCode": "40",
  "amphurCode": "01",
  "tambonCode": "01"
}
```

#### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `hospitalCode` | string | Yes | Sender's HCODE (matches API key) |
| `referralId` | string | Yes | Sender's referral ID (**compound key** with hospitalCode). This is an opaque string identifier — the system stores and matches it exactly as sent. Hospital-specific formats are both valid: slash format (e.g. `"3803/68"`) and zero-padded integer format (e.g. `"00000014"`). No URL-encoding needed in JSON body. **HOSxP source:** `referout.refer_number`. |
| `hn` | string | Yes | Patient HN at sending hospital |
| `cid` | string | Yes | เลขบัตรประชาชน 13 หลัก (same across all hospitals, auto-encrypted) |
| `name` | string | Yes | Patient name (auto-encrypted) |
| `toHospitalCode` | string | Yes | Destination hospital HCODE (รพ.ปลายทาง). **HOSxP note:** maps from `referout.refer_hospcode` (the destination) — not `referout.to_hospcode` which is NULL in HOSxP. The patient HN is available directly via `referout.hn` (join to `patient.hn` directly; no need to go through the `ovst` table). |
| `reason` | string | Yes | Referral reason |
| `diagnosisCode` | string | No | ICD-10 diagnosis code. **HOSxP note:** the correct column is `referout.pdx` (not `referout.icd10` which does not exist). `pdx` may be an empty string `""` — omit the field rather than sending `""`. |
| `urgencyLevel` | string | No | `ROUTINE` (default), `URGENT`, `EMERGENCY`. **HOSxP note:** see urgencyLevel mapping table in Common Rules. `referout_emergency_type_id` is null at some hospitals (column not used) — this correctly maps to `ROUTINE`. |
| `changwatCode` | string | No | จังหวัด 2-digit (patient address for GIS mapping) |
| `amphurCode` | string | No | อำเภอ 2-digit |
| `tambonCode` | string | No | ตำบล 2-digit |
| `action` | string | No | `"upsert"` (default) or `"delete"` |

> **Patient matching:** `cid` is used for cross-hospital patient matching (SHA-256 hash). When the patient arrives at the receiving hospital with a different HN, the system matches them via CID hash.

> **Auto-create journey:** If the patient HN has no existing maternal journey, one is auto-created in PREGNANCY stage.

> **GIS location codes:** `changwatCode` + `amphurCode` + `tambonCode` form a 6-digit Thai administrative code (e.g. `"40"` + `"01"` + `"01"` = `400101` ตำบลในเมือง อำเภอเมืองขอนแก่น จังหวัดขอนแก่น). These are standard codes from กรมการปกครอง (DOPA) and can be used to plot patient locations on GIS maps.

### 3b. Update Referral Status (`type: "referral_update"`) — sent by รพ.ปลายทาง

```json
{
  "type": "referral_update",
  "hospitalCode": "10670",
  "referralId": "REF-2026-0001",
  "fromHospitalCode": "10679",
  "status": "ACCEPTED",
  "reason": "เตียง L&D ว่าง รับได้"
}
```

#### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `hospitalCode` | string | Yes | Who sends this update (matches API key) |
| `referralId` | string | Yes | Original referral ID from sender |
| `fromHospitalCode` | string | Yes | Sender's HCODE (**compound key** with referralId) |
| `status` | string | Yes* | New status (see below). *Not required when `action: "delete"` |
| `reason` | string | No | Reason for status change |
| `rejectionReason` | string | No | Reason for rejection (REJECTED only) |
| `transportMode` | string | No | `"ambulance"`, `"self"`, etc. (IN_TRANSIT only) |
| `arrivedAt` | string | No | Arrival datetime ISO 8601 (ARRIVED only) |
| `action` | string | No | `"update"` (default) or `"delete"` |

### Referral Statuses

```
INITIATED → ACCEPTED → IN_TRANSIT → ARRIVED
         → REJECTED
```

| Status | Description | Thai | Who sends |
|--------|-------------|------|-----------|
| `INITIATED` | Sender creates referral | สร้างใบส่งต่อ | รพ.ต้นทาง (via `type: "referral"`) |
| `ACCEPTED` | Receiver accepts | รับส่งต่อ | รพ.ปลายทาง |
| `REJECTED` | Receiver rejects | ปฏิเสธ | รพ.ปลายทาง |
| `IN_TRANSIT` | Patient in transit | กำลังเดินทาง | Either hospital |
| `ARRIVED` | Patient arrived | ถึงปลายทาง (updates journey current_hospital) | รพ.ปลายทาง |

### Response

```json
{
  "success": true,
  "referralId": "REF-2026-0001",
  "status": "INITIATED",
  "timestamp": "2026-03-31T08:00:05.123Z"
}
```

### Examples — Full Referral Lifecycle

```bash
# ──────────────────────────────────────────────────────────
# Step 1: รพ.ต้นทาง (10679) CREATE referral → รพ.ปลายทาง (10670)
# ──────────────────────────────────────────────────────────
curl -X POST https://kk-lrms.bmscloud.in.th/api/webhooks/patient-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kklrms_sender_api_key_here" \
  -d '{
    "type": "referral",
    "hospitalCode": "10679",
    "referralId": "REF-2026-0001",
    "hn": "650010",
    "cid": "1100700123456",
    "name": "มาลี รักษาครรภ์",
    "toHospitalCode": "10670",
    "reason": "Preeclampsia ครรภ์ 34 สัปดาห์ ความดันสูง",
    "diagnosisCode": "O14.1",
    "urgencyLevel": "URGENT"
  }'

# ──────────────────────────────────────────────────────────
# Step 2: รพ.ปลายทาง (10670) ACCEPT referral
# ──────────────────────────────────────────────────────────
curl -X POST https://kk-lrms.bmscloud.in.th/api/webhooks/patient-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kklrms_receiver_api_key_here" \
  -d '{
    "type": "referral_update",
    "hospitalCode": "10670",
    "referralId": "REF-2026-0001",
    "fromHospitalCode": "10679",
    "status": "ACCEPTED",
    "reason": "เตียง L&D ว่าง รับได้"
  }'

# ──────────────────────────────────────────────────────────
# Step 3: MARK IN TRANSIT (patient departing)
# ──────────────────────────────────────────────────────────
curl -X POST https://kk-lrms.bmscloud.in.th/api/webhooks/patient-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kklrms_receiver_api_key_here" \
  -d '{
    "type": "referral_update",
    "hospitalCode": "10670",
    "referralId": "REF-2026-0001",
    "fromHospitalCode": "10679",
    "status": "IN_TRANSIT",
    "transportMode": "ambulance"
  }'

# ──────────────────────────────────────────────────────────
# Step 4: CONFIRM ARRIVAL (patient arrived at receiving hospital)
# ──────────────────────────────────────────────────────────
curl -X POST https://kk-lrms.bmscloud.in.th/api/webhooks/patient-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kklrms_receiver_api_key_here" \
  -d '{
    "type": "referral_update",
    "hospitalCode": "10670",
    "referralId": "REF-2026-0001",
    "fromHospitalCode": "10679",
    "status": "ARRIVED",
    "arrivedAt": "2026-03-31T14:30:00+07:00"
  }'

# ──────────────────────────────────────────────────────────
# REJECT referral (alternative to ACCEPT)
# ──────────────────────────────────────────────────────────
curl -X POST https://kk-lrms.bmscloud.in.th/api/webhooks/patient-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kklrms_receiver_api_key_here" \
  -d '{
    "type": "referral_update",
    "hospitalCode": "10670",
    "referralId": "REF-2026-0001",
    "fromHospitalCode": "10679",
    "status": "REJECTED",
    "rejectionReason": "เตียง ICU เต็ม กรุณาส่ง รพ.ขอนแก่น"
  }'

# ──────────────────────────────────────────────────────────
# DELETE — sending hospital corrects error
# ──────────────────────────────────────────────────────────
curl -X POST https://kk-lrms.bmscloud.in.th/api/webhooks/patient-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kklrms_sender_api_key_here" \
  -d '{
    "type": "referral",
    "hospitalCode": "10679",
    "referralId": "REF-2026-0001",
    "hn": "650010",
    "cid": "1100700123456",
    "name": "มาลี รักษาครรภ์",
    "toHospitalCode": "10670",
    "reason": "ลบ",
    "action": "delete"
  }'

# ──────────────────────────────────────────────────────────
# DELETE — receiving hospital corrects error
# ──────────────────────────────────────────────────────────
curl -X POST https://kk-lrms.bmscloud.in.th/api/webhooks/patient-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kklrms_receiver_api_key_here" \
  -d '{
    "type": "referral_update",
    "hospitalCode": "10670",
    "referralId": "REF-2026-0001",
    "fromHospitalCode": "10679",
    "action": "delete"
  }'
```

---

## Edge Cases

### Patients Without CID

HOSxP may have patients with empty or null CID (foreign workers, walk-in patients, unregistered newborns). Behavior by payload type:

| Type | CID Required? | Behavior when CID absent |
|------|---------------|--------------------------|
| Labor | No (optional in practice) | Patient tracked within this hospital only — no cross-hospital journey linking via CID hash |
| ANC | Yes | Cannot submit without CID — validation will reject |
| Referral Create | Yes | Cannot submit without CID — validation will reject |

> **Recommendation:** For labor patients without CID, send `cid: ""` (empty string) or omit the field. The system will create a local-only record with no CID hash.

### Null LMP and EDC

When both `lmp` and `edc` are null (common when pregnancy is entered without date data in HOSxP):

- `gaWeeks` cannot be derived from dates — HOSxP may produce `gaWeeks: 0` in this case
- **`gaWeeks: 0` is treated as unknown GA** (not literally zero weeks pregnant) — prefer `null` to make intent explicit
- ANC risk rules that depend on GA will be skipped; risk level from `riskLevel` field is used as-is
- The journey is still created/updated normally

### Missing CPD Risk Factors (Labor)

The CPD score requires 8 factors: `gravida`, `anc_count`, `ga_weeks`, `height_cm`, `weight_diff_kg`, `fundal_height_cm`, `us_weight_g`, `hematocrit_pct`. When any are absent:

- That factor scores **0 points** (not penalized, but not counted)
- The missing field name is listed in the response's `missingFactors` array
- A CPD score calculated with missing data is flagged but still displayed on the dashboard
- Submit as many CPD fields as your system has available — partial data is better than none

### visitNumber Semantics

HOSxP `person_anc_service.anc_service_number` is a **cumulative counter across all pregnancies** for a patient — not a per-pregnancy visit number. A patient on her 2nd pregnancy may have `visitNumber: 5` for what is clinically her 1st ANC visit of this pregnancy. The system stores and displays the HOSxP service number as-is.

### Null HN for Community-Registered ANC Patients (HOSxP)

In HOSxP, ANC patients are registered in the community `person` registry (`person_anc`, `person` tables), not the hospital `patient` table. `person.patient_hn` is null for all community-registered patients — they have never visited the hospital as an outpatient or inpatient patient. When building an ANC webhook payload from HOSxP:

- Join `person.cid = patient.cid` to get the HN
- If no matching `patient` row exists, send `hn: null`
- The system will use the CID hash as the sole matching key

> **Important:** Send `hn: null` explicitly rather than omitting the field, so the server knows HN lookup was attempted and fell back to CID.

### Missing ANC Visit Vitals (HOSxP)

HOSxP ANC visit records (`person_anc_service`) are not linked to `opdscreen` for most visits. The `vn` (visit number) field on `person_anc_service` only contains a value for visits where the patient also had an OPD encounter on the same day. Typically only the **most recent ANC visit** per patient has a VN match — earlier visits will have null `bpSystolic`, `bpDiastolic`, and `weightKg`. This is expected; send the null values without transformation.

### Empty `person_anc_risk` Table → Default to LOW

`person_anc_risk` is the HOSxP table that stores triggered risk factors. At many hospitals this table has zero rows because risk classification is performed manually or outside HOSxP. When the table is empty:

- `person_anc.risk_level` will also be null
- Omit `riskLevel` from the payload or send `"LOW"` — the KK-LRMS will classify risk from clinical data automatically
- Do not send a non-LOW value unless the hospital system has genuinely classified the patient as high-risk

### Partial G_P_A_L Components

`gravida` is the historic single-value field; `para`, `abortion`, and `living_children` are individually optional. Behavior:

- All four present → UI renders full pill `G3 P2 A0 L2`.
- Only `gravida` present → UI renders `G3` (back-compat with v2.5 senders).
- Mix (e.g. only `gravida` + `para`) → UI renders only the parts you sent: `G3 P2`.

There is no validation that `gravida = para + abortion + (current pregnancy)`; the system stores what you send. Keep your HIS source of truth authoritative.

### Server-Side `weight_diff_kg` Derivation

When you send `weight_kg` and `pre_pregnancy_weight_kg` but omit `weight_diff_kg`, the server computes `weight_diff_kg = weight_kg − pre_pregnancy_weight_kg` (rounded to 2 decimals). When you supply `weight_diff_kg` explicitly, your value wins (it may include trimester-specific corrections the server doesn't model). When neither anchor is sent, `weight_diff_kg` stays null and the CPD weight-gain factor is skipped.

### Admission Snapshot vs. Partograph

`*_admit` fields are the **vitals at the moment of admission** — a one-shot snapshot stored on the labor row itself. Subsequent observations belong on the partograph (`type: "partograph"` payload, separate endpoint). Sending the same BP value as both `bp_systolic_admit` and an early partograph row is fine; the dashboard distinguishes them and shows the admit value as the baseline.

### Null `anc_count` for Labor Patients

HOSxP `ipt_labour.anc_count` may be null for labor patients. This is common when the labor admission is entered before the ANC count is recorded. When null:

- Omit `anc_count` or send `null` — both are accepted
- The CPD ANC-count factor is skipped (scored as 0, listed in `missingFactors`)
- The overall CPD score is still calculated from available factors

### Null Location Codes

`changwatCode`, `amphurCode`, and `tambonCode` (from `person_address` or `patient.chwpart/amppart/tmbpart`) may be null for many patients. These fields are optional and used only for GIS mapping. Missing location data does not affect clinical processing.

---

## Error Responses

| Status | Body | Cause |
|--------|------|-------|
| 400 | `{ "error": "\"patients\" must be an array" }` | Invalid JSON or missing required fields |
| 400 | `{ "error": "\"patients\" array must not be empty" }` | Empty patients array |
| 400 | `{ "error": "\"patients\" array must not exceed 100 items per request" }` | Too many patients (labor) |
| 400 | `{ "error": "\"referralId\" is required (string)" }` | Missing referral ID |
| 400 | `{ "error": "\"hn\" is required (string)..." }` | Missing patient HN (referral create) |
| 400 | `{ "error": "\"cid\" is required (string)..." }` | Missing CID (referral create) |
| 400 | `{ "error": "\"name\" is required (string)..." }` | Missing patient name (referral create) |
| 400 | `{ "error": "\"toHospitalCode\" is required (string)..." }` | Missing destination hospital (referral create) |
| 400 | `{ "error": "\"reason\" is required (string)..." }` | Missing referral reason (referral create) |
| 400 | `{ "error": "\"fromHospitalCode\" is required (string)..." }` | Missing sender HCODE (referral update) |
| 400 | `{ "error": "\"status\" is required (string)..." }` | Missing referral status (referral update) |
| 401 | `{ "error": "Missing or invalid Authorization header..." }` | No Bearer token |
| 401 | `{ "error": "Invalid or revoked API key" }` | Wrong key or revoked |
| 403 | `{ "error": "hospitalCode \"X\" ไม่ตรงกับ API key..." }` | hospitalCode mismatch |
| 500 | `{ "error": "Internal server error" }` | Server-side error |

---

## SSE Events Broadcast

All webhook operations trigger real-time SSE events to connected dashboard clients:

| Webhook Type | SSE Event | Data Fields |
|-------------|-----------|-------------|
| Labor — new admission | `patient_update` | `type: "new_admission"`, `hcode`, `an` |
| Labor — discharge | `patient_update` | `type: "patient_discharged"`, `hcode`, `an` |
| Labor — transfer | `patient_update` | `type: "patient_transfer"`, `fromHcode`, `toHcode`, `an` |
| ANC — create/update | `patient_update` | `type: "journey_update"`, `hcode`, `journeyId`, `careStage`, `ancRiskLevel` |
| ANC — delete | `patient_update` | `type: "journey_update"`, `hcode`, `journeyId`, `careStage: "DELETED"` |
| Referral — update | `patient_update` | `type: "referral_update"`, `fromHcode`, `toHcode`, `referralId`, `status` |
| Referral — delete | `patient_update` | `type: "referral_update"`, `fromHcode`, `referralId`, `status: "DELETED"` |
| Pregnancy overlap | `patient_update` | `type: "pregnancy_overlap_warning"`, `hcode`, `oldJourneyId`, `oldPregNo`, `oldCareStage`, `newPregNo`, `daysSinceLastUpdate` |
| Referral no data | `patient_update` | `type: "referral_no_monitoring_warning"`, `fromHcode`, `toHcode`, `referralId`, `hn`, `journeyId`, `message` |
| Maternal screening — state change (PROVISIONAL, flag-gated) | `patient_update` | `type: "maternal_screen_state_changed"`, `patientId`, `previousLocalTier`, `localTier`, `previousEmergencyAcuity`, `emergencyAcuity`, `isComplete`, `suspectedConditions`, `assessedAt`. Only fires when `MATERNAL_SCREEN_EVENTS_ENABLED=true` (default OFF) AND `localTier`/`emergencyAcuity` actually changed — never on an idempotent replay, never on a same-state re-save. See **Optional Fields — Maternal Labor-Triage Screening** above. |
| Sync complete | `sync_complete` | `hcode`, `patientsUpdated`, `source: "webhook"` |

---

## Admin API (API Key Management)

These endpoints require admin authentication (login to KK-LRMS with admin role).

### List API Keys

```
GET /api/admin/webhooks
```

### Create API Key

```
POST /api/admin/webhooks
```

```json
{ "hcode": "99901", "label": "Production Key" }
```

Response (201):

```json
{
  "id": "550e8400-...",
  "apiKey": "kklrms_a1b2c3d4e5f6789012345678901234567890",
  "keyPrefix": "kklrms_a",
  "hospitalName": "รพ.เอกชนทดสอบ",
  "hcode": "99901",
  "label": "Production Key",
  "message": "API key created. Save this key — it will not be shown again."
}
```

### Revoke API Key

```
DELETE /api/admin/webhooks/:keyId
```

---

## Referral Eligibility Check API

Pre-check whether a patient is eligible for referral **before** sending the referral webhook. Uses plain CID (เลขบัตรประชาชน) — the server hashes it internally and never stores the raw value.

```
POST /api/referrals/check
```

> **Requires the same webhook API key as `/api/webhooks/patient-data`** —
> `Authorization: Bearer <api-key>`. (Prior versions of this doc said this
> endpoint used session authentication; that was incorrect — the endpoint was
> fully public until the 2026-07-13 PHI review locked it down.) Responses are
> rate-limited to 30 requests/minute per hospital (HTTP 429 `RATE_LIMITED`
> when exceeded).

### Request Body

```json
{
  "cid": "1100700123456"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cid` | string | Yes | เลขบัตรประชาชน 13 หลัก (plain text — hashed server-side, checksum-validated) |

### Response

The response is intentionally minimized — it returns only the referral
decision, never maternity/patient details:

```json
{
  "canRefer": true,
  "reason": "พร้อมส่งต่อ",
  "activeReferrals": 0
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `canRefer` | boolean | Whether a referral is advisable |
| `reason` | string | Thai explanation of the result |
| `activeReferrals` | number | Number of referrals still in progress (not ARRIVED/REJECTED) |

### Decision Logic

| Scenario | `canRefer` | `reason` |
|----------|-----------|----------|
| No patient data found | `false` | ไม่พบข้อมูลผู้ป่วยในระบบ |
| Patient already delivered | `false` | ผู้ป่วยคลอดแล้ว — ไม่จำเป็นต้องส่งต่อ |
| Active ANC/labor, no existing referral | `true` | พร้อมส่งต่อ |
| Active ANC/labor, has existing referral | `true` | มีใบส่งต่อที่ยังดำเนินการอยู่ — ควรตรวจสอบใบส่งต่อเดิม |

### Errors

| Status | Code | Cause |
|--------|------|-------|
| 401 | `MISSING_AUTH` | No `Authorization: Bearer` header |
| 401 | `INVALID_API_KEY` | Key not found, inactive, or revoked |
| 400 | `INVALID_JSON` | Body is not a JSON object |
| 400 | `VALIDATION_FAILED` | `cid` missing, wrong length, non-digit, or fails the Thai checksum |
| 429 | `RATE_LIMITED` | More than 30 requests/minute from this hospital's key |

### Examples

```bash
# Check if patient can be referred
curl -X POST https://kk-lrms.bmscloud.in.th/api/referrals/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kklrms_..." \
  -d '{ "cid": "1100700123456" }'
```

### Recommended Referral Workflow

```
1. Hospital checks patient eligibility
   POST /api/referrals/check  { cid: "1100700123456" }
   → canRefer: true, reason: "พร้อมส่งต่อ"

2. Hospital sends referral
   POST /api/webhooks/patient-data  { type: "referral", ... }
   → status: "INITIATED"

3. Receiving hospital accepts
   POST /api/webhooks/patient-data  { type: "referral_update", status: "ACCEPTED", ... }

4. Patient in transit
   POST /api/webhooks/patient-data  { type: "referral_update", status: "IN_TRANSIT", ... }

5. Patient arrives
   POST /api/webhooks/patient-data  { type: "referral_update", status: "ARRIVED", ... }
```

---

## Integration Guide

### Periodic Systems (full_snapshot)

```
┌──────────────┐     every 5-30 min      ┌──────────────────┐
│  Your HIS    │ ───── full_snapshot ────→ │  KK-LRMS API     │
│  (Database)  │     POST /api/webhooks/  │  Dashboard auto-  │
│              │     patient-data         │  updates via SSE  │
└──────────────┘                          └──────────────────┘
```

1. Query your database for all active labor patients
2. Map each row to the webhook payload format
3. Send as `full_snapshot` — discharged patients handled automatically
4. Recommended interval: **every 5 minutes**

### Event-Driven Systems (incremental)

```
┌──────────────┐    on each event         ┌──────────────────┐
│  Your HIS    │ ───── incremental ─────→ │  KK-LRMS API     │
│  (Events)    │     POST /api/webhooks/  │  Dashboard auto-  │
│              │     patient-data         │  updates via SSE  │
└──────────────┘                          └──────────────────┘
```

1. On admit: send patient with `labor_status: "ACTIVE"`
2. On update: send updated fields (same `an`)
3. On discharge: send with `labor_status: "DELIVERED"`
4. On error correction: send with `action: "delete"`

### ANC Systems

```
┌──────────────┐    on ANC visit          ┌──────────────────┐
│  Your HIS    │ ── type: "anc_data" ──→  │  KK-LRMS API     │
│  (ANC module)│     POST /api/webhooks/  │  Pregnancy        │
│              │     patient-data         │  registry updated │
└──────────────┘                          └──────────────────┘
```

1. On ANC registration: send patient with pregnancy info
2. On each ANC visit: send patient with new visit in `visits` array
3. On risk change: send updated `riskLevel`

### Referral Systems

```
┌──────────────┐                                     ┌──────────────┐
│ รพ.ต้นทาง     │  1. POST /api/referrals/check      │  KK-LRMS     │
│ (sender)     │ ──── { cid } ─────────────────────→ │  ตรวจสอบ      │
│              │ ←─── canRefer: true ────────────────│  สถานะผู้ป่วย   │
│              │                                     │              │
│              │  2. POST /api/webhooks/patient-data  │              │
│              │ ──── type: "referral" ────────────→  │  สร้างใบส่งต่อ │
│              │                                     │              │
│              │                                     │              │
│ รพ.ปลายทาง    │  3. POST /api/webhooks/patient-data  │              │
│ (receiver)   │ ──── type: "referral_update"  ────→ │  อัพเดทสถานะ   │
│              │      status: ACCEPTED/ARRIVED       │              │
└──────────────┘                                     └──────────────┘
```

1. **Pre-check**: Call `/api/referrals/check` with patient CID to verify eligibility
2. **Create referral**: Send `type: "referral"` with patient data + destination hospital
3. **Status updates**: Receiving hospital sends `type: "referral_update"` for each state change
4. **Monitor alerts**: Dashboard shows warnings if patient has no ANC/labor data, or if pregnancy overlaps

### Error Handling

- **Retry on 500**: Transient. Retry with exponential backoff (1s, 2s, 4s, max 60s).
- **Do not retry on 400**: Fix the payload.
- **Do not retry on 401**: Check API key.
- **Do not retry on 403**: hospitalCode doesn't match API key.
- **Idempotent**: Sending the same data multiple times is safe (upsert by compound key).

---

## Data Privacy (PDPA Compliance)

| Data Field      | Storage Method                                    |
|----------------|---------------------------------------------------|
| Patient name   | AES-256-GCM encrypted at rest                     |
| CID (national ID) | AES-256-GCM encrypted + SHA-256 hash for matching |
| Clinical data  | Stored in plaintext (not personally identifiable)  |
| API key        | SHA-256 hash only (raw key never stored)           |

All data transmitted over HTTPS/TLS.

---

## Rate Limits

| Constraint              | Limit                |
|------------------------|----------------------|
| Patients per request   | 100 maximum (labor)  |
| Request payload size   | 1 MB                 |
| Recommended interval   | ≥ 5 minutes          |

---

## Changelog

| Version | Date       | Changes |
|---------|------------|---------|
| 2.7     | 2026-07-16 | **Maternal labor-triage screening (PROVISIONAL, flag-gated — not clinically approved):** new optional `maternal_screening` object on the labor payload (preeclampsia/eclampsia local tier, independent emergency acuity, suspected hemorrhage/obstructed-labor patterns). No effect at all unless `MATERNAL_SCREEN_INGEST_ENABLED=true` (default OFF); the server always recomputes tier/acuity/completeness server-side and never accepts a sender-supplied value. New response fields `maternalScreenAssessments`/`maternalScreenDuplicates`/`maternalScreenIngestErrors` appear ONLY when the flag is on AND a screening rode along — legacy responses stay byte-identical (GC7). New SSE event `maternal_screen_state_changed` (also flag-gated, `MATERNAL_SCREEN_EVENTS_ENABLED`, default OFF; fires only on a real tier/acuity transition, never on a replay). New read-only `GET /api/patients/{an}/maternal-screenings` endpoint (latest summary + paginated, correction-aware history) — session-authenticated, same tenant isolation as the existing patient routes. No sender action required; this section can be ignored until your hospital is asked to pilot it. |
| 2.6     | 2026-04-28 | **Labor payload — Obstetric formula completion:** new optional fields `para`, `abortion`, `living_children`, `preg_no` so the dashboard can render the full `G3 P2 A0 L2` pill instead of just `G3`. **GA precision:** new optional `ga_day` (0–6) renders `38⁺4` instead of `38`. **Pre-pregnancy anchor:** new optional `pre_pregnancy_weight_kg` (from earliest `person_anc_screen.bw`); server **derives** `weight_diff_kg` automatically when sender supplies both anchors but omits the diff. **Admission snapshot:** new optional `bp_systolic_admit`, `bp_diastolic_admit`, `pulse_admit`, `rr_admit`, `temperature_admit`, `cervical_open_cm_admit`, `effacement_pct_admit`, `station_admit` (all from the single `ipt_pregnancy_vital_sign` row), driving a new "ADMISSION SNAPSHOT" card on the patient detail page with clinical severity coloring. All fields are optional and back-compat — v2.5 payloads continue to work unchanged. New Edge Cases: partial G_P_A_L components, server-side `weight_diff_kg` derivation, admission snapshot vs. partograph distinction. |
| 2.5     | 2026-04-07 | **ANC `hn` now optional** (`string \| null`): community-registered patients have no HN; when null, CID hash becomes sole match key. Record matching table updated. **HOSxP ANC registry clarification:** `person` vs `patient` table distinction documented. **`fundalHeightCm` and `fetalHr`** marked optional but strongly recommended; clarified as unavailable from HOSxP ANC tables. **`referralId` opaque string:** both slash format (`"3803/68"`) and zero-padded format (`"00000014"`) are valid. **`referout.pdx`:** corrected column name (not `icd10`). **`referout.hn` join path:** direct to `patient.hn`, no `ovst` needed. **`referout_emergency_type_id` null note:** maps to ROUTINE at hospitals that don't use it. **New Edge Cases:** null HN for community ANC patients, missing ANC visit vitals, empty `person_anc_risk` → LOW, null `anc_count` in labor, null location codes. |
| 2.4     | 2026-04-07 | **HOSxP integration clarity:** document `age` derivation from `birthday`, `admit_date` from `regdate`+`regtime`. **New optional field:** `hematocritPct` in ANC visits (from `person_anc.blood_hct_result`). **HOSxP urgencyLevel mapping table:** numeric `referout_emergency_type_id` → `ROUTINE/URGENT/EMERGENCY`. **Edge Cases section:** no-CID patients, null LMP/EDC behavior, missing CPD factors, `visitNumber` cumulative semantics. **Null field guidance:** `fetalHr` null at early visits is expected; `gaWeeks: null` preferred over `0` for unknown GA. **`referralId` slash format** documented as valid. |
| 2.3     | 2026-03-31 | **Referral check API**: `POST /api/referrals/check` — pre-check eligibility by CID before sending referral. **CID-based patient matching**: all webhook types use CID (not HN) as primary patient key across hospitals. **Overlapping pregnancy detection**: warns when new pregnancy data arrives while previous is active. **Referral monitoring validation**: warns when referral patient has no ANC/labor data. New SSE events: `pregnancy_overlap_warning`, `referral_no_monitoring_warning`. |
| 2.2     | 2026-03-31 | Add patient location fields (`changwatCode`, `amphurCode`, `tambonCode`) to ANC and Referral Create payloads for GIS mapping. Uses standard Thai 2-digit DOPA administrative codes. |
| 2.1     | 2026-03-31 | **Referral redesign:** Split into `type: "referral"` (create by sender) and `type: "referral_update"` (status by receiver). Add `hn`, `cid`, `name`, `toHospitalCode` to create payload. Add `fromHospitalCode` to update payload for compound key. Add REJECTED status with `rejectionReason`. ARRIVED auto-updates journey `current_hospital`. Add ANC risk level clinical criteria definitions. |
| 2.0     | 2026-03-31 | Add ANC data webhook (`type: "anc_data"`), referral update webhook (`type: "referral_update"`), delete operations (`action: "delete"`) for all types, `hospitalCode` validation, SSE event types for journey/referral/newborn |
| 1.0     | 2026-03-19 | Initial release: incremental + full_snapshot modes, API key auth, CPD scoring, transfer detection |
