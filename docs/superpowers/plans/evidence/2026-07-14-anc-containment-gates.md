# WHO ANC Immediate Safety Containment — Acceptance Gate Evidence

**Date:** 2026-07-14
**Spec:** `docs/who-guideline-2026-07-14.md` §8 "Immediate Safety Containment" acceptance gate
**Plan:** `docs/superpowers/plans/2026-07-14-who-anc-containment.md`
**Commit range:** `fe494e7` (base) → `e7932cb` (T6), 6 implementation commits, each task-reviewed (spec + quality) and approved.
**Verification run:** full Vitest suite **1971 passed / 4 skipped** (baseline was 1920/4; +51 new tests), `npx tsc --noEmit` clean, `npm run lint` clean, `npm run build` production build OK.

| # | Spec acceptance-gate bullet | Verdict | Evidence |
|---|---|---|---|
| 1 | `sev*(null)` tests expect unknown | ✅ | `tests/unit/services/anc-clinical.test.ts` — sevBp/sevFhr/sevHb null → `'unknown'` (T1, commit `f8d2e00`); new `sevUrineProtein`/`sevFetalMovement` null → `'unknown'` |
| 2 | Partial BP cannot be normal | ✅ | `sevBp(120, null) → 'unknown'`, `sevBp(200, null) → 'abnormal'` (known finding preserved, spec invariant 3) — `src/services/anc-clinical.ts:26-36` + full 9-case test table |
| 3 | No missing field or schedule state renders green or complete | ✅ | Visit with all-null clinical fields renders amber `ไม่ได้บันทึกครบ` badge, never green OK (`tests/unit/pages/journey-detail.test.tsx`, T1); unknown GA renders `ไม่ทราบอายุครรภ์ — ประเมินตารางนัดไม่ได้` in amber, never `ครบ 8 contact` (T2, commit `9d1e605`); `nextContactDue` returns discriminated `UNKNOWN_GA \| COMPLETE \| NEXT` (`src/services/anc-clinical.ts:88-104`); GaProgressBar suppresses missed-dots/due-marker under unknown GA; 1ST CONTACT tile neutral on null |
| 4 | No synthetic normal value reaches storage or risk evaluation | ✅ | Imputation block deleted from `src/services/sync/anc.ts` (T3, commit `9ea85ad`); `AncRiskInput` vitals nullable; null → rule not triggered (incl. latent `null<145`-coerces-to-`0<145` bug fixed); `cached_anc_risks.risk_factors` now records `{missingRequired, assessmentIncomplete}`; test asserts risk_factors contains ONLY those keys and no fabricated vitals anywhere |
| 5 | Hospital B payload cannot reduce, overwrite, or reattribute hospital A's visit rows; unrepresentable legacy conflict is explicit and observable | ✅ | Webhook delete scoped `journey_id AND hospital_id` (T5, commit `2dc3071`); same-day cross-hospital conflict SKIPPED + counted (`visitConflicts`) + logged `anc_cross_hospital_visit_conflict` (no PHI, no visit date); replace+roll-up in one transaction (failingDb rollback proof); roll-up = DB aggregate COUNT/MAX over all surviving provincial rows; polling path refuses hospital reassignment. Integration tests: A/B coexistence, B-resend isolation, conflict skip with partial payload success |
| 6 | Existing clinical thresholds remain unchanged | ✅ | `diff` of exported constants in `src/services/anc-clinical.ts` base-vs-HEAD: IDENTICAL. Numeric-comparison histogram of `src/config/anc-risk-rules.ts` base-vs-HEAD: identical except one additional `< 145` occurrence inside an explanatory code comment (line 9); the `hr1_height` rule threshold itself unchanged. `WHO_CONTACT_WEEKS = [12,20,26,30,34,36,38,40]` and ±1 window unchanged |

## Additional containment items delivered

- **No downgrade on missing evidence (LIVE path, T4, commit `f5c1bf9`):** empty `riskItemIds` (`[]`) or legacy declared-only payloads can no longer lower a known journey risk (the production HR3→LOW wipe on transient empty HOSxP query results is blocked); non-empty-items reclassification (positive evidence) unchanged; blocked downgrades append no screening row (reconciliation report stays clean); SSE carries the persisted level; `downgradesBlocked` counter surfaced.
- **Polling-path no-downgrade on incomplete assessment (T3):** derived-lower levels are rejected while any mandatory input is missing; `anc_risk_downgrade_blocked` logged.
- **Observability (T6, commit `e7932cb`):** `downgradesBlocked`/`visitConflicts` in both webhook route responses + browser-push sync-step details + `anc_ingest_anomalies` warn; journey detail API exposes `ancAssessment` completeness; incomplete assessments render an amber `การประเมินความเสี่ยงไม่สมบูรณ์ (ขาดข้อมูล n รายการ)` marker beside the risk chip — an incomplete LOW never displays as a bare confirmed-LOW. **Scope caveat (final-review finding):** the completeness metadata that drives this marker is written only by the vitals-based polling path (`syncAncData`), which is production-dormant; production journeys ingested via browser-push/webhook carry items-based evidence and render no marker today. On the live path, the protection against false-confirmed-LOW is the T4 missing-evidence downgrade guard, not this marker; marker coverage for the live path arrives with the Phase 1+ v2 assessment model.
- **PHI-safe logging (T6):** `hn`, `patient_name`, `patientname`, `firstname`, `lastname` added to logger redaction keys with negative tests; pre-existing PHI-bearing log sites (`hn:` context keys) now redact.

## Explicitly out of containment scope (per spec §8, deferred to later phases)

- One-encounter-satisfies-two-adjacent-contact-targets window overlap (Phase 4, needs approved windows) — noted in code comment.
- `visits[].date` boundary validation (Phase 2 `NormalizedAncBundleV2` validation; malformed date now aborts the visit transaction cleanly instead of committing a destructive delete).
- Province list-page completeness markers (Phase 6 UI work; detail page covered).
- Clinical approval items: mandatory risk-input set, contact windows, task SLAs (Phase 0 sign-offs — `MANDATORY_ANC_RISK_INPUTS` documented as interim engineering set).

## Deploy status

**NOT deployed.** Production deploy remains operator-gated per the spec's runbook (§11): backup + preflight + feature-flag review + pilot allowlist are operator decisions.
