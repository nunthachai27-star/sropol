# System Robustness Improvement Plan — 2026-07-13

## Purpose

This document turns the 2026-07-13 repository review into an actionable remediation plan for `kk-lrms`.

The target outcome is a system that:

- fails closed for destructive and privileged operations;
- enforces hospital tenancy at every mutation boundary;
- preserves clinical-data invariants during failures and concurrent requests;
- reports operational degradation accurately;
- has automated tests that prove the security, rollback, and concurrency guarantees.

This is a planning document. It does not authorize production data changes or deployment by itself.

## Baseline Evidence

The review established the following baseline:

- `npm test`: 1,806 tests passed and 4 were skipped across 177 passing test files.
- `npx tsc --noEmit`: passed.
- `npm run lint`: failed with 12 errors and 4 warnings.
- Existing tests primarily cover successful and sequential behavior; adversarial tenant, CSRF, rollback, and concurrent-transition cases are missing.
- The working tree was clean before this plan was created.

## Guiding Principles

1. **Fail closed:** missing or ambiguous security configuration must deny access, not broaden it.
2. **Authenticate at the handler boundary:** middleware is defense in depth, not the only authorization control.
3. **Bind every mutation to server-derived identity:** never trust hospital IDs or actor IDs supplied by a client when they can be derived from the session or webhook key.
4. **Make clinical state changes atomic:** related writes either all commit or all roll back.
5. **Make illegal states difficult to represent:** enforce invariants in both application logic and database constraints where practical.
6. **Lock behavior with tests first:** add failing regression tests before changing each high-risk path.
7. **Deploy in reversible stages:** separate security containment from deeper state-machine and operational changes.

## Scope and Priority

### P0 — Stop-ship security containment

- Production-enabled destructive simulation routes.
- Cross-tenant referral updates through webhook credentials.
- Cross-hospital access through session-authenticated referral routes.
- Public disclosure of maternity data through CID lookup.
- CSRF exposure on custom mutation routes.
- Production admin allow-list failing open.

### P1 — Clinical correctness and transactional integrity

- Labor ingestion not transitioning journeys to `LABOR`.
- ANC item-derived risk being understated by a declared or missing risk level.
- Partial deletion of labor-patient clinical data.
- Non-atomic pregnancy rollover.
- Race-prone partograph upserts and referral/video-call state transitions.

### P2 — Operational resilience and quality gates

- Redis being disabled permanently after one transient connection error.
- Health reporting success with no usable integrations.
- Transport errors being mislabeled as timeouts.
- Failed database detection persisting a guessed dialect.
- Encryption configuration not being validated at startup.
- Database singleton cold-start race.
- Current lint failures and noisy React test warnings.

## Immediate Containment Gate — Before Phase 0

The confirmed production data-wipe exposure must not remain open while the broader regression suite is being built.

Before any other work:

1. Change the production Compose default to `DEV_SIMULATION_ENABLED=false`.
2. Make the production simulation guard fail closed, independent of UI visibility or middleware routing.
3. Add one focused production-default test proving that each simulation route is unavailable.
4. Deploy this containment as a narrow emergency change after focused review and verification.

This containment does not replace the complete authorization, CSRF, audit, and transactional work in Phase 1.

**Stop condition:** do not begin routine feature deployment while the production-default simulation test is failing or the deployed configuration still exposes these routes.

## Phase 0 — Establish Regression Guardrails

### Objective

Except for the emergency containment gate above, capture the current contracts and reproduce each defect with a regression test before changing its implementation.

### Work

1. Add a security-boundary test matrix covering:
   - unauthenticated, readonly, read-write, and admin sessions;
   - same-hospital and cross-hospital operations;
   - valid and invalid webhook hospital ownership;
   - same-origin and foreign-origin mutation requests;
   - production and non-production simulation settings.
2. Add transaction rollback tests that inject a failure between related writes.
3. Add deterministic concurrency tests using coordinated promises/barriers rather than timing-only sleeps.
4. Record the intended behavior of `/api/referrals/check` before changing its response contract.
5. Run transaction, rollback, uniqueness, migration, and race tests against a real transaction-capable database. At minimum, the production PostgreSQL path must pass; use PGlite where the repository already relies on it for fast PostgreSQL-compatible integration coverage.
6. Capture red/green evidence locally: first prove that each new regression test reproduces the defect, then apply the fix and require the same test to pass.

### Suggested test locations

- `tests/integration/webhook-security-boundary.test.ts`
- `tests/integration/webhook-anc-referral.test.ts`
- `tests/unit/services/referral.test.ts`
- `tests/unit/services/video-call.test.ts`
- `tests/unit/services/sync-journey.test.ts`
- `tests/unit/services/webhook-anc-risk.test.ts`
- `tests/unit/services/sync-partograph-upsert.test.ts`
- New focused tests for simulation route authorization and CSRF enforcement.

### Acceptance criteria

- Each P0/P1 defect has recorded red/green evidence: the regression test reproduces the defect before its fix and passes afterward.
- No deliberately failing regression test is committed or merged into the protected branch.
- Tests assert database state and side effects, not only HTTP status codes.
- Cross-tenant negative tests prove that no row was created, updated, or deleted.
- Rollback tests prove that all pre-operation data remains intact after an injected failure.
- Concurrency tests prove that exactly one conflicting transition succeeds.
- Database invariants pass against the production PostgreSQL driver, not only mocked adapters.

## Phase 1 — Close Destructive and Privileged Access Paths

### 1.1 Disable production simulation by default

**Primary files**

- `docker-compose.yml:44-56`
- `src/lib/feature-flags.ts:5-22`
- `src/app/api/dev/simulate/_guard.ts:1-10`
- `src/app/api/dev/simulate/clear/route.ts:35-81`
- `src/app/api/dev/simulate/reset-onboarding/route.ts:49-88`
- `src/middleware.ts:35-45`
- `src/lib/admin-guard.ts:34-59`

**Plan**

1. Change the Compose default to `DEV_SIMULATION_ENABLED=false`.
2. Make production simulation fail closed even if the flag is accidentally set. Do not provide an ordinary environment-variable override that can enable destructive simulation in production.
3. Require handler-level admin authorization and reject readonly sessions.
4. Wrap each destructive wipe in one database transaction.
5. Record an audit event containing actor identity, request ID, environment, and affected-row counts without logging PHI.
6. Keep middleware restrictions as an additional layer, not the primary authorization decision.

**Acceptance criteria**

- Production requests return `404` or an equivalent non-disclosing denial when simulation is unavailable.
- Non-admin and readonly sessions cannot invoke simulation routes in any environment.
- A failed wipe rolls back every table mutation.
- Default Compose startup never exposes simulation routes.
- Route tests cover production defaults, explicit development enablement, readonly denial, non-admin denial, and rollback.

### 1.2 Add CSRF protection to custom mutation routes

**Primary files**

- `src/lib/auth.config.ts:17-33`
- `src/app/api/dev/simulate/reset-onboarding/route.ts:49-88`
- `src/app/api/referrals/route.ts:9-40`
- Other custom `POST`, `PUT`, `PATCH`, and `DELETE` handlers using cookie authentication.

**Plan**

1. Inventory all cookie-authenticated mutation routes.
2. Reuse an existing request-security utility if one exists; otherwise add one small shared guard.
3. Validate `Origin` against the configured application origin and reject foreign origins.
4. Validate fetch metadata such as `Sec-Fetch-Site` where available.
5. Require the expected content type for JSON mutation routes.
6. Preserve webhook routes as token-authenticated machine endpoints; do not require browser CSRF tokens there.
7. Maintain an enumerated manifest of every cookie-authenticated `POST`, `PUT`, `PATCH`, and `DELETE` route, and add a repository-level test that fails when a newly added mutation route lacks an explicit CSRF policy.

**Acceptance criteria**

- Foreign-origin mutation requests are rejected before any database access.
- Missing or invalid content type is rejected for JSON-only handlers.
- Same-origin requests and authenticated webhook traffic continue to work.
- Tests prove that CORS response behavior is not relied on to prevent side effects.
- The mutation-route manifest accounts for every cookie-authenticated mutation handler, and CI detects newly added unguarded routes.

### 1.3 Make production admin access fail closed

**Primary files**

- `docker-compose.yml:56`
- `src/lib/admin-access.ts:35-56`
- `src/lib/auth-utils.ts:5-13`
- `tests/unit/lib/admin-access.test.ts`

**Plan**

1. Treat a missing or empty `ADMIN_ALLOWED_CIDS` as no CID-authorized administrators in production, or fail startup with a clear configuration error.
2. Stop granting admin solely from a broad substring match such as `director` or `ผู้อำนวยการ`.
3. Define the accepted role/position mapping explicitly and test subordinate or assistant-director titles.
4. Log denied admin-access decisions without logging the complete CID.

**Acceptance criteria**

- Empty production allow-list cannot grant admin access.
- Broad or subordinate position titles do not accidentally become admin.
- Authorized administrators retain access when both role and allow-list requirements are satisfied.

## Phase 2 — Enforce Hospital Tenancy and Referral Authorization

### 2.1 Bind webhook referral updates to the authenticated hospital

**Primary files**

- `src/app/api/webhooks/patient-data/route.ts:30-65`
- `src/app/api/webhooks/patient-data/route.ts:121-132`
- `src/services/webhook.ts:1535-1635`

**Plan**

1. Rename `_hospitalId` to `authenticatedHospitalId` and require it in every referral lookup.
2. For destination-side transitions, require `authenticatedHospitalId === cached_referrals.to_hospital_id`.
3. For source-side actions, define and enforce the exact permitted actions for `from_hospital_id`.
4. Require and validate an enumerated status/action; reject unknown strings before service invocation.
5. Return `403` for ownership violations without disclosing whether an unrelated referral exists.
6. Emit SSE events only after the database mutation commits successfully.

**Acceptance criteria**

- An authenticated hospital cannot access, mutate, or infer a referral when it is neither an authorized source nor destination.
- Source and destination hospitals can perform only their documented transitions.
- Tests enumerate the exact source-side and destination-side actions and reject every action not assigned to that side.
- Unknown actions/statuses return `400` and produce no mutation or broadcast.
- Every action has same-tenant success and cross-tenant denial tests.

### 2.2 Bind session referral APIs to the session hospital

**Primary files**

- `src/app/api/referrals/route.ts`
- `src/app/api/referrals/[id]/accept/route.ts`
- `src/app/api/referrals/[id]/reject/route.ts`
- `src/app/api/referrals/[id]/transit/route.ts`
- `src/app/api/referrals/[id]/arrive/route.ts`
- `src/services/referral.ts:18-121`

**Plan**

1. Perform authorization in each route handler or a shared referral authorization boundary.
2. Derive hospital and actor identity from the authenticated session.
3. Ignore or reject client-supplied `initiatedBy`, `acceptedBy`, and equivalent actor fields.
4. Verify that the journey belongs to the source hospital before referral creation.
5. Define a transition authorization table, for example:
   - source hospital: create and mark in transit;
   - destination hospital: accept, reject, and mark arrived;
   - administrators: only explicitly documented override actions.
6. Prevent arbitrary hospital-scoped listing through untrusted query parameters.

**Acceptance criteria**

- Cross-hospital mutation attempts return `403` with no state change.
- Audit actor fields always match the authenticated session.
- Listing endpoints return only hospitals permitted by the session.
- Route and service tests cover each role/transition combination.

### 2.3 Remove the public PHI oracle

**Primary files**

- `src/middleware.ts:24-33`
- `src/app/api/referrals/check/route.ts:35-155`

**Recommended decision**

Require authentication and return the minimum data required for referral duplicate detection. Do not return detailed pregnancy or labor information from a public CID lookup.

**Plan**

1. Remove `/api/referrals/check` from public-route matching.
2. Authorize the requesting hospital and document its valid use case.
3. Minimize the response to a boolean or a small non-identifying referral eligibility result.
4. Validate CID format and checksum.
5. Add per-user and per-hospital rate limits with security telemetry.
6. Avoid exposing hospital history, admission numbers, dates, ANC risk, gravida, or labor status unless a separately authorized workflow requires them.

**Acceptance criteria**

- Unauthenticated requests receive `401` or a non-identifying response.
- Authorized requests receive only the fields documented for the workflow.
- Repeated invalid CID probes are rate-limited and observable.
- Tests assert that removed PHI fields cannot reappear accidentally.

## Phase 3 — Repair Clinical-State Invariants

### 3.1 Transition maternal journeys to `LABOR` during ingestion

**Primary files**

- `src/services/sync/anc.ts:352-397`
- `src/services/sync/polling.ts:1014-1027`
- `src/services/webhook.ts:639-665`
- `tests/unit/services/sync-journey.test.ts`

**Plan**

1. Route both polling and webhook labor ingestion through one journey-linking function.
2. Transition `PREGNANCY -> LABOR` in the same transaction that links `cached_patients.journey_id`.
3. Make repeated ingestion idempotent when the journey is already `LABOR` or later.
4. Reject or explicitly handle invalid backward transitions.

**Acceptance criteria**

- A labor admission always leaves the patient linked to a journey in `LABOR` unless the journey is already in a later valid stage.
- Polling and webhook paths produce identical state.
- Re-delivery does not create duplicate journeys or repeat transition side effects.

### 3.2 Make derived ANC risk authoritative

**Primary files**

- `src/services/webhook.ts:498-539`
- `src/services/webhook.ts:809-850`
- `src/services/webhook.ts:977-1067`
- `src/config/anc-classifying-canon.ts`
- `tests/unit/services/webhook-anc-risk.test.ts`

**Plan**

1. Validate `riskLevel`, `riskItemIds`, dates, and clinical field types at the webhook boundary.
2. Derive the canonical risk level from checked item IDs.
3. If a declared level is retained for compatibility, store it separately and never allow it to lower the canonical derived severity.
4. Update `maternal_journeys.anc_risk_level` from the canonical result in the same transaction as the screening row.
5. Log inconsistent payloads with non-PHI identifiers for upstream correction.

**Acceptance criteria**

- HR3-triggering items can never produce an HR2 or `LOW` canonical journey risk.
- Journey risk and latest screening risk remain consistent after every accepted payload.
- Missing declared risk with valid items still derives the correct level.
- Invalid item IDs or risk strings receive a deterministic validation response.

### 3.3 Make patient deletion and pregnancy rollover atomic

**Primary files**

- `src/services/webhook.ts:577-593`
- `src/db/tables/cached-partograph-observations.ts:9-14`
- `src/services/sync/anc.ts:116-142`
- `src/services/webhook.ts:1005-1034`
- `src/db/tables/maternal-journeys.ts:97-105`
- `src/db/schema-sync.ts`
- `src/db/migrations/*`
- Migration integration tests using the production PostgreSQL semantics.

**Plan**

1. Wrap labor-patient deletion and all dependent clinical deletions in one transaction.
2. Prefer explicit deletion ordering when auditability is required; otherwise add carefully reviewed `ON DELETE CASCADE` rules for true ownership relationships.
3. Include partograph observations and every patient-owned table in the deletion contract.
4. Wrap old-journey closure and new-journey creation in one transaction.
5. Add the intended partial unique constraint preventing multiple active journeys for the same hospital/patient pregnancy identity.
6. Add a migration preflight that detects existing duplicates before applying the constraint.

**Acceptance criteria**

- Any failure during deletion leaves all prior clinical data intact.
- Successful deletion leaves no forbidden dependent rows.
- Pregnancy rollover cannot leave zero active journeys due to a mid-operation failure.
- Concurrent rollover requests cannot create duplicate active journeys.
- Migration fails safely and reports existing duplicates without silently deleting data.
- Constraint and rollback guarantees pass against PostgreSQL/PGlite integration tests, not only unit adapters.

### 3.4 Correct remaining clinical edge cases

**Work**

1. Replace partograph select-then-insert logic with a database-native atomic upsert on `(hospital_id, source_system, source_pk)`.
2. Wrap multi-observation webhook batches in a transaction or define explicit per-item partial-success semantics.
3. Deduplicate unchanged ANC polling risk snapshots using the same canonical comparison used by webhook ingestion.
4. Cap expected cervix dilation at 10 cm and add full-dilation regression tests.

**Acceptance criteria**

- Concurrent delivery of one external observation produces one stored row without unique-key errors.
- Repeated unchanged ANC polling does not increase screening-row count.
- A patient at 10 cm is never flagged for being behind an impossible expectation above 10 cm.

## Phase 4 — Make State Machines Concurrency-Safe

### 4.1 Referral transitions

**Primary file:** `src/services/referral.ts:47-121`

1. Replace separate read/check/update sequences with conditional transitions that include the expected prior status.
2. Return a conflict when no row matched the expected status.
3. Keep the transition and audit/event write in one transaction.
4. Broadcast only after commit.

### 4.2 Video-call lifecycle

**Primary files**

- `src/services/video-call.ts:117-170`
- `src/services/video-call.ts:208-240`
- `src/services/video-call.ts:521-541`
- `src/db/tables/video-call-participants.ts`
- `src/db/schema-sync.ts`
- `src/db/migrations/*`
- Migration and concurrency integration tests using PostgreSQL semantics.

1. Make call creation, creator participation, and initial invitations one transaction.
2. Enforce uniqueness for `(call_id, user_id)`.
3. Introduce a database-enforced or transactionally locked invariant preventing one user from joining/ringing in conflicting active calls.
4. Make accept, decline, timeout, leave, and end operations conditional on their expected states.
5. Ensure the database transition wins before clearing timers or emitting SSE events.
6. Make duplicate requests idempotent where safe and return `409` for genuinely conflicting transitions.

### Acceptance criteria

- Concurrent accept/timeout produces exactly one valid terminal participant state.
- Concurrent accept/reject produces one successful referral transition and one conflict.
- Two simultaneous call creations cannot place a user into two active calls.
- No failed transaction leaves an active call without its creator participant.
- SSE event order reflects committed database state.

## Phase 5 — Operational Resilience

### 5.1 Recover Redis after transient failures

**Primary files**

- `src/lib/cache.ts:42-94`
- `src/lib/cache.ts:156-160`
- `src/services/health.ts`

**Plan**

1. Replace permanent disablement with bounded exponential backoff and jitter.
2. Ensure only one reconnect attempt runs at a time.
3. Report `memory` fallback as degraded when Redis is configured but unavailable.
4. Add metrics/logs for disconnect, fallback, retry, recovery, and time spent degraded.
5. Document which cached state is safe to keep process-local and which requires shared storage.

**Acceptance criteria**

- Redis automatically recovers without process restart after a simulated outage.
- Multi-process shared-state features do not silently claim full availability while using local memory.
- Retry behavior is bounded and does not create a connection storm.

### 5.2 Separate liveness, readiness, and integration health

**Primary files**

- `src/services/health.ts:20-57`
- `src/app/api/health/route.ts`
- `Dockerfile`
- `docker-compose.yml`

**Plan**

1. Keep liveness limited to whether the process can serve requests.
2. Make readiness depend on required database access, schema initialization, encryption configuration, and any required shared infrastructure.
3. Report hospital connectivity separately, including `UNKNOWN`, freshness, and grace-period semantics.
4. Include Redis state when Redis is configured.
5. Add a Compose application healthcheck using the readiness endpoint.

**Acceptance criteria**

- A process can be live but not ready.
- Readiness fails when required dependencies or startup validation fail.
- All hospitals being stale or unknown cannot be presented as fully healthy without an explicit grace-state explanation.
- Compose waits for application readiness where downstream services depend on it.

### 5.3 Validate configuration and preserve error meaning

**Primary files**

- `src/lib/encryption.ts:42-50`
- `src/app/api/startup.ts:20-92`
- `src/lib/bms-session.ts:97-145`
- `src/app/api/onboarding/hosxp-sync/route.ts:41-63`

**Plan**

1. Validate `ENCRYPTION_KEY` at startup with `^[0-9a-fA-F]{64}$` and confirm the decoded length is 32 bytes.
2. Refuse readiness when encryption configuration is invalid.
3. Distinguish abort timeout, DNS, connection refusal, TLS, HTTP, parsing, and upstream application errors.
4. Do not persist MySQL when database detection fails; require an explicit user choice or successful probe.
5. Return actionable but non-sensitive error codes to clients.

**Acceptance criteria**

- Invalid encryption configuration prevents readiness before any clinical ingest begins.
- DNS and malformed-response failures are not reported as timeouts.
- Failed detection never persists a guessed database dialect.
- Tests cover every error classification and configuration failure.

### 5.4 Serialize database singleton initialization

**Primary file:** `src/db/connection.ts`

1. Store an initialization promise in addition to the resolved adapter.
2. Make concurrent callers await the same promise.
3. Clear the promise after a failed initialization so a later call can retry safely.
4. Close any partially created adapter/pool on failure.

**Acceptance criteria**

- Concurrent cold-start calls create exactly one database adapter/pool.
- A failed first initialization can be retried.
- No extra pool remains open after initialization failure.

## Phase 6 — Restore Quality Gates

### Work

1. Fix all 12 current lint errors before making lint a required merge gate.
2. Prioritize render/effect correctness in:
   - `src/components/maternity/shared/AnchoredDropdown.tsx`
   - `src/components/maternity/shared/DraggableChips.tsx`
   - `src/components/maternity/shared/LookupAutocomplete.tsx`
   - maternity medication and complications tabs reported by ESLint.
3. Remove React `act(...)` warnings in tests by awaiting state transitions and timers correctly.
4. Keep expensive end-to-end checks separate from the cheap default test suite, but require targeted E2E coverage for security boundaries and critical clinical workflows before release.

### Acceptance criteria

- `npm run lint` exits successfully with zero errors.
- `npx tsc --noEmit` exits successfully.
- `npm test` passes with no unexpected unhandled errors or material `act(...)` warnings.
- `npm run build` passes using production configuration.
- Targeted Playwright scenarios pass for login/authorization, referral lifecycle, and critical clinical ingest.

## Verification Matrix

| Area | Unit | Integration | Concurrency/rollback | E2E/operations |
|---|---|---|---|---|
| Simulation routes | Flag and guard behavior | Role and environment matrix | Transaction rollback | Production Compose route unavailable |
| Webhook referrals | Status validation | Same/cross-tenant key matrix | Conflicting transitions | Signed webhook flow |
| Session referrals | Authorization decisions | Hospital/role matrix | Accept vs reject | Full referral lifecycle |
| CID check | Response minimization | Auth and rate boundary | Rate-limit contention | Browser privacy contract |
| Labor journey | Transition rules | Polling/webhook parity | Re-delivery and concurrent ingest | Admission appears in correct dashboard stage |
| ANC risk | Canonical classification | Journey/screening consistency | Concurrent/repeated delivery | High-risk patient surfaced correctly |
| Clinical deletion | Dependency inventory | Successful deletion | Injected rollback | Administrative deletion workflow |
| Video call | State rules | API lifecycle | Accept/timeout/create races | Multi-browser call lifecycle |
| Redis | Retry state machine | Fallback/recovery | Single-flight reconnect | Container outage and recovery |
| Health/config | Status calculation | Dependency failures | Startup retry | Compose readiness behavior |

## Deployment and Rollback Strategy

### Release A — Security containment

- Set production simulation default to false.
- Add handler-level authorization and CSRF validation.
- Enforce webhook/session tenant boundaries.
- Remove the public CID PHI response.
- Make admin access fail closed.

**Stop condition:** do not proceed to production unless adversarial security tests pass and the production Compose configuration proves simulation routes unavailable.

### Release B — Clinical consistency

- Deploy labor-stage and canonical ANC risk fixes.
- Deploy transactional deletion and rollover.
- Apply database constraints only after duplicate-data preflight and backup verification.

**Clinical-data reconciliation contract required before deployment:**

1. Decide explicitly whether existing journey-stage and ANC-risk inconsistencies will be backfilled or whether corrections apply only to future ingestion.
2. Obtain clinical-owner approval for the canonical ANC classification and any historical correction rules.
3. Produce a read-only discrepancy report containing de-identified row identifiers, current value, derived value, hospital counts, and totals.
4. Define deployment thresholds for unexpected discrepancy volume; exceeding the threshold stops deployment for review.
5. If backfill is approved, run it as a separately reviewed, restartable, idempotent migration with dry-run output.
6. Capture pre/post row counts and stable checksums for unaffected columns, plus an exception report for every modified row.
7. Require clinical-owner and technical-owner sign-off on the reconciliation evidence before enabling the corrected production workflow.

**Rollback concern:** schema constraints and corrected risk/stage values may expose existing inconsistent records. Prepare a read-only audit report and a reviewed repair script before applying constraints. Do not silently rewrite historical clinical data.

### Release C — Concurrency and operations

- Deploy conditional referral/video-call transitions.
- Deploy Redis recovery, readiness checks, configuration validation, and database initialization locking.

**Stop condition:** run controlled Redis/database outage tests and verify automatic recovery plus accurate degraded health reporting.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Stricter authorization blocks an undocumented workflow | Capture current role/hospital workflows in integration tests and logs before enforcement; add only explicitly approved exceptions. |
| Public CID response is consumed by an external client | Inventory callers, introduce a versioned authenticated replacement, and monitor deprecated endpoint use before removal. |
| New database constraints fail on existing inconsistent rows | Run a read-only preflight, export affected IDs, review remediation, and take a verified backup before migration. |
| Transactions increase lock duration | Keep transaction scopes narrow, index lookup predicates, and add contention tests. |
| Conditional transitions change retry behavior | Define idempotent responses explicitly and return conflicts only for incompatible outcomes. |
| Redis retry creates connection storms | Use single-flight reconnect, exponential backoff, jitter, and maximum retry frequency. |
| Clinical risk correction changes dashboard counts | Validate against a de-identified production snapshot and obtain clinical-owner sign-off on canonical classification rules. |

## Additional Suggestions

1. Create one reusable authorization context containing session user, role, hospital, and readonly status, then pass it explicitly into sensitive services.
2. Document every state machine—maternal journey, referral, and video call—as an allowed-transition table shared by implementation and tests.
3. Add database-level invariants for uniqueness and ownership relationships that must remain true regardless of application code.
4. Introduce structured audit events for privileged actions, cross-hospital workflows, clinical state corrections, and failed authorization decisions.
5. Add request IDs to API, webhook, database, SSE, and audit logs so one workflow can be traced end to end.
6. Keep PHI out of logs, metrics, test snapshots, and error messages; use hashed or internal identifiers.
7. Add a release checklist requiring security-boundary tests, migration preflight, rollback evidence, and health/readiness verification.

## Definition of Done

The improvement program is complete only when:

- all P0 routes fail closed under production defaults;
- cross-hospital negative tests prove tenant isolation for every referral action;
- public unauthenticated callers cannot retrieve maternity details by CID;
- labor and ANC journey state matches canonical clinical inputs;
- multi-table clinical mutations pass rollback tests;
- concurrent state transitions preserve exactly one valid outcome;
- Redis recovers after a transient outage and reports degradation accurately;
- invalid production configuration prevents readiness;
- lint, typecheck, unit/integration tests, production build, and targeted E2E tests pass;
- deployment and rollback evidence is recorded for each release stage;
- no known Critical or High finding from the 2026-07-13 review remains open without an explicitly accepted risk owner and expiry date.

## Suggested Execution Order

1. Immediate containment gate: disable and hard-block production simulation routes.
2. Phase 0 regression guardrails with local red/green evidence.
3. Phase 1 complete destructive and privileged access containment.
4. Phase 2 tenant authorization and PHI minimization.
5. Phase 3 clinical-state and transactional integrity.
6. Phase 4 concurrency-safe state machines.
7. Phase 5 operational resilience.
8. Phase 6 quality-gate cleanup.
9. Release verification and documented risk acceptance for any deferred item.
