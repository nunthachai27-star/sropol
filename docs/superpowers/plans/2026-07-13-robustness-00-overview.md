# System Robustness Remediation — Program Overview

> **For agentic workers:** This is the umbrella document for the 2026-07-13 robustness program
> (spec: `docs/imorovement-2026-07-13.md`). Execute the three release plans **in order**:
>
> 1. `2026-07-13-robustness-a-security-containment.md` — Release A (P0 security, STOP-SHIP items)
> 2. `2026-07-13-robustness-b-clinical-integrity.md` — Release B (P1 clinical correctness)
> 3. `2026-07-13-robustness-c-concurrency-ops-quality.md` — Release C (P1/P2 concurrency, ops, quality gates)
>
> Each plan is independently executable with superpowers:subagent-driven-development or
> superpowers:executing-plans. Do not start Release B before Release A's verification task passes.

**Goal:** Make kk-lrms fail closed for destructive/privileged operations, enforce hospital tenancy at every mutation boundary, preserve clinical-data invariants under failure and concurrency, report degradation honestly, and prove all of it with automated tests.

**Architecture:** Fixes reuse existing infrastructure only (constitution + project memory: no new services). Authorization = shared Edge-safe predicates + Node handler guards (the `isAdminAuthorized`/`requireAdmin` pattern). Atomicity = the already-implemented but never-used `DatabaseAdapter.transaction()`. Concurrency = conditional `UPDATE … WHERE … RETURNING` compare-and-set. Tests = PGlite harness (`createTestDb`/`createPgliteDb`) which runs real PostgreSQL semantics.

**Tech Stack:** Next.js 15 App Router, NextAuth v5 (JWT), PostgreSQL 16 / PGlite, Vitest 4, Playwright 1.58, Redis 5 client, Docker Compose.

## How the spec's Phase 0 is satisfied

The spec's Phase 0 ("regression guardrails, red/green evidence") is not a separate plan. Every task below follows strict TDD: **each task's first steps write the failing regression test that reproduces the defect, run it to capture the red evidence, then fix, then re-run green.** The spec's security-boundary matrix maps to tasks as follows:

| Phase 0 matrix row | Covered by |
|---|---|
| unauthenticated / readonly / readwrite / admin sessions | A2 (simulate routes), A4 (admin predicate), A6 (referral routes) |
| same-hospital vs cross-hospital operations | A6 (session referrals), A7 (webhook referrals) |
| valid vs invalid webhook hospital ownership | A7 |
| same-origin vs foreign-origin mutations | A5 |
| production vs non-production simulation settings | A1, A2 |
| transaction rollback with injected failure | A3, B3 (shared `FailingAdapter` helper, built in A3) |
| deterministic concurrency (no timing sleeps) | B4, C1, C2 (`Promise.allSettled` + conditional-UPDATE winner/loser assertions) |
| `/api/referrals/check` intended behavior recorded | A8 preamble (sole real consumer: HOSxP Pascal client, uses only `canRefer` + `reason`, already sends Bearer key, fails open) |
| real transaction-capable DB | All DB tests run on PGlite = real PostgreSQL dialect (SQLite removed 2026-07-10) |

**Red/green evidence rule:** when a step says "Expected: FAIL", capture the failing output in the task's commit message body or PR notes before fixing. Never commit a deliberately failing test to main — red and green land in the same commit.

## Release gates (from spec "Deployment and Rollback Strategy")

**Release A stop condition:** do not deploy anything else while task A9's production probes show a simulation route reachable or `/api/referrals/check` returning PHI. Task A1 is the emergency containment change — it may be reviewed and deployed alone, ahead of A2–A8.

**Release B gate — clinical-data reconciliation contract:** before deploying Release B, run the read-only discrepancy report (task B5) and obtain clinical-owner sign-off on:
1. canonical ANC classification (max of declared vs item-derived severity);
2. whether historical journey-stage / risk inconsistencies are backfilled or future-only (default in this plan: **future-only**; no historical rewrite);
3. the duplicate-active-journey report (the unique-index migration **fails safe**: it reports duplicates and skips index creation rather than rewriting rows).

**Release C stop condition:** controlled Redis outage test (stop/start the redis container) shows automatic recovery and degraded health reporting before sign-off.

**Rollback:** each release deploys with the repo's existing pattern — tag the previous image `rollback-YYYY-MM-DD-N` before `npm run deploy`; rollback = retag + `docker compose up -d`.

## Decision points requiring an explicit owner call

These have a default in the plans but deserve a deliberate decision (they change behavior for external parties or clinical data):

1. **Webhook `referral_update` delete authorization** (A7): default = either party (source or destination) may delete; third parties never. Alternative: source-only.
2. **Partogram rule 14 (labour arrest) firing on two consecutive 10 cm observations** (B4): out of the review's scope; plan adds a *documenting* test and leaves behavior unchanged pending clinical-owner review.
3. **Historical backfill of journey stage / ANC risk** (B5/B6): default future-only. Backfill, if approved, is a separately reviewed idempotent migration — not in these plans.
4. **`ADMIN_ALLOWED_CIDS` empty in production** (A4): default = deny all admin (fail closed) rather than fail startup. Compose keeps `${ADMIN_ALLOWED_CIDS:-}`; `.env` already sets 3 CIDs.

## Corrections to the review doc (established by 2026-07-13 recon)

The plans are written against verified code, not the review's claims. Key corrections an implementer must know:

- `src/lib/sse-manager` does not exist — the SSE manager is `src/lib/sse.ts` (`class SseManager`).
- There is **no readonly/read-write role**. Role is `UserRole { OBSTETRICIAN, NURSE, ADMIN }`; read-only-ness is the orthogonal session field `accessMode: 'readwrite' | 'readonly'`.
- The referral routes named as "cookie-auth CSRF" perform **no handler auth at all** (middleware-only); `reset-onboarding` is gated only by the `DEV_SIMULATION_ENABLED` flag, which docker-compose defaults to `true` in production.
- `cached_partograph_observations` already has the unique index `uniq_cpo_source`; the defect is an unhandled unique-violation aborting a non-transactional batch, not duplicate rows.
- `linkJourneyToLabor` (the entire missing LABOR-transition behavior) already exists, is unit-tested, and has zero production callers.
- `DatabaseAdapter.transaction()` is implemented on both adapters and has zero call sites — services take `db: DatabaseAdapter` as their first parameter, so wrapping is mechanical. Nested transactions throw; inside a transaction use only `query`/`execute`; PGlite holds a global write mutex for the whole callback (never touch the outer adapter inside).
- `db.execute()` returns `void` — compare-and-set must use `db.query('UPDATE … RETURNING id')` and check row count.
- `getDatabase()` failed init IS retryable today; the real defect is the missing in-flight promise (duplicate adapters under concurrent cold start).
- The uniqueness index `uq_mj_hospital_hn_active` named in code comments **does not exist anywhere** — the comments describe a never-implemented safeguard.
- Production sync is **browser-only**: `src/services/sync/polling.ts` never runs in prod. Live ingestion paths are `browser-poll.ts → /api/sync/browser-push → processWebhookPayload/processAncWebhook` and the external webhook — both funnel through `src/services/webhook.ts`, which is therefore the mandatory fix site; polling.ts gets parity fixes only.
- Lint currently fails CI: 12 errors (all react-hooks v6: 6× `set-state-in-effect`, 6× `refs` from 2 lines in DraggableChips) + 4 warnings. Exact inventory is in plan C task C7.

## Known coverage limitations (documented, not silent)

- **Browser-level E2E for authenticated flows:** the spec asks for targeted Playwright coverage of login/authorization, referral lifecycle, and clinical ingest. This repo's Playwright suite deliberately skips authenticated flows (no test login mechanism — `DEV_AUTH_BYPASS` is not wired to Playwright and is inert in production). Coverage is provided instead by: direct-handler security tests (A2/A6/A7/A8), vitest cold-start E2E (`tests/e2e/webhook-api.test.ts` pattern), live-deployment curl probes (A9/C8), and the manual LABOR-dashboard observation in B6. Building a real Playwright auth harness is out of scope for this program and should be its own initiative.
- **End-to-end request-ID tracing** (spec "Additional Suggestions" #5) is implemented only for the destructive simulation routes (A3). Extending request IDs across API/webhook/SSE/audit logs is deferred — suggestion-tier, not part of the Definition of Done.

## Definition of done (program level)

All items from the spec's Definition of Done, mapped: P0 fail-closed (A1–A5, A9 probes) · tenant isolation proven by negative tests (A6, A7) · no public CID PHI (A8) · labor/ANC state canonical (B1, B2) · multi-table rollback proven (A3, B3) · concurrency single-winner proven (B4, C1, C2) · Redis recovery + honest degradation (C3, C4) · invalid config blocks readiness (C4) · lint/typecheck/tests/build/E2E green (C7, C8) · deployment + rollback evidence recorded per release (A9, B6, C8).
