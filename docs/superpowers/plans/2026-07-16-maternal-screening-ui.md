# Maternal Labor-Triage Screening — Phase 4 (Patient-Detail UI) — SDD Plan

**Source spec:** `docs/maternal-screen-plan.md` §10.2 (patient detail), §17.2 step 4 (read-only UI with shadow label).
**Prereq:** Phases 0–3 code-complete on this branch (engine/store/ingest/read-API all inert).
**Scope:** READ-ONLY display on the patient detail page, gated by `isMaternalScreenUiEnabled()`
(default **false**). Manual assessment entry (§9.4) is OUT OF SCOPE (Phase-0 open decision #12).
Ward tiles / alert propagation (Phase 5) and HOSxP mapping (Phase 6) are OUT OF SCOPE.

## Global Constraints (binding — reviewers receive verbatim)

**GC-U1 — Shadow label everywhere; nothing renders green.** Every surface carries a prominent
provisional banner: `การคัดกรองท้องถิ่น (ชุดกฎยังไม่ได้รับการรับรอง — โหมดเงา)` with the
`ruleSetVersion`. Because the rule set is `PROVISIONAL_UNAPPROVED`, NO state in this card may
render green/reassuring — not `STABLE`, not `NO_LOCAL_MATCH`. Confirmed-good coloring becomes
available only after Phase 0 sign-off (documented in the display config header). Unknown/
incomplete render neutral muted (`var(--ink-navy-muted)`) or amber — never green (GC1).

**GC-U2 — Four axes, visually distinct from existing systems.** `localTier`, `emergencyAcuity`,
`isComplete`, `suspectedConditions` are separate visual elements. NEVER reuse `RISK_LEVELS`
(CPD), the HR1–3 `riskMeta` map (ANC), `PartographCell`, or `cdss-presentation.ts` tokens
(GC3). Suspected conditions are labeled "ที่สงสัย" (suspected), never as diagnoses (GC4).

**GC-U3 — Flag gating is server-side.** The page is fully `'use client'`; `process.env` is
build-time-inlined there. The GET route adds a server-computed `uiEnabled:
isMaternalScreenUiEnabled()` field to `MaternalScreenAssessmentsResponse`; the page renders the
section ONLY when `uiEnabled === true`. Flag off ⇒ the page renders byte-identically to today.

**GC-U4 — Repo conventions (from scout, verified).**
- Display tokens: NEW `src/config/maternal-screen-display.ts` modeled on
  `src/config/anc-risk-display.ts` (CSS vars + Thai labels + explicit non-green fallback). Do
  NOT extend `risk-levels.ts` (CPD-specific) or copy `cdss-presentation.ts`'s location.
- Chip recipe: `AncRiskChip`/`FlagChip` family — bordered transparent mono chip, inline
  `style` from config, `data-*` attribute for tests.
- Hook: `src/hooks/useMaternalScreenings.ts` per `useHighRiskPatients` shape — `'use client'`,
  conditional-null SWR key `` patientId ? `/api/patients/${patientId}/maternal-screenings` : null ``,
  `refreshInterval: 30000`, no local fetcher, `?? null`/`?? []` unwraps, expose `mutate`.
  SEPARATE hook (like `usePartogram`) — do NOT add to the `usePatient` composite (blocks first paint).
- Card: extracted component `src/components/patient/MaternalScreeningCard.tsx` (constitution
  III), NOT an inline IIFE in the 976-line page.
- Incomplete marker: EXTRACT `IncompleteAssessmentMarker` from
  `src/app/(provincial)/pregnancies/[journeyId]/page.tsx:392-410` into
  `src/components/shared/IncompleteAssessmentMarker.tsx` (this is its second consumer —
  constitution III), re-import it in the journey page (its tests must stay green), and reuse
  in the card.
- Ages: `formatRelativeAge` from `src/lib/relative-time.ts` (the newer shared util).
- Section header: `SectionLabel` from `src/components/dashboard/shared.tsx` with a Thai title +
  English mono `right` annotation.
- Tests: vitest+RTL jsdom; mock hooks via `vi.mock('@/hooks/...')`; `vi.mock('@/hooks/useSSE')`
  in page tests; App-Router pages render as `<Page params={Promise.resolve({an})}/>` in
  Suspense inside `await act`; assert state via `data-*` attributes + exact Thai strings +
  `getByRole`; flag on/off = two-`it` pair with `queryBy* → toBeNull()` for off.

**GC-U5 — No new write paths, no clinical logic in UI.** The card renders what the API returns.
No re-computation of tiers/acuity client-side; no POST; no change to engine/store/fixture.
Quality gates per task: targeted tests GREEN, `npx tsc --noEmit` clean, eslint clean on touched
files. Full suite + build at phase end.

## Task U1: Display config + SWR hook + `uiEnabled` field

**Files:** NEW `src/config/maternal-screen-display.ts`; NEW `src/hooks/useMaternalScreenings.ts`;
EDIT `src/types/api.ts` (`uiEnabled: boolean` on `MaternalScreenAssessmentsResponse`); EDIT
`src/app/api/patients/[an]/maternal-screenings/route.ts` (populate it from
`isMaternalScreenUiEnabled()`); EDIT `tests/integration/maternal-screenings-api.test.ts`
(assert `uiEnabled` false by default, true when env set — save/restore process.env); NEW
`tests/unit/config/maternal-screen-display.test.ts`.

Config exports (Record types total over the enums, asserted by test):
- `MATERNAL_SCREEN_TIER_LABEL_TH` — e.g. LOCAL_MILD 'ระดับเฝ้าระวัง (ท้องถิ่น)', LOCAL_MODERATE
  'ระดับปานกลาง (ท้องถิ่น)', LOCAL_SEVERE 'ระดับรุนแรง (ท้องถิ่น)', NO_LOCAL_MATCH 'ไม่เข้าเกณฑ์ท้องถิ่น';
- `MATERNAL_SCREEN_TIER_COLOR` — SEVERE `var(--risk-high)`, MODERATE `#f97316` (orange, CDSS-ALERT
  hue precedent), MILD `var(--risk-medium)`, NO_LOCAL_MATCH `var(--ink-navy-muted)`;
- `EMERGENCY_ACUITY_LABEL_TH` — EMERGENCY 'ฉุกเฉิน', URGENT 'เร่งด่วน', STABLE 'คงที่ (โหมดเงา)',
  UNKNOWN 'ไม่ทราบ (ข้อมูลไม่พอ)';
- `EMERGENCY_ACUITY_COLOR` — EMERGENCY `var(--risk-high)`, URGENT `var(--risk-medium)`,
  STABLE `var(--ink-navy-muted)` (NOT green — GC-U1, header comment explains), UNKNOWN
  `var(--ink-navy-muted)`;
- `MATERNAL_SCREEN_FALLBACK_COLOR = 'var(--ink-navy-muted)'`;
- `SUSPECTED_CONDITION_LABEL_TH` — Thai labels for the 6 SuspectedMaternalCondition members,
  each prefixed appropriately as suspected (e.g. ABRUPTIO_PLACENTAE 'สงสัยรกลอกตัวก่อนกำหนด').
Config test: maps total over the union types; NO green value (`--risk-low`, `#22c55e`,
`green`) anywhere in this config (GC-U1 regression lock); fallback is the muted var.

## Task U2: MaternalScreeningCard component + shared IncompleteAssessmentMarker

**Files:** NEW `src/components/patient/MaternalScreeningCard.tsx`; NEW
`src/components/shared/IncompleteAssessmentMarker.tsx` (extracted per GC-U4, journey page
re-imports it — journey-page tests stay green); NEW
`tests/unit/components/MaternalScreeningCard.test.tsx`.

Card props: `{ data: MaternalScreenAssessmentsResponse | null; isLoading: boolean; error?: unknown; onRetry?: () => void }`.
Renders (per spec §10.2): shadow banner (GC-U1, `data-testid="maternal-screen-shadow-banner"`,
includes ruleSetVersion mono); latest assessment: localTier chip + emergencyAcuity chip (two
separate chips, `data-tier` / `data-acuity` attributes); `IncompleteAssessmentMarker` when
`!isComplete` (with missing-field count); suspected conditions as Thai "ที่สงสัย" chips; matched
rule IDs + evidence rows (mono, compact — evidence values shown verbatim, they are typed
clinical values); missing required fields list (field keys in mono are acceptable v1);
assessment age via `formatRelativeAge` + `assessedAt` absolute Thai date; `sourceSystem`;
supersession marker on corrected rows in history; history list (each row: age, tier chip,
acuity chip, incomplete dot) + note 'มีประวัติเพิ่มเติม' when `nextCursor` non-null.
States: `isLoading` → `.animate-pulse` skeleton; `error` → `ErrorState variant="banner"` with
`onRetry`; `latest === null && history empty` → compact Thai empty line 'ยังไม่มีข้อมูลการคัดกรอง'
(neutral, not green); never render partograph/CPD/ANC components (GC-U2).
Tests: all four states; GC-U1 lock — with a STABLE+NO_LOCAL_MATCH fixture, assert BOTH chips'
inline color is the muted var and no element uses `--risk-low`/`#22c55e`; shadow banner always
present when data renders; incomplete marker shown when `isComplete: false` even with
LOCAL_SEVERE (severe+incomplete coexist, GC1); suspected-condition Thai labels; history
supersession marker; exact-Thai assertions + `data-*` attributes per GC-U4.

## Task U3: Page integration + flag on/off page tests

**Files:** EDIT `src/app/(provincial)/patients/[an]/page.tsx` (new section: `SectionLabel` Thai
title 'การคัดกรองความเสี่ยงมารดา (รอคลอด)' right='MATERNAL SCREENING — SHADOW'; render
`<MaternalScreeningCard>` ONLY when `screenings?.uiEnabled === true`; wire
`useMaternalScreenings(patientId)`; add its `mutate` to the existing `useSSE` callbacks; add its
error to the non-blocking `failedFeeds` banner pattern — do NOT add to `usePatient`'s composite
`isLoading`); EDIT `tests/unit/pages/patient-detail.test.tsx` (mock `@/hooks/useMaternalScreenings`;
two-`it` flag pair: `uiEnabled:false` ⇒ `queryByTestId('maternal-screen-shadow-banner')` is null
AND existing assertions unchanged; `uiEnabled:true` with a severe fixture ⇒ section + banner +
tier chip render).
Constraint: with the flag off (default), the rendered page must be unchanged — the existing
patient-detail tests must pass WITHOUT modification to their assertions (only the new hook mock
added to setup).

## Phase-end gate
Full `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build` all green; whole-phase
review (U1–U3 diff) before declaring done.

---
**AMENDMENT 2026-07-16 (operator decision):** `MATERNAL_SCREEN_UI_ENABLED` default flipped to
**ON** after Phase 4 review approval — GC-U3's guarantee now reads: explicit `false` ⇒ page
byte-identical to pre-Phase-4. GC-U1 (shadow banner + no green) unchanged and still binding.
