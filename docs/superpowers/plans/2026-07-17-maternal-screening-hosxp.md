# Maternal Labor-Triage Screening — Phase 6 (HOSxP Mapping + Rollout Readiness) — SDD Plan

**Source spec:** `docs/maternal-screen-plan.md` §11 Phase 6, §9.1 (transport), §17 (rollout).
**Prereq:** Phases 0–5 code-complete. Phase 0 sign-off bundle delivered
(`docs/clinical/maternal-screen-phase0-signoff.md`) — still unsigned; therefore everything
here stays SHADOW: no alert activation, ingest/events flags remain fail-closed, simulation
never runs in production.

**Scope (engineering-buildable only):** HOSxP field-source mapping, Pascal sender extension,
dev-simulation profiles for shadow validation, the deferred bed-tile cross-source join, and
the rollout runbook. OUT OF SCOPE (human/operational, spec Phase 6 items 4–6): running the
shadow cohort, clinician-vs-system comparison, acceptance metrics, alert activation.

## Global Constraints (binding)

**GC-H1 — Never fabricate.** A field with no structured HOSxP source is sent as `null`
("not assessed"), NEVER inferred from free text or defaulted (spec Phase 6 task 2, GC1).
The mapping doc must say NOT AVAILABLE explicitly per unavailable field.

**GC-H2 — Transport contract is frozen.** The sender emits exactly the §9.1 snake_case
object the webhook validates (`MS_KNOWN_TRANSPORT_KEYS` allowlist in `src/services/webhook.ts`
rejects unknown keys; strict ISO-8601 `assessed_at`; enum vocabularies from
`src/types/maternal-screening.ts`). No transport change in this phase.

**GC-H3 — Shadow discipline.** Simulation profiles are dev-only (`isSimulationEnabled()`
is NODE_ENV-guarded, never production). Bed-tile display obeys the same rules as every other
surface: tokens from `maternal-screen-display.ts`, `TOKEN[v] ?? FALLBACK`, NOTHING green,
shadow tooltip, renders nothing when values are null. Red is RESERVED on BedTileFull for the
crit bed alarm — the acuity chip may use the config red for EMERGENCY text/border but MUST NOT
add a competing glow/border on the tile.

**GC-H4 — Cross-source join correctness.** The ward page merges central-DB screening
summaries into live-HOSxP occupancy by `(hcode, an)`. A missing/failed central fetch degrades
to "no chips" (never an error tile, never blocks the HOSxP feed). Tenant isolation: the ward
page's central fetch is scoped to its own hospital.

**GC-H5 — Conventions.** Ward hooks pattern (`useMaternityWardStateFull`, SWR keys, 20–60s
refresh); route auth mirrors sibling hospital routes; PGlite tests; Thai UX; no PHI in logs.
Existing tests stay green. Quality gates per task; full suite + build at phase end.

## Task H1: HOSxP field-source mapping (research + doc)

**Files:** NEW `docs/hosxp/maternal-screening-field-map.md`.
Map EVERY §9.1 transport field to its HOSxP source. Sources of truth: the existing SQL in
`src/config/hosxp-queries.ts` (ipt/ipt_labour/ipt_pregnancy/ipd_nurse_note/lab usage
precedents), the current Pascal sender `docs/hosxp/KKLRMSWebhookUnit.pas` (what it already
reads), and the HOSxP knowledge MCP tools (`search_hosxp_knowledge`, `search_knowledge`) for
table/column verification. For each field: HOSxP table.column + extraction condition + value
mapping to our enum (e.g. dipstick albumin string → proteinuria_grade via
`normalizeProteinuriaGrade` server-side — sender passes raw), or **NOT AVAILABLE → null**
with one line why. Expect many symptom/assessment fields (headache, blurred_vision,
consciousness, bleeding assessment) to be NOT AVAILABLE — that is the honest, expected
outcome; say so. Include a summary table: available / partially available / not available
counts. No production code.

## Task H2: Pascal sender extension

**Files:** EDIT `docs/hosxp/KKLRMSWebhookUnit.pas` (+ its accompanying doc section if any).
Extend the reference sender to build the OPTIONAL `maternal_screening` object per H1's map:
only fields H1 marked available; everything else omitted or null; `assessed_at` = the source
observation timestamp in strict ISO-8601 with offset; `source_pk` = a stable HOSxP key
(per H1's recommendation) for idempotency. Follow the unit's existing JSON-building style
verbatim. The object rides the existing labor patient payload — no new endpoint. Note in
comments: the block is only emitted when the hospital enables it (mirror however the unit
gates optional sections today; if it has no gating precedent, wrap in a const flag default
false). Cannot be unit-tested here (Pascal, reference code for hospitals) — instead H3's
simulation profiles exercise the same transport shape end-to-end; state this explicitly.

## Task H3: Dev-simulation profiles for shadow validation

**Files:** EDIT `src/services/dev-simulation/profiles.ts` (+ evaluator/sender wiring in
dev-simulation as needed), tests.
Add representative profiles exercising each local tier (MILD/MODERATE/SEVERE via BP, labs,
symptoms), each acuity state (URGENT, EMERGENCY via shock/SpO2/pulse; UNKNOWN via missing
stability fields), and each suspected hemorrhage pattern (abruptio incl. concealed, previa,
rupture, vasa previa) — profile values MUST be copied from
`tests/fixtures/maternal-screen-clinical-cases.json` cases (the approved oracle), not
invented. Wire them so a simulated hospital's browser-push payload carries the
`maternal_screening` object (same transport the Pascal sender emits). Gated by
`isSimulationEnabled()` (already NODE_ENV-guarded). Test: with simulation enabled + ingest
flag on (test env), a simulated push produces assessments whose tier/acuity match the source
oracle case per profile.

## Task H4: Bed-tile cross-source join (deferred from Phase 5)

**Files:** NEW route `src/app/api/hospitals/[hcode]/maternal-screen-summaries/route.ts`
(GET, session-auth like sibling hospital routes; returns
`{ uiEnabled, summaries: [{ an, localTier, emergencyAcuity, isComplete, assessedAt }] }`
for ACTIVE cached_patients of that hospital — service function in
`src/services/maternal-screening-store.ts` or dashboard.ts sibling, flag-nulled server-side
like W1); NEW hook `src/hooks/useMaternalScreenSummaries.ts` (SWR, keyed by hcode, 30s,
conditional-null, stops polling when `uiEnabled` false — same pattern as
useMaternalScreenings); EDIT `src/app/(hospital)/hospital-maternity-ward/page.tsx` (fetch
summaries, build an `an → summary` map, pass down); EDIT `src/components/maternity/BedTileFull.tsx`
(+ thread through `WardLayoutViewFull`/`DraggableBedTile`): render tier/acuity as small pills
in the identity-row pill slot (the Allergy/blood_grp pill recipe), colors from
maternal-screen-display light tokens, shadow tooltip, nothing when summary absent (GC-H4),
NO tile-level glow/border change (GC-H3). BedTile (compact) left unchanged this phase —
document why (space; Full tile is the ward's working view). Tests: route (tenant isolation +
flag-off nulls + shape), hook-mocked page/tile tests (pills render for a severe summary;
absent summary renders nothing; no green anywhere — extend the no-green DOM scan pattern).

## Task H5: Rollout runbook

**Files:** NEW `docs/maternal-screen-rollout-runbook.md`.
The operator's script for spec §17.2, concrete to THIS deployment: current flag states
(UI default-ON, ingest/events OFF); pre-req = signed Phase 0 bundle; step-by-step pilot:
pick pilot hospital → set `MATERNAL_SCREEN_INGEST_ENABLED=true` (docker-compose env +
restart) → verify via Redis sync-run counters (`maternalScreenAssessments`) + the shadow UI →
shadow-comparison instructions (clinician reviews the patient-detail card vs their own
assessment; where mismatches get recorded) → events enablement criteria (only after
sign-off + shadow acceptance; note SSE fan-out cost) → rollback (flags to false; data is
append-only, no destructive rollback needed). Include the observability watchlist
(`maternal_screen_webhook_ingest_rejected`, `maternalScreenIngestErrors`,
`anc_ingest_anomalies` style counters) and the smoke commands. No PHI.

## Phase-end gate
Full `npm test` + `tsc` + `lint` + `build` green; whole-phase review (H1–H5); ledger +
memory updated. Activation itself remains operator+clinician gated.
