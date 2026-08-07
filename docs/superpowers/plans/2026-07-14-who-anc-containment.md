# WHO ANC Immediate Safety Containment — Implementation Plan

**Source spec:** `docs/who-guideline-2026-07-14.md` §8 "Immediate Safety Containment" (+ release-blocking invariants §1, test anchors §9.2, Appendix A row 1-4)
**Date:** 2026-07-14
**Scope:** Stop false-normal rendering, healthy-value imputation, missing-evidence risk downgrades, cross-hospital visit loss, and unknown-GA-implies-complete — WITHOUT changing any approved clinical threshold and WITHOUT starting ANC v2 (no new tables, no feature flags — these are unconditional safety corrections).

## Global Constraints (binding on every task)

1. **No clinical threshold value changes.** BP 140/90 (high) / 130/85 (amber), FHR 110/160, Hb 11/9, all rule thresholds in `src/config/anc-risk-rules.ts`, the 18-item classifying canon, and `ANC_OPS` values stay byte-identical. Only null/missing-data *handling* changes.
2. **Missing or invalid clinical data never renders green, never counts as complete, and never becomes a fabricated healthy value** (spec invariant 2).
3. **A known high-risk finding remains high risk even when other inputs are missing** (spec invariant 3). Example: `sevBp(200, null)` must be `'abnormal'`, not `'unknown'`.
4. **Missing or stale evidence can never lower a previously known risk** (spec invariant 4). Positive, current evidence (a non-empty classifying-item list) MAY still lower it — that behavior is pinned by `tests/unit/services/webhook-anc-risk.test.ts:97-104` and must keep passing.
5. **One hospital's payload can never delete, overwrite, or reattribute another hospital's visit rows** (spec invariant 5). Same-day cross-hospital conflicts are rejected/skipped and counted, never silently overwritten.
6. **Update the tests that pin unsafe behavior** — the spec §9.2 explicitly mandates: "Update `tests/unit/services/anc-clinical.test.ts` rather than preserving missing-as-normal behavior." Same authority applies to `tests/integration/webhook-anc-referral.test.ts:187-233` (declared-only downgrade). Never weaken any other assertion.
7. **Dual-path consistency:** the webhook path (`src/services/webhook.ts`, LIVE in production via browser-push) and the polling path (`src/services/sync/anc.ts`, prod-dead but unit-tested and exported) mirror each other's ANC logic with cross-referencing comments. Every semantic change must be applied to both where the same behavior exists.
8. **No PHI in new logs/metrics/results:** no name, HN, CID, or clinical free text. journey UUID, hospital UUID, event counts, and risk-level enum strings are acceptable. Note `src/lib/logger.ts` redacts any context key containing the substring `cid`/`token`/`key` etc. (case-insensitive).
9. **TDD (superpowers:test-driven-development):** write the failing test first, watch it fail, implement, watch it pass. PGlite harness: `tests/helpers/testDb.ts` `createTestDb()` for data tests, `tests/helpers/createPgliteDb.ts` for DDL tests, `tests/helpers/failingDb.ts` for transaction-rollback proofs.
10. TypeScript strict; no `any`. New UI copy in Thai. Commit per task with a descriptive message; never commit secrets.
11. `npm test` scoped runs during a task are fine; the covering test files named in the task MUST be run and pass before reporting DONE, plus `npx tsc --noEmit`.

## Architecture notes shared by all tasks

- **Live production ANC path:** browser tab (`src/lib/browser-poll.ts`) → `POST /api/sync/browser-push` (`src/app/api/sync/browser-push/route.ts:218-256`) → `validateAncPayload` + `processAncWebhook` (`src/services/webhook.ts:871-1370`). The `/api/webhooks/patient-data` route (`route.ts:74-93`) reaches the same `processAncWebhook`.
- **Prod-dead but tested path:** `syncAncData` (`src/services/sync/anc.ts:31-264`), reachable only via onboarding; `linkJourneyToLabor` from the same file IS live.
- `AncRiskLevel` enum + `ANC_RISK_LEVEL_ORDER` (`src/config/anc-risk-rules.ts:79-84`) is the level-comparison basis everywhere.
- `insertAncScreeningIfChanged` (`src/services/anc-screening.ts:16-50`) appends `cached_anc_risks` history rows, deduped vs latest row only; shared by both paths.
- `src/services/reconciliation.ts:18-28` flags `latest cached_anc_risks.risk_level <> maternal_journeys.anc_risk_level` as a discrepancy — tasks that make journey risk "stickier" must not append screening rows for rejected assessments, so this report stays clean.

---

## Task 1: Unknown-state observation severities (service + all consumers)

**Problem (P0):** `src/services/anc-clinical.ts` returns `'normal'` for missing data: `sevBp(null, 80)`, `sevBp(200, null)`, `sevFhr(null)`, `sevHb(null)` are all `'normal'` (lines 26-44). The journey detail page renders a green `OK` check badge for a visit whose clinical fields are ALL null (`src/app/(provincial)/pregnancies/[journeyId]/page.tsx:1646-1654, 1795-1799`). Urine-protein and fetal-movement interpretation live inline in the page (`:1639-1640, :1644`) with the same missing-is-fine semantics.

**Required behavior:**

1. In `src/services/anc-clinical.ts`, extend `type Severity` to `'normal' | 'borderline' | 'abnormal' | 'unknown'`.
2. `sevBp(sys, dia)` — evaluate present components independently; report the highest severity provable from present data; `'unknown'` only when normality cannot be proven:
   - any present component at/over high threshold (sys≥140 or dia≥90) → `'abnormal'`
   - else any present component at/over amber threshold (sys≥130 or dia≥85) → `'borderline'`
   - else if either component is null/undefined → `'unknown'`
   - else → `'normal'`
   - Required cases: `(null,null)→unknown`, `(120,null)→unknown`, `(null,80)→unknown`, `(200,null)→abnormal`, `(null,95)→abnormal`, `(132,null)→borderline`, `(120,80)→normal`, `(140,90)→abnormal`, `(130,85)→borderline`.
3. `sevFhr(null)` → `'unknown'`; `sevHb(null)` → `'unknown'`; present-value bands unchanged.
4. NEW exported helpers (extracted from the page's inline logic, same thresholds):
   - `sevUrineProtein(v: string | null | undefined): Severity` — null/undefined/empty-string → `'unknown'`; contains `+` (current page regex `/\+/`) → `'abnormal'`; else `'normal'`.
   - `sevFetalMovement(ok: boolean | null | undefined): Severity` — null/undefined → `'unknown'`; `false` → `'abnormal'`; `true` → `'normal'`.
5. Journey detail page (`src/app/(provincial)/pregnancies/[journeyId]/page.tsx`):
   - `sevColor` (:256-262) / `sevBg` (:263-269): add `'unknown'` → neutral/amber "not recorded" styling. Use muted amber (`--risk-medium` at reduced emphasis or `--ink-navy-muted` with an amber accent) — visually distinct from both green/normal ink and red/abnormal. Must not be pure green under any circumstance.
   - Visit timeline rows (:1632-1803): replace inline urine/fetal-movement logic with the new service helpers. Flag chips continue to fire only on `'abnormal'` — `'unknown'` must NOT produce an alarm chip. Replace the badge logic:
     - any abnormal flag → existing red flag rendering (unchanged)
     - no abnormal flags AND all five checks (`sevBp`, `sevFhr`, `sevHb`, `sevUrineProtein`, `sevFetalMovement`) returned a known value (`normal`/`borderline`) → existing green `OK` badge
     - no abnormal flags but ANY of the five is `'unknown'` → neutral amber badge with Thai text `ไม่ได้บันทึกครบ` (data not fully recorded) — NOT the green check icon, NOT `--risk-low` color. Include a non-color cue (icon differs from CheckCircle2, e.g. a MinusCircle/HelpCircle).
   - TrendRow inline per-axis BP severity lambdas (:1526-1545): null → `'unknown'` (renders as the existing muted `—`, which is acceptable neutral), present values unchanged.
   - Every existing `sev !== 'normal'` comparison in the page (:1638, :1641, :1647-1648, :1706, :1720, :1762, :1767) must be audited: `'unknown'` must never route into abnormal/borderline styling and never into green.
6. Labor patient detail page `src/app/(provincial)/patients/[an]/page.tsx`: replace the hand-rolled `bpTint` (:86-90) and `fhrTint` (:81-84) with derivations from the service `sevBp`/`sevFhr` (abnormal → `var(--risk-high)`, everything else → undefined/default ink). Their current behavior (partial-present-high flags) is a subset of the new `sevBp` semantics, so visible behavior for abnormal values is unchanged.
7. `src/components/patient/ClinicalData.tsx` has its own 4-state Severity with `'neutral'` — DO NOT merge the two systems in this task; it already renders nulls as neutral dashes (compliant). Leave it.

**Tests (write/update FIRST):**
- `tests/unit/services/anc-clinical.test.ts`: replace the null→normal assertions at :24-28 (sevBp), :46-48 (sevFhr), :62-64 (sevHb) with the new unknown/partial cases (full case table from step 2); add `sevUrineProtein` / `sevFetalMovement` suites. Do not touch band-edge assertions for present values.
- `tests/unit/pages/journey-detail.test.tsx`: add a fixture visit with all clinical fields null → assert no green OK badge / no `--risk-low` OK, assert `ไม่ได้บันทึกครบ` present; add a visit with sys 200 / dia null → assert red flag rendering fires.

**Files:** `src/services/anc-clinical.ts`, `src/app/(provincial)/pregnancies/[journeyId]/page.tsx`, `src/app/(provincial)/patients/[an]/page.tsx`, the two test files.
**Covering tests to run:** `npx vitest run tests/unit/services/anc-clinical.test.ts tests/unit/pages/journey-detail.test.tsx tests/unit/pages/patient-detail.test.tsx tests/unit/components/ClinicalData.test.tsx` + `npx tsc --noEmit`.

---

## Task 2: Unknown-GA schedule semantics (never "8 contacts complete" without GA)

**Problem (P0):** `nextContactDue` (`src/services/anc-clinical.ts:61-79`) returns `null` for BOTH "GA unknown" (:65) and "all 8 contacts attended" (:78). Three journey-detail render sites show green completed-schedule copy for both: NEXT DUE tile (:1455-1482, `'ครบ 8 contact'`, `--risk-low`), next-action rail (:2510-2625, `'ครบทั้ง 8 contact แล้ว'`), and `GaProgressBar` (:817-922) which coerces `ga = gaWeeks ?? 0` so unknown GA looks like early pregnancy with nothing missed. The 1ST CONTACT tile (:1436-1454) renders green when `firstVisitGa` is null. `overdueInvestigations` (:123-171) coerces `gaWeeks ?? 0` so unknown GA shows zero overdue items with no caveat.

**Required behavior:**

1. Change `nextContactDue` to return a discriminated union:
   ```ts
   export type WhoContactSchedule =
     | { status: 'UNKNOWN_GA' }
     | { status: 'COMPLETE' }
     | { status: 'NEXT'; ga: number; dueStatus: 'overdue' | 'due-now' | 'upcoming'; weeksAway: number };
   ```
   (Field names may be adapted to fit the existing `NextWhoContact` shape — keep `ga`/`weeksAway` semantics identical.) `currentGa == null` → `UNKNOWN_GA`. All targets attended → `COMPLETE`. Otherwise `NEXT` with EXACTLY the current window logic (±1 week, first unattended target, same overdue/due-now/upcoming boundaries). Do NOT fix the one-encounter-satisfies-two-targets window overlap — that is Phase 4 work requiring clinically approved windows; add a code comment noting it.
2. Journey detail page updates (all three sites + first-contact tile):
   - `UNKNOWN_GA`: NEXT DUE tile value `—`, sub `ไม่ทราบอายุครรภ์ — ประเมินตารางนัดไม่ได้`, color amber (`--risk-medium`), never `--risk-low`. Rail: same message in amber; never the ครบ text.
   - `COMPLETE`: keep today's green complete rendering (legitimate only when GA is known).
   - `GaProgressBar` when `gaWeeks == null`: do not coerce to 0. Render attended dots (green where attended) but NO red "missed" dots and no due-position marker; header GA shows `—` (already does); add visible label `ไม่ทราบอายุครรภ์`; ATTENDED n/8 count renders in neutral ink (not green) when GA unknown.
   - 1ST CONTACT tile: `firstVisitGa == null` → value `—`, neutral/muted color, not `--risk-low`.
   - RTCOG overdue section: when `gaWeeks == null`, render one amber note `ไม่ทราบอายุครรภ์ — ตรวจสอบรายการค้างไม่ได้` instead of silently showing an empty list. `overdueInvestigations` itself keeps returning `[]` for null GA (it cannot determine due-ness) — the caveat is a UI responsibility.
3. Any other consumer of `nextContactDue` must be updated (grep; as of planning the only caller is `[journeyId]/page.tsx:1013`).

**Tests (write/update FIRST):**
- `tests/unit/services/anc-clinical.test.ts`: `nextContactDue(null, [])` → `{status:'UNKNOWN_GA'}` (replaces :95-97); all-attended → `{status:'COMPLETE'}` (replaces :124 shape); existing overdue/due-now/upcoming cases re-expressed as `NEXT` with identical numbers.
- `tests/unit/pages/journey-detail.test.tsx`: fixture with `gaWeeks: null` and 8 visits → assert `ไม่ทราบอายุครรภ์` appears, assert `ครบ 8 contact` / `ครบทั้ง 8 contact แล้ว` do NOT appear; fixture with known GA and genuinely-complete schedule → complete text still renders.

**Files:** `src/services/anc-clinical.ts`, `src/app/(provincial)/pregnancies/[journeyId]/page.tsx`, the two test files.
**Covering tests:** `npx vitest run tests/unit/services/anc-clinical.test.ts tests/unit/pages/journey-detail.test.tsx` + `npx tsc --noEmit`.

---

## Task 3: Remove healthy-value imputation; nullable, completeness-aware risk engine

**Problem (P0):** `src/services/sync/anc.ts:204-242` fabricates healthy vitals before risk evaluation: height→160, BMI→22, BP→120/80, and hardcodes o2Sat=98, hct=36, hb=12 (never read from data in this path). Consequence: rules `hr1_o2sat`, `hr3_anemia`, `hr1_height` can never fire from this path, and a missing assessment is indistinguishable from a healthy one. `AncRiskInput` (`src/config/anc-risk-rules.ts:4-44`) declares these fields non-nullable, which is what forces the fabrication. The journey risk update at `sync/anc.ts:248-251` is an unconditional overwrite.

**Required behavior:**

1. `src/config/anc-risk-rules.ts`:
   - Make `heightCm`, `prePregnancyBmi`, `bpSystolic`, `bpDiastolic`, `o2Sat`, `hct`, `hb` on `AncRiskInput` `number | null`. (If the implementer finds `age`/`gravida` can also arrive missing from the polling payload, apply the same treatment; otherwise leave them required.)
   - Every rule lambda touching a newly-nullable field: null → rule does NOT trigger (missing data never fabricates a finding). E.g. `input.heightCm != null && input.heightCm < 145`. Threshold numbers unchanged.
   - Add `export const MANDATORY_ANC_RISK_INPUTS = ['heightCm','prePregnancyBmi','bpSystolic','bpDiastolic','o2Sat','hct','hb'] as const;` with a comment: this interim engineering set is exactly the fields the removed imputation block used to fabricate; the clinically approved mandatory set is a Phase 0 deliverable of `docs/who-guideline-2026-07-14.md`.
   - `classifyAncRisk` returns `{ level, triggeredRules, missingRequired: string[] }` — `missingRequired` lists the mandatory inputs that were null. Level derivation logic otherwise unchanged (no rule fires → LOW).
2. `src/services/anc-risk.ts`: `evaluateAncRisk` result gains `missingRequired: string[]` and `assessmentIncomplete: boolean` (`missingRequired.length > 0`).
3. `src/services/sync/anc.ts`:
   - Delete the default substitutions. `heightCm` = first real value or null. Pre-pregnancy BMI: compute via the existing `prePregnancyBmi()` helper from `src/services/anc-clinical.ts` (import it — this kills the divergent local BMI computation which lacked the >100cm guard and rounding) using real height/weight, else null. `bpSystolic`/`bpDiastolic` = latest visit's real values or null. `o2Sat`, `hct`, `hb` = null (this path's HOSxP query never provides them).
   - `upsertAncRisk` (:332-349): persist `riskFactorsJson: JSON.stringify({ missingRequired, assessmentIncomplete })` instead of `'{}'` (existing JSONB column — additive, no schema change).
   - Journey risk update (:248-251) becomes downgrade-guarded: compare via `ANC_RISK_LEVEL_ORDER`. If `assessmentIncomplete` AND derived level < existing journey level → keep the existing level, do NOT append the screening row for the rejected lower assessment, and `logger.warn('anc_risk_downgrade_blocked', { hospitalId, journeyId, from, to, reason: 'incomplete_assessment' })`. If derived ≥ existing, or the assessment is complete → current behavior (append screening if changed, write journey level).
   - Return-shape note: `syncAncData` returns a count today; add an internal counter of incomplete assessments and log one aggregate `logger.info('anc_sync_assessment_summary', { hospitalId, incompleteAssessments, downgradesBlocked })` at the end (non-PHI).
4. Do NOT touch the webhook path's risk resolution in this task (Task 4 owns it). Do not change walk-in journey creation (`linkJourneyToLabor`) or newborn retrospective journeys.

**Ripples to check:** `tests/unit/services/anc-risk.test.ts:6-7` and `tests/unit/config/anc-risk-rules.test.ts` build `AncRiskInput` literals — update their base inputs; `reconciliation.ts:18-28` journey-vs-latest-screening consistency is preserved because rejected downgrades don't append screening rows.

**Tests (write/update FIRST):**
- `tests/unit/config/anc-risk-rules.test.ts`: for each newly-nullable field, null → rule not triggered; `classifyAncRisk` with all-null mandatory inputs → `level: LOW`, `missingRequired` lists all seven, no triggered rules; real hb 8.5 → `hr3_anemia` triggers (now possible with a real value and null others).
- `tests/unit/services/anc-risk.test.ts`: `assessmentIncomplete` true/false propagation.
- `tests/unit/services/sync-journey.test.ts`: payload lacking vitals → `cached_anc_risks.risk_factors` contains non-empty `missingRequired` and NO fabricated values anywhere; journey at HR3 + subsequent finding-free incomplete payload → journey stays HR3 and no LOW screening row is appended; complete-input payload with real abnormal value still escalates.

**Files:** `src/config/anc-risk-rules.ts`, `src/services/anc-risk.ts`, `src/services/sync/anc.ts`, three test files.
**Covering tests:** `npx vitest run tests/unit/config/anc-risk-rules.test.ts tests/unit/services/anc-risk.test.ts tests/unit/services/sync-journey.test.ts tests/unit/services/webhook-anc-risk.test.ts` + `npx tsc --noEmit`.

---

## Task 4: No risk downgrade on missing evidence — webhook/browser-push (LIVE production path)

**Problem (P0, live):** `src/lib/browser-poll.ts:516-517` always sends `riskItemIds` (possibly `[]`). An empty array makes `resolveCanonicalAncRisk` (`src/services/webhook.ts:838-852`) derive LOW, and `processAncWebhook` writes it over any existing level (`webhook.ts:1020`) — a transient HOSxP query returning zero classifying rows silently downgrades HR3→LOW in production. Legacy declared-only payloads (no `riskItemIds`) can also lower the level (pinned by `tests/integration/webhook-anc-referral.test.ts:187-233`, which the spec authorizes updating).

**Required policy (implement in `processAncWebhook` where the existing journey is known — `resolveCanonicalAncRisk` stays payload-scoped):**

| Payload evidence | Canonical vs existing journey level | Journey level | Screening row (`cached_anc_risks`) |
|---|---|---|---|
| non-empty `riskItemIds` | higher OR lower | write canonical (UNCHANGED — positive current evidence; keep `webhook-anc-risk.test.ts:97-104` passing) | append if changed (unchanged) |
| empty `riskItemIds` (`[]`) | higher | raise (unchanged) | append |
| empty `riskItemIds` (`[]`) | lower | **BLOCK**: keep existing; count + `logger.warn('anc_risk_downgrade_blocked', { hospitalId, journeyId, from, to, reason: 'empty_items' })` | do NOT append the lower row |
| no `riskItemIds` (legacy declared-only) | declared higher | raise (unchanged) | none (unchanged — legacy writes no screening) |
| no `riskItemIds`, declared lower | **BLOCK** (update the pinned test at `webhook-anc-referral.test.ts:187-233` to assert the block), reason `'declared_only'` | none |
| `canonicalRisk` null | keep existing (unchanged `:1020`) | none |

- Journey **creation** is unchanged: `canonicalRisk ?? LOW` (no prior level to protect).
- Level comparison via `ANC_RISK_LEVEL_ORDER`. Equal level → no-op as today.
- The SSE `journey_update` event's `ancRiskLevel` (`webhook.ts:1033`) must carry the level actually persisted, not the rejected one.
- The screening-append guard currently reads `Array.isArray(patient.riskItemIds) && canonicalRisk` (`:1098-1100`). Note from prior review: the `&& canonicalRisk` conjunct is type-load-bearing (narrows null) — KEEP it, extend the condition for the block cases.
- Add a `downgradesBlocked` counter to the `processAncWebhook` result object (alongside `patientsProcessed` etc.) — additive, non-breaking.
- All this happens inside the existing per-patient transaction — preserve atomicity (journey update + screening in one tx, SSE buffered post-commit).

**Tests (write/update FIRST):**
- `tests/integration/webhook-anc-referral.test.ts`: NEW — journey at HR3, second payload same patient with `riskLevel: 'LOW', riskItemIds: []` → journey stays HR3, no new screening row, result `downgradesBlocked: 1`, SSE event carries HR3. REWRITE :187-233 — declared-only HR2→LOW is now blocked (journey stays HR2). Existing raise/equal cases must keep passing untouched.
- `tests/unit/services/webhook-anc-risk.test.ts`: :97-104 (non-empty-items HR3→HR1 appends lower row AND journey follows) must still pass — if it only asserts the screening row today, extend it to also assert the journey level follows positive-evidence downgrades.

**Files:** `src/services/webhook.ts`, the two test files.
**Covering tests:** `npx vitest run tests/unit/services/webhook-anc-risk.test.ts tests/integration/webhook-anc-referral.test.ts tests/integration/hosxp-simulated-validation.test.ts` + `npx tsc --noEmit`.

---

## Task 5: Hospital-scoped visit writes; cross-hospital conflict rejection; DB-aggregate roll-up; transactional replace

**Problem (P0, live):** `src/services/webhook.ts:1114` runs `DELETE FROM cached_anc_visits WHERE journey_id = ?` with no hospital scoping — hospital B's payload erases hospital A's visit rows on a shared (cid-hash-linked) journey, then re-stamps everything `hospital_id = B`. The block runs OUTSIDE any transaction (a mid-loop failure loses visits permanently) and the roll-up copies the payload's count (`anc_visit_count = patient.visits.length`, `:1194-1196`), not the provincial total. The polling path's `upsertAncVisit` (`sync/anc.ts:266-330`) updates rows across hospitals including reassigning `hospital_id`.

**Required behavior — webhook path (`webhook.ts:1108-1201`):**

1. Wrap the entire visit replace + summary roll-up in ONE `db.transaction` (a second per-patient tx after the existing journey tx). Do NOT restructure SSE ordering in this task (the journey SSE fires before visit writes today — pre-existing, out of scope).
2. Scope the delete strictly: `DELETE FROM cached_anc_visits WHERE journey_id = ? AND hospital_id = ?` (the authenticated pushing hospital). Rows with `hospital_id IS NULL` (legacy, normally backfilled at startup) are never deleted by this path.
3. Conflict rejection on insert: within the same transaction, read the surviving `(visit_date, hospital_id)` pairs for the journey first; for each incoming visit whose date collides with a row owned by ANOTHER hospital (or a NULL-hospital row), SKIP that visit, increment a `visitConflicts` counter, and `logger.warn('anc_cross_hospital_visit_conflict', { journeyId, hospitalId, conflictingHospitalId })` — no visit date, no PHI, never overwrite. (Concurrent-writer race beyond the pre-check is acceptable residual risk for containment — one pusher per hospital; note it in a comment.)
4. Roll-up becomes a DB aggregate over ALL the journey's surviving visits (all hospitals — this is the provincial history): `anc_visit_count = COUNT(*)`, `last_anc_date = MAX(visit_date)` via SQL against `cached_anc_visits`; `ga_weeks = COALESCE(payload, existing)` unchanged. This replaces the payload-count semantics per spec §7.6 rule 11.
5. Preserve pinned behavior: omitted/empty `visits` array still touches nothing (`webhook-anc-referral.test.ts:838-882`); same-hospital resend still replaces that hospital's rows (`:748-802`).
6. Add `visitConflicts` to the `processAncWebhook` result object.

**Required behavior — polling path (`sync/anc.ts`):**

7. `upsertAncVisit` (:266-330): when the existing `(journey_id, visit_date)` row belongs to a DIFFERENT hospital, do NOT update it — skip, count, and log the same `anc_cross_hospital_visit_conflict` event. Same-hospital or NULL-hospital rows: update as today (NULL rows get claimed by the updating hospital here since this path historically created them — acceptable; add a comment).
8. Journey summary (:190-198) switches to the same DB-aggregate roll-up (count/MAX over stored rows, not payload length).

**Tests (write FIRST — extend `tests/integration/webhook-anc-referral.test.ts` cross-hospital section, reuse `tests/helpers/failingDb.ts`):**
- Hospital A pushes 2 visits (d1, d2); hospital B pushes 1 visit (d3) for the same CID → 3 rows survive, A's rows keep A's `hospital_id`, `anc_visit_count = 3`, `last_anc_date = d3`.
- B resends with visits (d3, d4) → A's 2 rows untouched, B has exactly d3+d4, count = 4.
- B pushes a visit dated d1 (A's date) → A's d1 row survives byte-identical, B's conflicting visit skipped, result `visitConflicts: 1`, other B visits in the same payload still insert.
- Transaction proof: injected failure mid-insert (failingDb) → A's AND B's prior rows all still present (no partial delete), journey summary unchanged.
- Polling path: `syncAncData` visit for a date owned by another hospital → row not modified, `hospital_id` not reassigned.
- Existing pinned tests :748-802 (same-hospital replace) and :838-882 (omitted visits) must pass, updated only where count semantics legitimately changed.

**Files:** `src/services/webhook.ts`, `src/services/sync/anc.ts`, `tests/integration/webhook-anc-referral.test.ts`, `tests/unit/services/sync-journey.test.ts`.
**Covering tests:** `npx vitest run tests/integration/webhook-anc-referral.test.ts tests/unit/services/sync-journey.test.ts tests/integration/hosxp-simulated-validation.test.ts tests/unit/services/webhook-delete-atomicity.test.ts` + `npx tsc --noEmit`.

---

## Task 6: Completeness surfacing, ingestion observability, and PHI-safe logging

**Problem:** Detection without visibility. The new counters (Tasks 3-5) must reach operators; an incomplete LOW assessment must not display as confirmed LOW (spec containment item 5); and `src/lib/logger.ts` `SENSITIVE_KEYS` (:11-22) does not redact HN or patient-name keys, which the spec (§5 P2, §10.1) requires before adding new telemetry.

**Required behavior:**

1. `processAncWebhook` result type: consolidate `{ downgradesBlocked, visitConflicts }` counters (introduced in T4/T5) into the exported result interface with JSDoc; both webhook routes return them in the response JSON (additive).
2. `POST /api/sync/browser-push` (`route.ts:218-256`): the `persist_anc` sync step detail includes the counters; when `downgradesBlocked > 0` or `visitConflicts > 0`, log one `logger.warn('anc_ingest_anomalies', { hospitalId, downgradesBlocked, visitConflicts })`.
3. `src/lib/logger.ts`: add `'hn'`, `'patient_name'`, `'patientname'`, `'firstname'`, `'lastname'` to `SENSITIVE_KEYS`. (Substring matching means keys like `hnList` will also redact — acceptable; do NOT add bare `'name'`, which would redact `eventName`/`hostname`.)
4. Journey detail API (`src/services/journey-list.ts` `getJourneyDetail`, latest-screening mapping around :626-677): expose `ancAssessment: { incomplete: boolean; missingRequired: string[] } | null` parsed from the latest `cached_anc_risks.risk_factors` JSON (null when absent/unparseable/legacy `{}`).
5. Journey detail page: when `ancAssessment?.incomplete`, render an amber marker beside the risk chip: `การประเมินความเสี่ยงไม่สมบูรณ์ (ขาดข้อมูล {n} รายการ)` — an incomplete LOW never displays as a bare confirmed-LOW chip. Add the field to the page's local `JourneyDetailResponse` type (and `src/types/api.ts` if the shared type lives there).

**Tests (write FIRST):**
- `tests/unit/lib/logger.test.ts` (extend or create following existing logger tests if any): context `{ hn: '12345', patientName: 'x', firstname: 'x' }` → all `[REDACTED]`; `{ eventName: 'ok', hostname: 'h' }` → NOT redacted; new ANC events' context shapes contain no PHI keys.
- Route/integration: browser-push response and sync step carry the counters for a payload that triggers a blocked downgrade.
- `tests/unit/pages/journey-detail.test.tsx`: fixture with `ancAssessment: { incomplete: true, missingRequired: [...] }` → marker text renders; `incomplete: false`/null → no marker.
- `getJourneyDetail` unit coverage for the JSON parse (valid, `{}`, malformed → null).

**Files:** `src/services/webhook.ts` (result type), `src/app/api/sync/browser-push/route.ts`, `src/app/api/webhooks/patient-data/route.ts`, `src/lib/logger.ts`, `src/services/journey-list.ts`, `src/types/api.ts`, `src/app/(provincial)/pregnancies/[journeyId]/page.tsx`, test files.
**Covering tests:** `npx vitest run tests/unit/lib tests/unit/pages/journey-detail.test.tsx tests/integration/webhook-anc-referral.test.ts` plus any route test file touched, + `npx tsc --noEmit`.

---

## Task 7: Full verification gates + containment acceptance checklist

1. Run and record: `npm test` (full suite), `npx tsc --noEmit`, `npm run lint`, `npm run build` (production). All must be clean (baseline was 1920 passed / 4 skipped, 0/0 lint, tsc clean).
2. Verify each spec acceptance-gate bullet with concrete evidence (test name or file:line):
   - `sev*(null)` tests expect unknown ✓/✗
   - Partial BP cannot be normal ✓/✗
   - No missing field or schedule state renders green or complete ✓/✗
   - No synthetic normal value reaches storage or risk evaluation ✓/✗
   - Hospital B payload cannot reduce, overwrite, or reattribute hospital A's visit rows; unrepresentable legacy conflict is explicit and observable ✓/✗
   - Existing clinical thresholds unchanged (diff `src/config/anc-risk-rules.ts` + `anc-clinical.ts` constants against git base — numbers byte-identical) ✓/✗
3. Write the evidence table to `docs/superpowers/plans/evidence/2026-07-14-anc-containment-gates.md`.
4. Do NOT deploy — production deploy remains operator-gated per runbook.
