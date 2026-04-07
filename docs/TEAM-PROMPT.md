# KK-LRMS Webhook API Test — Agent Team Prompt

Paste this into a Claude Code session with agent teams enabled to run the full HOSxP simulation pipeline.

**Prerequisites:**
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"` in `~/.claude/settings.json`
- Claude Code v2.1.32+
- HOSxP PostgreSQL reachable at 192.168.50.177
- LRMS running at https://kk-lrms.bmscloud.in.th

---

```
Create an agent team with 3 teammates to test and validate the KK-LRMS Webhook API using real HOSxP data from PostgreSQL.

## Database Connection (HOSxP PostgreSQL)
- Host: 192.168.50.177
- Port: 5432
- Database: bmshosxp
- User: bmshosxp
- Password: bmshosxp

## Target API
- Public URL: https://kk-lrms.bmscloud.in.th
- Webhook endpoint: POST /api/webhooks/patient-data
- Referral check: POST /api/referrals/check

---

## Teammate 1: "hosxp-simulator" (Sonnet, auto mode)

Role: Simulate a non-HOSxP hospital sending data to KK-LRMS webhook API.

Tasks:
1. Connect to HOSxP PostgreSQL and query REAL patient data:
   - `person_anc` JOIN `patient` → ANC registrations (CID, names, pregNo, LMP, EDC)
   - `person_anc_service` LEFT JOIN `opdscreen` → ANC visit vitals (ga_weeks, BP, weight, fetal HR)
   - `person_anc_risk` → risk factors
   - `ipt` + `ipt_pregnancy` + `ipt_labour` + `patient` → active labor patients
   - `referout` JOIN `patient` → referral data
   - `patient.chwpart/amppart/tmbpart` → location codes
   - `ipt_pregnancy_vital_sign` → labor vitals
   - `opdscreen` → height/weight

2. Transform real data into webhook payloads per docs/WEBHOOK-SPEC.md:
   - `anc-patients.json` — type: "anc_data", 5-10 patients with visits
   - `labor-patients.json` — no type, 3-10 active labor patients
   - `referral-create.json` — type: "referral"
   - `referral-update.json` — type: "referral_update"
   - `referral-check.json` — array of CIDs for eligibility check
   Save all to: tests/fixtures/hosxp-simulated/

3. Create `tests/fixtures/hosxp-simulated/send-webhooks.sh`:
   - curl commands targeting https://kk-lrms.bmscloud.in.th
   - Accepts base_url and api_keys as arguments
   - Send order: ANC → Labor → Referral Create → Referral Update → Referral Check
   - Log all request/response

4. Report mapping gaps to spec-adjuster:
   - Fields in HOSxP not in spec
   - Required spec fields missing from HOSxP
   - Null patterns, format mismatches, empty tables

Known HOSxP quirks to handle:
- `referout.refer_hospcode` is the DESTINATION (inverted naming)
- `person_anc.risk_level` is always null — risk must be computed
- `patient` has no `person_id` — join via `person.cid = patient.cid`
- `opdscreen` stores vitals as decimal strings ("117.000") — parseFloat needed
- `referout.refer_number` uses slash format "3803/68"
- `referout_emergency_type_id`: null/1=ROUTINE, 2=URGENT, 3=EMERGENCY

---

## Teammate 2: "data-validator" (Sonnet, auto mode)
Blocked by: Task #1

Role: Validate LRMS processes webhook data correctly.

Tasks:
1. Wait for hosxp-simulator to complete (check task list)

2. Read generated fixtures from tests/fixtures/hosxp-simulated/

3. Read system code to understand processing pipeline:
   - docs/WEBHOOK-SPEC.md, src/services/webhook.ts, src/services/journey.ts
   - src/db/tables/maternal-journeys.ts, src/db/tables/cached-anc-visits.ts
   - src/types/domain.ts, src/app/api/webhooks/patient-data/route.ts
   - src/app/api/referrals/check/route.ts

4. Write `tests/integration/hosxp-simulated-validation.test.ts`:
   - Data shape validation (required fields, types, CID 13-digit, date formats)
   - ANC processing (journey creation, CID hash, encryption, risk levels, location codes, visit persistence)
   - Labor processing (cached_patients, CPD risk score calculation)
   - Referral processing (compound keys, status transitions, cross-hospital CID matching)
   - Referral check API (canRefer true/false, Thai reason messages)
   - Edge cases from real data (null fields, Thai characters)

5. Create `tests/fixtures/hosxp-simulated/validation-checklist.md`:
   - Security (CID encryption, name encryption, hash matching)
   - ANC data correctness
   - Labor data correctness
   - Referral data correctness
   - Integration (hospital status, SSE events, upsert behavior)

6. Run tests and report findings to both teammates

---

## Teammate 3: "spec-adjuster" (Sonnet, plan mode — requires approval)
Blocked by: Tasks #1 and #2

Role: Analyze findings and update webhook spec if gaps found.

Tasks:
1. Wait for both teammates to report findings

2. Analyze HOSxP-to-spec mapping gaps:
   - Fields in HOSxP that should be in spec
   - Required spec fields HOSxP doesn't have (document defaults)
   - Data type/format mismatches
   - Edge cases (no CID, null LMP/EDC, missing CPD factors)
   - HOSxP date/number format quirks

3. If gaps found, draft changes to docs/WEBHOOK-SPEC.md:
   - Add new optional fields with descriptions
   - Document default values and derivation formulas
   - Add HOSxP integration notes (age from birthday, admit_date from regdate+regtime)
   - Add urgencyLevel numeric→enum mapping table
   - Add Edge Cases section
   - Bump version

4. Create `docs/hosxp-simulation-report.md`:
   - Data coverage (patient counts by type)
   - Clean mappings vs issues found (with resolution table)
   - Spec changes applied
   - Test results
   - Recommendations (high/medium/low priority)

## Coordination
- hosxp-simulator runs FIRST
- data-validator runs AFTER simulator completes
- spec-adjuster runs AFTER both complete
- All teammates communicate findings directly
- Use Sonnet for all teammates
- Require plan approval for spec-adjuster before file modifications
```
