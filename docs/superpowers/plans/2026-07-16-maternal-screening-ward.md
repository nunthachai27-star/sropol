# Maternal Labor-Triage Screening — Phase 5 (Dashboard/Ward Propagation) — SDD Plan

**Source spec:** `docs/maternal-screen-plan.md` §10.3 (ward/dashboard), §11 Phase 5.
**Prereq:** Phases 0–4 code-complete on this branch. Server-side event emission
(post-commit, transition-only, gated by `MATERNAL_SCREEN_EVENTS_ENABLED`) already exists.
`MATERNAL_SCREEN_UI_ENABLED` now defaults **ON** (operator decision 2026-07-16) — display
surfaces are live-by-default but shadow-labeled; ingest/events remain fail-closed.

**Architecture correction (scout-verified):** the hospital maternity-ward bed tiles
(`BedTile`/`BedTileFull`) are fed by LIVE HOSxP SQL via the BMS Session API
(`src/services/maternity-ward.ts` → `hosxp-queries.ts`), NOT by `cached_patients` — and that
page has no SSE. Surfacing the screening axes there requires a new cross-source data path
(central-DB fetch keyed by hcode+an merged into occupancy rows). That is DEFERRED to the
Phase 6 window with this rationale recorded. THIS phase propagates the axes to the surfaces
that read `cached_patients` — the exact same path `partograph_severity` flows through today:
- `getHighRiskPatients` → `/api/dashboard/high-risk` → `HighRiskPatientList` (provincial
  dashboard, light + kiosk variants);
- `getHospitalPatients` → `/api/hospitals/[hcode]/patients` → hospital patient list.

## Global Constraints (binding — reviewers receive verbatim)

**GC-W1 — No green anywhere; shadow provenance.** Chips use ONLY
`src/config/maternal-screen-display.ts` tokens with the `TOKEN[value] ?? FALLBACK` lookup
(DB values are raw strings; out-of-vocabulary must hit the muted fallback). STABLE and
NO_LOCAL_MATCH render muted, never green. Kiosk variants must supply dark-theme colors via
NEW config entries (see W2) — also covered by the no-green regression lock. List chips carry
`title`/tooltip text marking the value as provisional shadow screening.

**GC-W2 — Axis separation.** Never merge into `partographSeverity`/`CdssSeverity`,
`AncRiskLevel`, or CPD `RISK_LEVELS`. The new chips sit BESIDE `PartographCell`, in their own
column/slot, own `data-*` attributes. (api.ts GC3 comment, spec AC #14/#19.)

**GC-W3 — Server-side flag gate.** When `isMaternalScreenUiEnabled()` is false the SERVICE
returns the maternal-screen fields as `null` (both the typed camelCase fields AND — for
`getHospitalPatients`' `SELECT cp.*` spread — the raw snake_case keys, which today leak
untyped regardless of flag; fix that leak here). Client components render a chip only when a
value is present — no client env reads.

**GC-W4 — Conventions.** `HighRiskPatient` is defined TWICE (`src/types/api.ts:297` and a
local copy in `src/components/dashboard/HighRiskPatientList.tsx:14`) — update both. Kiosk
variant convention: `variant?: 'light' | 'kiosk'` prop + `--kiosk-*` CSS vars + glow only for
the highest state (RiskChip precedent, HighRiskPatientList.tsx:42-70). Staleness:
`formatRelativeAge(assessedAt, 'short')`. Tests: fixture-spread + override, chip testids
(`maternal-screen-tier-chip` naming family), flag on/off pairs, exact-Thai.

**GC-W5 — No clinical logic in UI; no engine/store/fixture changes.** Read-only propagation
of stored columns. Existing tests must stay green (esp. HighRiskPatientList, dashboard,
hospital-patients, full-flow).

## Task W1: Cached-path projections + types + server-side gate

**Files:** EDIT `src/services/dashboard.ts` (`getHighRiskPatients`: add
`cp.maternal_screen_local_tier, cp.maternal_screen_emergency_acuity,
cp.maternal_screen_is_complete, cp.maternal_screen_assessed_at` to the SELECT + `HighRiskRow`
+ mapping; `getHospitalPatients`: add typed camelCase mapping AND when the UI flag is off
null the four camelCase fields and overwrite the leaked snake_case keys to null — one shared
small helper, flag checked once per request not per row); EDIT `src/types/api.ts`
(`HighRiskPatient` + `PatientListItem` gain `maternalScreenLocalTier:
MaternalScreenLocalTier | null`, `maternalScreenEmergencyAcuity: MaternalEmergencyAcuity |
null`, `maternalScreenIsComplete: boolean | null`, `maternalScreenAssessedAt: string | null`
— import types from `@/types/maternal-screening`); EDIT the local `HighRiskPatient` copy in
`HighRiskPatientList.tsx` to match (rendering itself is W2 — this task only keeps tsc green,
so add fields to the local interface without rendering). EDIT/NEW tests:
`tests/integration/full-flow.test.ts` or a focused new integration test proving —
flag on (default): seeded `cached_patients.maternal_screen_*` values appear camelCase in
`getHighRiskPatients` and `getHospitalPatientList` results; flag off (`vi.stubEnv` 'false'):
all four fields null AND no `maternal_screen_*` snake_case key survives in the
hospital-patients response objects (the leak test). Datetime → ISO string via the repo's
toIsoString convention.

## Task W2: Dashboard chips (light + kiosk) + staleness

**Files:** EDIT `src/config/maternal-screen-display.ts` (add
`MATERNAL_SCREEN_TIER_COLOR_KIOSK` and `EMERGENCY_ACUITY_COLOR_KIOSK`
Records — EMERGENCY/SEVERE `var(--kiosk-high)`, URGENT/MODERATE `var(--kiosk-med)`, MILD
`var(--kiosk-med)`, STABLE/UNKNOWN/NO_LOCAL_MATCH `var(--kiosk-dim)`; extend the header
comment; NOTE `--kiosk-low` is a green — it MUST NOT be used); EDIT
`tests/unit/config/maternal-screen-display.test.ts` (totality + no-green lock extended over
the kiosk records — explicitly assert no value is `var(--kiosk-low)`); NEW
`src/components/dashboard/MaternalScreenCell.tsx` (small cell: tier chip + acuity chip +
optional incomplete dot + `formatRelativeAge(assessedAt,'short')` age, props
`{ tier, acuity, isComplete, assessedAt, variant }`, all nullable — renders NOTHING when both
tier and acuity are null; `data-testid="maternal-screen-cell"`, chips `data-tier`/`data-acuity`;
`title` tooltip Thai: `การคัดกรองท้องถิ่น (โหมดเงา — ยังไม่ได้รับการรับรอง)`); EDIT
`src/components/dashboard/HighRiskPatientList.tsx` (render `MaternalScreenCell` beside
`PartographCell` in both light and kiosk row layouts, passing `variant`); NEW/EDIT tests
`tests/unit/components/MaternalScreenCell.test.tsx` + extend
`tests/unit/components/HighRiskPatientList.test.tsx`: cell renders chips for a severe fixture;
renders nothing when both axes null (flag-off rows); kiosk variant uses `--kiosk-*` colors and
NEVER `--kiosk-low`; incomplete dot when `isComplete === false`; existing list assertions
unchanged.

## Task W3: End-to-end exit gate (spec §11 Phase 5)

**Files:** NEW `tests/integration/maternal-screening-ward-roundtrip.test.ts` modeled on
`tests/integration/partograph-webhook-to-api-roundtrip.test.ts` + the route-driving pattern of
`tests/unit/api/browser-push-maternal-screening.test.ts` (vi.mock `@/db/connection`,
`@/lib/auth`, `@/lib/ensure-init` BEFORE route imports; `ENCRYPTION_KEY` set before imports).
Chain to prove, with `vi.stubEnv` INGEST=true and EVENTS=true (BOTH — they gate different
halves; also a variant with EVENTS unset proving no broadcast):
1. POST the real `/api/sync/browser-push` handler with a labor patient carrying a severe-APH
   `maternal_screening` payload;
2. assert `maternal_screening_assessments` row AND `cached_patients.maternal_screen_local_tier
   = 'LOCAL_SEVERE'` / `maternal_screen_emergency_acuity = 'EMERGENCY'` (direct SELECT);
3. call the real GET `/api/dashboard/high-risk` handler (imported after the same mocks; seed
   whatever session/hospital scoping it needs) and assert the patient row carries
   `maternalScreenLocalTier: 'LOCAL_SEVERE'` + `maternalScreenEmergencyAcuity: 'EMERGENCY'`;
4. assert `vi.spyOn(SseManager.getInstance(), 'broadcast')` captured a `patient-update`
   carrying `type: 'maternal_screen_state_changed'` with the projected values (the browser-push
   route uses the singleton — parameter injection does NOT work there);
5. flag-off display variant: with UI flag 'false', the high-risk response carries nulls.

## Phase-end gate
Full `npm test` + `tsc` + `lint` + `build` green; whole-phase review of W1–W3 before
declaring done. Ledger + memory updated. Deferred (recorded): bed-tile display on the
hospital ward page (cross-source join; pairs with Phase 6 HOSxP work), AlertBar kiosk
variant, SSE fan-out cost note for 200-concurrent-user budget when events flag turns on.
