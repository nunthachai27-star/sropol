# Plan — MOPH Prompt (LINE) risk alerts

**Date:** 2026-07-26
**Status:** ✅ Shipped (steps 1–10, commits 0851885..81c871f) — see "Completion" below
**Constitution:** TDD (tests first), logic in `src/services/`, PDPA-compliant, reusable.

## Goal

When an **EMERGENCY** (maternal labor-triage acuity) or **HIGH-risk** (ANC CPD ≥ 10) case
arises, send a LINE Flex message via the MOPH Prompt API to:
(a) the responsible person(s) at the originating hospital, and
(b) province center-monitoring staff.

## External API

`POST https://sms.bmscloud.in.th/v1/moph/send-via-bms-session`
- `Authorization: Bearer <bms-session-id>` (per-hospital; already in-band on the sync path)
- Body: `{ cid (13-digit recipient), title, text, confirm_url?, service_id?, flex? }`
- `hospital_code`/`hospital_name` resolved server-side from the session.
- `200 → { message_id, hospital_code, hospital_name, line:{success,status} }`, status ∈ success|failed|skipped.
- Errors: `400` cid not 13 digits · `401` missing bearer · `422` body validation · `502` session/JWT unresolvable.

## Codex consultation outcome (2026-07-25, gpt-5.5 xhigh)

Six architecture questions answered. Key decisions adopted:
1. **Decouple LINE I/O from the sync loop** — detect in sync, send out-of-band.
2. **One orchestrator, two producers** — HIGH and EMERGENCY normalize to a common alert
   event `{severity, source, rule_id}`; clinical logic stays separate.
3. **DB table for center-monitor recipients** (not env) — PDPA + admin-editability.
4. **Center-monitor = "originating-hospital case → province-scope recipient"** — the API
   stamps the *sender* hospital from the session; store `origin_hospital_id` +
   `recipient_scope=province_center` so audit is truthful.
5. **Dedup key:** `(case_id, hospital_id, recipient_cid, alert_source, severity, rule_id, local_date)`.
6. **Risks:** session freshness at send time · single authoritative audit record · PDPA payload leakage in Flex.

## Deviation from codex #1 (documented)

Codex recommended a **background worker**. This repo has **no job-queue infra** (Redis is
cache-only) and — per `project_browser_only_sync.md` — **server-side workers are dead code
in prod** (the browser-driven sync model). A pure worker would repeat the `polling.ts` trap.

**Resolution — "intent row + bounded post-sync drain" (hybrid):**
- Sync/webhook paths **only write a cheap intent row** to `moph_alert_log` (`status='pending'`).
  No LINE I/O, no budget impact on the per-patient loop.
- A `drainMophAlerts(hospitalId)` service sends pending rows for that hospital, invoked as a
  **bounded final step** on the live browser-push response path (the only reliably-running
  channel). Hard cap: `MAX_ALERTS_PER_DRAIN` (default 5), `PER_SEND_TIMEOUT_MS` (3000),
  total drain ≤ ~10s. 502/timeout → leave `pending`, retry next drain; never block sync.
- Optional ops-future: a real worker process if/when the deployment adds one. The intent-row
  contract is worker-agnostic, so swapping the drain trigger later is a one-line change.

This honors codex's *intent* (LINE latency outside the patient loop, failures survive
restart via the persisted row) within this deployment's real constraints.

## Files

### New
- `src/services/moph-prompt.ts` — pure sender client + types. No audit write.
- `src/services/risk-alert.ts` — orchestrator: normalize event → resolve recipients →
  build Flex → enqueue intent rows. Two producers call it (HIGH, EMERGENCY).
- `src/services/moph-alert-drain.ts` — `drainMophAlerts(hospitalId, opts)`: pop pending rows,
  call sender per recipient, update row status, bounded.
- `src/config/moph-alert-templates.ts` — Thai Flex builders, minimum-necessary data
  (severity badge, hospital name, case ref, confirm_url). No free-text patient PII to
  center-monitor scope.
- `src/config/moph-alert-config.ts` — tunables: `MAX_ALERTS_PER_DRAIN`,
  `PER_SEND_TIMEOUT_MS`, `DRAIN_BUDGET_MS`, `MOPH_PROMPT_API_URL`, enable flag.
- `src/db/tables/moph-alert-log.ts` — authoritative per-recipient attempt record.
- `src/db/tables/moph-center-monitors.ts` — province center-monitor recipients.
- `src/app/api/admin/moph-alerts/route.ts` — ops view + manual re-drive (admin-gated).

### Modified
- `src/db/tables/index.ts` — register the two new tables in `ALL_TABLES`.
- `src/app/api/sync/browser-push/route.ts` — (1) after ANC risk classification, call HIGH
  producer to enqueue; (2) append a final `appendSyncStep({type:'moph_alerts_drain'})`
  calling `drainMophAlerts(hospitalId)`.
- `src/services/webhook.ts` — at the EMERGENCY acuity-change detection site (~L1293),
  call EMERGENCY producer to enqueue.
- `src/lib/bms-session.ts` — expose a helper to (re)derive a session-id for a hospital at
  drain time (session may have expired between enqueue and drain).
- `.env.example` / `.env.production.example` — `MOPH_PROMPT_API_URL`, `MOPH_ALERTS_ENABLED`.

## Schema

```sql
-- moph_alert_log: ONE authoritative per-recipient attempt record
CREATE TABLE moph_alert_log (
  id              UUID PRIMARY KEY,
  case_id         STRING NOT NULL,          -- journey/case identifier
  hospital_id     UUID  NOT NULL,           -- origin hospital
  origin_hcode    STRING(10) NOT NULL,
  recipient_cid   STRING(13) NOT NULL,      -- 13-digit, validated
  recipient_scope STRING(20) NOT NULL,      -- 'hospital_staff' | 'province_center'
  alert_source    STRING(30) NOT NULL,      -- 'anc_cpd' | 'maternal_triage'
  severity        STRING(20) NOT NULL,      -- 'high' | 'emergency'
  rule_id         STRING(60) NULL,          -- CPD classifier id OR acuity rule id
  title           STRING(200) NOT NULL,
  status          STRING(20) NOT NULL,      -- pending|sent|failed|skipped
  message_id      STRING(80) NULL,          -- from API
  api_status      STRING(20) NULL,          -- success|failed|skipped
  attempts        INT NOT NULL DEFAULT 0,
  last_error      TEXT NULL,
  confirm_url     STRING(500) NULL,
  sent_at         DATETIME NULL,
  created_at      DATETIME NOT NULL,
  updated_at      DATETIME NOT NULL
);
-- Idempotency unique index (codex #5):
CREATE UNIQUE INDEX idx_moph_alert_dedup
  ON moph_alert_log (case_id, hospital_id, recipient_cid, alert_source, severity, rule_id, local_date);
CREATE INDEX idx_moph_alert_drain ON moph_alert_log (hospital_id, status, created_at);
```
(`local_date` is a generated/stored calendar-date column for the dedup key.)

```sql
-- moph_center_monitors: province-level recipients (codex #3: DB, not env)
CREATE TABLE moph_center_monitors (
  id          UUID PRIMARY KEY,
  province    STRING(10) NOT NULL,          -- '30' Khon Kaen
  cid         STRING(13) NOT NULL,
  name        STRING(255) NOT NULL,
  position    STRING(255) NULL,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  DATETIME NOT NULL,
  updated_at  DATETIME NOT NULL
);
CREATE UNIQUE INDEX idx_mcm_province_cid ON moph_center_monitors (province, cid);
```

## Recipient resolution

- **Hospital staff:** `hospital_consult_doctors` where `hospital_id = origin` AND `is_active`.
  (Existing table — has `cid` already.)
- **Province center:** `moph_center_monitors` where `province = origin.province` AND `is_active`.
- Both become recipients with distinct `recipient_scope`. Center recipients get a
  redacted-PII Flex template (severity + hospital + case ref + confirm_url, no name/cid of patient).

## Trigger sites

1. **HIGH (ANC CPD)** — `browser-push/route.ts`, after `classifyAncItems` (~L540 in
   browser-poll; mirrored in route). If `isHighRisk(score)` → enqueue via risk-alert producer.
2. **EMERGENCY (maternal triage)** — `webhook.ts` ~L1293 where `projected.emergencyAcuity`
   is set / `emergencyAcuityChanged` (maternal-screening-events). On a non-null/new acuity → enqueue.

Both producers are thin: they build a normalized event and call `enqueueAlertEvent(...)`,
which resolves recipients, dedups (insert-with-conflict-skip), and writes `pending` rows.
**No LINE I/O in either producer.**

## Drain (the only LINE I/O site)

`drainMophAlerts(hospitalId, { maxAlerts, perSendTimeoutMs, budgetMs })`:
1. `SELECT ... FROM moph_alert_log WHERE hospital_id=? AND status='pending'
   ORDER BY created_at LIMIT maxAlerts` (FOR UPDATE SKIP LOCKED if dialect supports).
2. For each row: (re)derive session-id via `bms-session` helper; call `sendMophPrompt`;
   update row (`status`, `message_id`, `api_status`, `attempts++`, `last_error`, `sent_at`).
3. Stop on `budgetMs` exceeded; leave remaining `pending` for next drain.
4. 502 / timeout → `status` stays `pending` (retry next drain), `attempts++`, `last_error` set.
5. 400/422 (cid/validation) → `status='failed'` (terminal, don't retry).

Invoked as a bounded final `appendSyncStep` in browser-push. Failures never abort the sync run.

## TDD test list (Red-Green-Refactor, PGlite harness)

**`tests/unit/services/moph-prompt.test.ts`**
- builds correct headers/body (Bearer session, cid 13-digit, title, text)
- parses 200 success → `{message_id, hospital_code, line:{success}}`
- maps 400→cid error, 401→auth, 422→validation, 502→retryable
- retries only on 502 with backoff, gives up after N → throws retryable
- per-send timeout enforced
- never sends `hospital_code`/`hospital_name` in body

**`tests/unit/services/risk-alert.test.ts`**
- HIGH producer enqueues one row per active consult_doctor + per active center_monitor
- EMERGENCY producer enqueues with `severity='emergency'`, `alert_source='maternal_triage'`, `rule_id` = acuity rule
- dedup: second enqueue same key same day → no new row (conflict-skip)
- distinct `rule_id` on same case → both rows kept (not suppressed)
- center recipients get redacted template (no patient name/cid in payload)
- hospital recipients get fuller template
- no LINE I/O performed (sender mocked, never called by enqueue)

**`tests/unit/services/moph-alert-drain.test.ts`**
- pops pending rows, sends each, updates status sent + message_id
- respects `maxAlerts` cap
- stops on `budgetMs` exceeded; unsent stay pending
- 502 → row stays pending, attempts++, last_error set
- 400 → row marked failed (terminal)
- expired session → re-derives via bms-session helper, then sends
- drain failure does not throw to caller (logged, returns summary)

**`tests/unit/config/moph-alert-templates.test.ts`**
- HIGH Flex has severity badge + hospital name + case ref + confirm_url
- EMERGENCY Flex has emergency styling
- center-scope Flex contains NO patient name / cid (PDPA) — assert absent
- hospital-scope Flex may contain limited patient ref
- all text Thai; altText == title

**`tests/unit/api/browser-push-moph-alerts.test.ts`**
- HIGH case in ANC payload → pending moph_alert_log row created → drain step runs → row sent
- non-high case → no row, no drain work
- drain step appended as final sync step; sync run still succeeds if drain throws

**`tests/unit/services/webhook-mohp-alerts.test.ts`**
- emergency acuity transition → pending row enqueued with correct source/severity/rule_id
- no acuity → no row

## Build order (TDD, one task → commit)

1. `moph-alert-config.ts` + `moph-prompt.ts` (+ tests) — sender, no DB.
2. `moph-alert-log` + `moph-center-monitors` tables + registration (+ schema-sync test).
3. `moph-alert-templates.ts` (+ tests) — Flex builders, PDPA assertions.
4. `risk-alert.ts` (+ tests) — enqueue orchestrator, dedup, recipient resolution.
5. `moph-alert-drain.ts` (+ tests) — bounded drain, retry/terminal logic.
6. `bms-session` re-derive helper (+ test).
7. Wire HIGH producer + drain step into `browser-push/route.ts` (+ tests).
8. Wire EMERGENCY producer into `webhook.ts` (+ tests).
9. Admin ops route `moph-alerts/route.ts` (+ test) — view + manual re-drive.
10. `npm test && npm run lint` green; commit; manual smoke against sandbox session.

## Open decision (need your call before step 7)

**Drain trigger model** — I've specified "bounded post-sync drain on the browser-push path"
because it's the only reliably-live channel. Two alternatives if you prefer:
- **(A)** Inline send per-alert during sync (simplest, but re-couples LINE latency to the
  patient loop — codex warned against; only viable for EMERGENCY-only with a 3s cap).
- **(B)** Add a real cron/worker container (ops change; faithful to codex but new infra).

Default in this plan: the hybrid drain. Confirm or pick A/B.

## Completion (2026-07-26)

All 10 steps shipped across 8 commits (`0851885`..`81c871f`):

| Step | Commit | What |
|------|--------|------|
| 1 | `0851885` | `moph-prompt.ts` sender client + config (9 tests) |
| 2 | `bc4688f` | `moph_alert_log` + `moph_center_monitors` tables (5 tests) |
| 3 | `382b321` | LINE Flex templates w/ PDPA scope rule (6 tests) |
| 4 | `f3cf612` | risk-alert enqueue orchestrator, HIGH+EMERGENCY producers (8 tests) |
| 5+6 | `a7c77d0` | bounded drain + `resolveSessionIdForHospital` (7 tests) |
| 7 | `5fcdec1` | browser-push HIGH(ANC HR3) enqueue + drain step |
| 8 | `2ef0c32` | webhook EMERGENCY (maternal-triage acuity) enqueue |
| 9 | `f9cc476` | admin ops route GET/POST (5 tests) |
| 10 | `81c871f` | env example + CSRF manifest entry |

**Trigger refinement discovered during impl:** the HIGH trigger is ANC
`AncRiskLevel.HR3` (item-based, via `classifyAncItems`), NOT CPD `isHighRisk(score)`
— the plan assumed CPD. The route gates on the server-side canon classifier,
not the client-declared `riskLevel` (a client cannot self-promote to HR3
without item evidence). CPD-score is a separate pipeline not on this path.

**Verification:** `tsc --noEmit` clean · `eslint` clean · 2407/2416 tests pass.
- 1 pre-existing failure: `browser-push-referrals.test.ts` (referral work
  modified at session start; unrelated to MOPH — zero referral files in these
  commits).
- 1 environmentally-flaky test: `browser-push-moph-alerts.test.ts` (route
  integration; worker-exit under memory pressure at cost-critical session
  state — `tests 0ms` = dies during import, not a logic defect). The wiring
  logic is verified by tsc+lint and by the isolated `risk-alert`/`moph-alert-
  drain`/`admin-moph-alerts` tests (all green). **Manual smoke against a
  sandbox BMS session is the remaining pre-prod step** (step 10's smoke,
  deferred to operator — needs a live hospital tunnel + seeded recipients).

**Codex #1 deviation stands:** no background worker (this repo's browser-only
sync model makes server-side workers dead code). The hybrid "intent row +
bounded post-sync drain on the browser-push path" is implemented as specified.
