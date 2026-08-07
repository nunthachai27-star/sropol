# Maternal Labor-Triage Screening — SDD Execution Plan

**Source spec:** `docs/maternal-screen-plan.md` (design doc) + `docs/maternal-screen.pdf`
**Scope of THIS program:** the phases that are safe to build **before** clinical
sign-off. Everything ships **inert behind feature flags defaulting to OFF/shadow**.
Phases 4–6 (active UI alerts, ward propagation, HOSxP mapping) and any production
activation are **out of scope** — they are a config flip *after* an obstetric owner
signs the Phase 0 decision tables (spec §11, §17, AC #17/#18/#24).

This plan covers: Phase 0 (provisional, **unapproved** rule fixture), Phase 1
(pure types + config rules + engine + tests), feature flags, Phase 2 (dormant
persistence + transactional store), Phase 3 (backward-compatible, flag-gated
ingest + read API + event type). No clinical rule is approved here.

---

## Global Constraints (binding — every reviewer receives these verbatim)

**GC1 — Never fabricate "normal" from missing data.** Unassessed inputs (`null`,
`'UNKNOWN'`) must never yield a normal/negative/reassuring result. Reuse the
`Severity` discriminated-union pattern in `src/services/anc-clinical.ts:28` where a
component's absence yields `'unknown'`, never `'normal'`. `isComplete` is
**orthogonal** to severity: a proven `LOCAL_SEVERE`/`EMERGENCY` result MUST be able
to coexist with `isComplete:false` and a non-empty `missingRequiredFields`.
(spec §4.1, §5, §6.2)

**GC2 — Provisional, unapproved, inert.** The fixture carries
`status: PROVISIONAL_UNAPPROVED`, `approvedBy: null`, `approvedAt: null`,
`ruleSetVersion: "0.1.0-provisional"`. No code path may drive a production alert.
All four feature flags default OFF (shadow mode ON by default). The server ALWAYS
recomputes `localTier`/`emergencyAcuity`/`isComplete` from raw input and ignores
any client-supplied values. (spec §11 exit gates, §17, AC #8/#17/#18/#24)

**GC3 — Separate concepts; no severity-vocabulary collision.** `localTier`
(`LOCAL_MILD|LOCAL_MODERATE|LOCAL_SEVERE|NO_LOCAL_MATCH`), `emergencyAcuity`
(`STABLE|URGENT|EMERGENCY|UNKNOWN`), `suspectedConditions[]`, and `isComplete` are
distinct fields — never merged into one enum, and never stored or displayed as
`partographSeverity` (`CdssSeverity` = INFO/WARN/ALERT/CRITICAL, `src/types/api.ts:219`)
or `AncRiskLevel` (LOW/HR1/HR2/HR3, `src/config/anc-risk-rules.ts`). (spec §6.2, §10.3,
AC #14/#19/#25)

**GC4 — Highest proven result wins per axis; suspected ≠ diagnosed.** A lower tier
never replaces a higher *proven* tier; a lower acuity never replaces a higher
*proven* acuity. Hemorrhage patterns are labeled "suspected," never diagnosed.
Concealed/internal bleeding MUST be flaggable with `vaginalBleeding` false/null; a
normal FHR or normal maternal BP MUST NOT downgrade maternal instability or prove
placenta previa. (spec §5, §7.3, §7.4, AC #20)

**GC5 — Repo conventions (verified against current code).**
- Table def: kebab-case file in `src/db/tables/`, camelCase `…Table` export,
  snake_case table name, uuid PK, `created_at` datetime, `idx_`-prefixed indexes;
  register in **BOTH** the named-export block and the `ALL_TABLES` array of
  `src/db/tables/index.ts` (FK order: after `maternalJourneysTable`/`cachedPatientsTable`).
- Any string column fed from a webhook payload goes through the existing
  `fitOrNull(value, max, field)` guard pattern (`src/services/webhook.ts`).
- Feature flags: helper functions in `src/lib/feature-flags.ts` (pattern:
  `isSimulationEnabled()` at `:13`). **No `BMS_` prefix** (reserved for BMS Session
  API); use the `*_ENABLED` env-var convention.
- Thresholds/rule constants centralized in `src/config/` (constitution IV).
- Tests: PGlite `createTestDb()` / `createPgliteDb()` harness (SQLite removed
  2026-07-10). pg returns `Date` objects for datetime columns (toIsoString when
  comparing) and JSONB columns come back **pre-parsed**.
- Production sync is **browser-only**: `src/services/sync/polling.ts` never runs in
  prod. Ingest must be reachable from `/api/sync/browser-push` + `src/services/webhook.ts`,
  not `polling.ts`, or it is dead code.

**GC6 — Immutable audit + atomic persistence.** Assessments are append-only
immutable clinical events (copy the insert-if-changed / append-only pattern of
`src/services/anc-screening.ts`). Corrections create a NEW row referencing
`supersedes_id`; originals are never mutated. The assessment write and the
`cached_patients` summary update happen in ONE `db.transaction`. Any SSE/event
emits only AFTER commit (copy the webhook.ts post-commit pattern, `:1097-1204`). If
evaluation throws, REJECT the write and raise an operational error — never store a
fallback `NO_LOCAL_MATCH`/`LOCAL_MILD`/`STABLE`. Actor identity is snapshotted
inline as nullable, non-FK columns (audit_logs pattern). No PHI (name/cid/free-text
narrative) in logs, events, or metrics. (spec §8.3, §15, AC #9/#10/#11/#12)

**GC7 — Backward compatibility.** The webhook `maternal_screening` object is
OPTIONAL; every existing webhook/browser-push fixture and sender remains green when
it is absent. (spec §9.1, AC #13)

**Quality gates (each task):** targeted tests GREEN, `npx tsc --noEmit` clean,
`npm run lint` clean on touched files. Full `npm test` + `npm run build` at program end.

---

## Task 1: Phase 0 provisional clinical fixture + evidence register

**Files (all new):**
- `docs/clinical/maternal-screen-rules-v1.yaml`
- `docs/clinical/maternal-screen-acuity-v1.yaml`
- `tests/fixtures/maternal-screen-clinical-cases.json`
- `docs/clinical/maternal-screen-evidence-register.md`

**Requirements:**
1. `maternal-screen-rules-v1.yaml`: metadata block
   `{ ruleSetVersion: "0.1.0-provisional", status: PROVISIONAL_UNAPPROVED, approvedBy: null, approvedAt: null, sourcePdf: "docs/maternal-screen.pdf" }`, then a `rules:` list.
   Each rule: `id`, `purpose` (`LOCAL_PDF_TIER`), `controllingSourceId`
   (`LOCAL_PDF`), `supportingSourceIds`, `condition`, `localTier`, an explicit
   `logic` (`anyOf`/`allOf` with exact numeric boundaries and operators), and a
   `clinicalDecision` block `{ ref: "<spec §7.5 item number>", choice: "<the
   conservative interpretation chosen>", approved: false }`.
   Encode the stable IDs from spec §7.1 verbatim: `PE-HEADACHE-IN-LOCAL-SEVERE-COLUMN`,
   `PE-BP-MODERATE-SBP-150`, `PE-BP-MODERATE-DBP-100`, `PE-BP-SEVERE-SBP-160`,
   `PE-BP-SEVERE-DBP-110`, `PE-BP-MILD-140`, `PE-LAB-SEVERE-CREATININE-1_1`,
   `PE-LAB-SEVERE-PLATELET-100K`, `PE-PROT-MILD-1PLUS`, `PE-PROT-SEVERE-2TO3PLUS`,
   `APH-GA26-VAGINAL-BLEEDING`, `APH-ABRUPTIO-PATTERN`, `APH-PREVIA-PATTERN`,
   `APH-RUPTURE-UTERUS-PATTERN`, `APH-VASA-PREVIA-PATTERN`.
2. Resolve every ambiguous decision from spec §7.5 (1–19) and §20 with the
   **safety-conservative** choice, each flagged `approved: false`:
   - highest individual finding wins within each axis (anyOf per domain);
   - one severe symptom alone ⇒ `LOCAL_SEVERE` screen tier;
   - moderate BP = `SBP>=150 OR DBP>=100`; severe BP = `SBP>=160 OR DBP>=110`;
     mild BP = `SBP>=140 OR DBP>=90` and no higher tier matched;
   - proteinuria 2+ overlap resolves to **severe** (higher tier wins, conservative);
   - creatinine **strictly > 1.1** is severe (1.10 exactly = not severe);
   - platelet **< 100000** is severe (exactly 100000 = not severe);
   - FHR normal band inclusive 110–160 (109 and 161 abnormal);
   - APH = `GA>=26 weeks AND vaginalBleeding` ⇒ `LOCAL_SEVERE`; unknown GA + bleeding
     ⇒ do NOT downgrade — emergency-acuity path handles it and `gaWeeks` goes to
     `missingRequiredFields`.
3. `maternal-screen-acuity-v1.yaml`: SEPARATE fixture (spec AC #24), same metadata
   shape, `purpose: EMERGENCY_ACUITY`, rules mapping instability findings
   (shockSignsPresent, consciousness in {PAIN,UNRESPONSIVE}, oxygenSaturationPct<95,
   maternalPulseBpm>120, bleedingRate HEAVY, fetalTracingPattern in
   {NON_REASSURING,SINUSOIDAL}) to `EMERGENCY`/`URGENT`. Conservative, `approved: false`.
4. `tests/fixtures/maternal-screen-clinical-cases.json`: array of cases, each
   `{ name, input: <partial MaternalScreenInput>, expect: { localTier,
   emergencyAcuity, isComplete, suspectedConditions, matchedRuleIds,
   missingRequiredFields } }`. Cover the spec §12.1 boundary set: GA 19+6/20+0/25+6/26+0,
   SBP 139/140/149/150/159/160, DBP 99/100/109/110, creatinine 1.10 and 1.11,
   platelets 99999/100000, FHR 109/110/160/161, each symptom alone, each hemorrhage
   pattern, concealed abruption (no visible bleeding), uterine rupture with
   intra-abdominal signs and no vaginal bleeding, vasa previa (bleeding + ROM +
   sinusoidal), painless bleeding (suspected previa not diagnosed), normal-FHR does
   not downgrade instability, bleeding at GA 23+6/24+0/25+6/26+0/unknown, multiple
   simultaneous severe findings, severe + unrelated missing fields, all-unknown input
   ⇒ `NO_LOCAL_MATCH`+`UNKNOWN` acuity+`isComplete:false` (NOT normal).
5. `maternal-screen-evidence-register.md`: the spec §2.5 reference list with the
   versions/dates recorded there; each `sourceId` used by the YAML rules must appear.

**Constraints:** GC1, GC2, GC4. This is data/docs — the JSON cases are the test
oracle T3 consumes. Do NOT write TS code in this task.

**Done when:** all four files exist, YAML parses, JSON is valid and covers every
§12.1 boundary, every rule/case is internally consistent, and the provisional/unapproved
status is unmistakable in both YAML headers.

---

## Task 2: Phase 1 types + config rule definitions

**Files (new):** `src/types/maternal-screening.ts`, `src/config/maternal-screen-rules.ts`,
`tests/unit/config/maternal-screen-rules.test.ts`

**Requirements:**
1. `src/types/maternal-screening.ts`: the enums and interfaces from spec §6 —
   `MaternalScreenLocalTier`, `MaternalEmergencyAcuity`, `ProteinuriaGrade`,
   `HeadacheSeverity`, `MaternalScreenInput`, `SuspectedMaternalCondition`,
   `MaternalScreenMatch`, `MaternalScreenResult`. Nullable booleans mean
   assessed-true / assessed-false / not-assessed(null). No `any`.
2. `src/config/maternal-screen-rules.ts`: the rule set as typed TS data mirroring
   `docs/clinical/maternal-screen-rules-v1.yaml` and `-acuity-v1.yaml` (constitution IV
   — thresholds live in config, not the service). Export `MATERNAL_SCREEN_RULE_SET_VERSION
   = "0.1.0-provisional"`, `LOCAL_TIER_RANK` and `EMERGENCY_ACUITY_RANK` maps, the
   `MANDATORY_SCREEN_FIELDS` list (fields whose absence sets `isComplete:false`), and a
   `MaternalScreenRule[]` array whose `evaluate(input)` lambdas are pure and
   null-guarded (a rule NEVER fires on a `null`/`UNKNOWN` component).
3. Test `maternal-screen-rules.test.ts`: assert rule-id stability (exact ID set matches
   the YAML), every rule has `purpose`/`controllingSourceId`, rank maps are total and
   strictly ordered, and the config version equals the fixture version.

**Constraints:** GC1, GC2, GC3, GC5 (config home). Pure — no I/O, no DB, no UI imports.

**Done when:** types compile, config test GREEN, `tsc` clean, no `any`.

---

## Task 3: Phase 1 pure rule engine + table-driven unit tests

**Files (new):** `src/services/maternal-screening.ts`,
`tests/unit/services/maternal-screening.test.ts`

**Requirements:**
1. `evaluateMaternalScreen(input: MaternalScreenInput): MaternalScreenResult` — pure,
   deterministic, no I/O. Evaluation order per spec §7.2: normalize → severe emergency
   triggers → emergency acuity (independent of cause & visible blood volume) → suspected
   hemorrhage patterns → preeclampsia evidence → local PDF tier projection → select
   highest local tier via `LOCAL_TIER_RANK` → completeness → return ALL matches.
2. Normalize `proteinuriaGrade` from accepted source spellings (e.g. `'1+'`, `'trace'`,
   `'negative'`, Thai) into the ordinal enum; unknown/blank ⇒ `'UNKNOWN'` (GC1).
3. `isComplete` computed independently from `MANDATORY_SCREEN_FIELDS`; a proven
   severe/emergency result coexists with `isComplete:false` (GC1).
4. `evaluatedAt` set by caller-injected clock or accepted as a param — do NOT call
   `Date.now()`/`new Date()` inside the pure engine (testability + workflow rule).
5. Never default a missing input to a normal finding; unknown acuity is `'UNKNOWN'`,
   not `'STABLE'` (GC1).
6. Test suite: table-driven over `tests/fixtures/maternal-screen-clinical-cases.json`
   (every case's expected fields asserted) PLUS explicit boundary assertions for each
   §12.1 threshold. Include: concealed abruption with `vaginalBleeding:false` still
   flags the pattern (GC4); normal FHR does not lower `emergencyAcuity` (GC4);
   all-unknown ⇒ `NO_LOCAL_MATCH`/`UNKNOWN`/`isComplete:false` (GC1).

**Constraints:** GC1, GC2, GC3, GC4. Consumes Task 1 fixture + Task 2 config/types.

**Done when:** every fixture case + boundary test GREEN, `tsc`/lint clean, engine has
zero imports from db/api/ui.

---

## Task 4: Feature flags

**Files:** `src/lib/feature-flags.ts` (edit), `tests/unit/lib/feature-flags.test.ts`
(new or edit)

**Requirements:**
1. Add four helpers following the existing `isSimulationEnabled()` pattern, NO `BMS_`
   prefix:
   - `isMaternalScreenIngestEnabled()` — env `MATERNAL_SCREEN_INGEST_ENABLED`, default **false**;
   - `isMaternalScreenShadowMode()` — env `MATERNAL_SCREEN_SHADOW_MODE`, default **true**
     (suppress workflow-changing effects unless explicitly disabled);
   - `isMaternalScreenUiEnabled()` — env `MATERNAL_SCREEN_UI_ENABLED`, default **false**;
   - `isMaternalScreenEventsEnabled()` — env `MATERNAL_SCREEN_EVENTS_ENABLED`, default **false**.
2. Truthy parsing consistent with the existing helper (e.g. `=== 'true'`).
3. Tests cover default-off/default-shadow and explicit enable.

**Constraints:** GC2, GC5. Done when tests GREEN, tsc/lint clean.

---

## Task 5: Phase 2 persistence schema

**Files:** `src/db/tables/maternal-screening-assessments.ts` (new),
`src/db/tables/index.ts` (edit), `src/db/tables/cached-patients.ts` (edit),
`tests/integration/maternal-screening-schema.test.ts` (new)

**Requirements:**
1. `maternalScreeningAssessmentsTable` per spec §8.1 columns: `id` uuid PK,
   `labor_admission_id` uuid (FK to `cached_patients`) — verify the actual FK target and
   nullability against `cached-patients.ts` conventions before finalizing; `hospital_id`
   uuid FK; `journey_id` uuid nullable FK to `maternal_journeys` (existing linking
   convention); `source_system` string; `source_pk` string nullable; `assessed_at`
   datetime; `assessed_by` string nullable (inline, non-FK — GC6); `input_json` json;
   `local_tier` string; `emergency_acuity` string; `is_complete` boolean;
   `suspected_conditions_json` json; `matches_json` json; `missing_fields_json` json;
   `rule_set_version` string; `supersedes_id` uuid nullable; `created_at` datetime.
   Text columns use generous `maxLength` (field-width lesson).
2. Indexes: unique `(hospital_id, source_system, source_pk)` (partial/when source_pk
   present per repo capability); `(labor_admission_id, assessed_at)`;
   `(hospital_id, emergency_acuity, assessed_at)`.
3. Register in BOTH lists of `src/db/tables/index.ts` (GC5), FK-correct order.
4. Add nullable summary columns to `cached_patients` (spec §8.2):
   `maternal_screen_local_tier`, `maternal_screen_emergency_acuity`,
   `maternal_screen_condition_codes`, `maternal_screen_assessed_at`,
   `maternal_screen_is_complete`, `maternal_screen_rule_set_version`. Nullable —
   backward compatible (SchemaSync ADDs columns).
5. Integration test (PGlite `createTestDb()`): table + all columns created, indexes
   present, FKs resolve, new `cached_patients` columns present and nullable.

**Constraints:** GC3 (summary columns are NOT partograph_severity), GC5, GC6. Done
when schema test GREEN, tsc/lint clean.

---

## Task 6: Phase 2 transactional store service

**Files:** `src/services/maternal-screening-store.ts` (new),
`tests/integration/maternal-screening-store.test.ts` (new)

**Requirements:**
1. `saveMaternalScreenAssessment(db, params)` — normalizes raw input, calls
   `evaluateMaternalScreen` (Task 3) server-side, and in ONE `db.transaction`:
   inserts the immutable assessment row AND updates the `cached_patients` latest-summary
   projection. String columns via the `fitOrNull` guard (GC5).
2. Idempotent upsert-by-source: replaying the same `(hospital_id, source_system,
   source_pk)` creates NO duplicate row and NO changed summary (GC6, AC #10).
3. Correction/supersession: an explicit correction path inserts a new row with
   `supersedes_id` set; the original is never mutated (GC6, AC #11).
4. If `evaluateMaternalScreen` throws, the transaction rolls back and an operational
   error is raised — no fallback row, no summary mutation (GC6, spec §8.3).
5. Tenant isolation: one hospital's write never reads/overwrites another's rows.
6. Latest-summary reconstructable from assessment history (AC #12) — provide/test a
   `reconcileLatestSummary` helper.
7. Return a structured result (counts, ids) with NO PHI.
8. Integration tests (PGlite, use the `failingDb` harness for the rollback case):
   insert+summary, idempotent replay, correction chain, eval-throw rollback, tenant
   isolation, summary projection/reconciliation.

**Constraints:** GC1, GC2, GC5, GC6. Consumes Task 3 engine + Task 5 schema. Done
when all integration tests GREEN, tsc/lint clean.

---

## Task 7: Phase 3 webhook ingest (backward compatible, flag-gated)

**Files:** `src/services/webhook.ts` (edit), `src/types/api.ts` (edit as needed),
webhook/browser-push validation site, `tests/integration/webhook-maternal-screening.test.ts` (new)

**Requirements:**
1. Extend `WebhookPatientPayload` with the OPTIONAL `maternal_screening` object from
   spec §9.1 (transport snake_case; correct `pih_diagnosed` casing at the boundary,
   `piHDiagnosed` internally).
2. Validate (spec §9.2): ISO timestamp + future-time tolerance, numeric ranges that
   reject impossible but not clinically-extreme values, enums, nullable-boolean
   semantics, max JSON size. Invalid assessment must NOT partially update the summary.
3. Server-only evaluation via Task 3 engine + Task 6 store; ingest gated by
   `isMaternalScreenIngestEnabled()` (default off ⇒ no-op). Client-supplied tier/acuity/
   completeness ignored (GC2, AC #8).
4. Reachable from the production browser-push path AND `webhook.ts` for non-HOSxP
   hospitals (GC5 — not `polling.ts`).
5. Backward compatibility: every existing webhook/browser-push test stays GREEN when
   the object is absent; add a test proving a legacy payload is unaffected (GC7, AC #13).
6. New integration test: a severe-APH `maternal_screening` payload with the flag ON
   persists an assessment + summary and returns the severe result and matched rule IDs;
   idempotent replay makes no duplicate.

**Constraints:** GC2, GC5, GC6, GC7. Done when new + existing webhook tests GREEN,
tsc/lint clean.

---

## Task 8: Phase 3 read API + SSE event type + WEBHOOK-SPEC docs

**Files:** `src/app/api/patients/[an]/maternal-screenings/route.ts` (new) or nested
route per repo convention, `src/types/api.ts` (edit), SSE event type + gated broadcast,
`docs/WEBHOOK-SPEC.md` (edit), `tests/integration/maternal-screenings-api.test.ts` (new)

**Requirements:**
1. `GET /api/patients/{an}/maternal-screenings?limit=&cursor=` — latest summary + raw
   normalized inputs (authorization-appropriate) + matched rules/evidence + missing
   fields + paginated history + supersession markers. Auth matches existing patient
   read routes.
2. (If a manual write endpoint is in scope) `POST` recomputes server-side and ignores
   client tier/acuity/completeness (AC #8) — otherwise omit and note it as Phase 4 UI work.
3. Define `MaternalScreenStateChangedEvent` (spec §10.4) in the SSE types; broadcast
   ONLY after commit and ONLY on a meaningful transition, gated by
   `isMaternalScreenEventsEnabled()` (default off). Channel name kebab-case, payload
   `type` snake_case, matching existing SSE convention (`src/types/api.ts:320-345`,
   `src/lib/sse.ts:54`). Replayed idempotent payload emits no duplicate event.
4. `docs/WEBHOOK-SPEC.md`: optional payload schema, per-tier/acuity/hemorrhage
   examples, unknown-vs-false semantics, idempotency, rule-set-version, backward-compat,
   error examples.
5. Integration test: seed an assessment (via Task 6 store), GET returns latest + history
   with correct shape and pagination; event type compiles and gated broadcast is covered.

**Constraints:** GC2, GC3, GC5, GC6, GC7. Done when API test GREEN, tsc/lint clean,
docs updated.

---

## Out of scope (post Phase-0 sign-off — do NOT build here)

Phase 4 patient-detail/assessment UI, Phase 5 ward tiles + active alert propagation,
Phase 6 HOSxP Pascal mapping + shadow-cohort activation, and any change that surfaces
an *unapproved* clinical tier/acuity to a clinician or flips a flag to active. The
flags and event type shipped here make those a later config/UI change, not a rebuild.

---
**AMENDMENT 2026-07-16 (operator decision):** `MATERNAL_SCREEN_UI_ENABLED` default flipped
to **ON** (`!== 'false'`) — the read-only, shadow-labeled UI (spec §17.2 step 4) displays by
default; explicit `false` hides it. GC2 remains in force for ingest/events (fail-closed) and
for the PROVISIONAL_UNAPPROVED rule set; no alert/workflow behavior changed.
