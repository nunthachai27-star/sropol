# Maternal Labor-Triage Screening — Operator Rollout Runbook

**Audience:** the operator/engineer who deploys and flips flags for this feature. Not a clinical
document — the clinical decision tables live in
`docs/clinical/maternal-screen-phase0-signoff.md`.
**Grounds:** `docs/maternal-screen-plan.md` §17 (rollout/rollback), `src/lib/feature-flags.ts`,
`docker-compose.yml`, `docs/WEBHOOK-SPEC.md` §1 (Optional Fields — Maternal Labor-Triage
Screening), `docs/hosxp/maternal-screening-field-map.md`,
`docs/hosxp/KKLRMSWebhookUnit.pas`.
**No PHI in this document, in commands you run from it, or in anything you paste into an
incident channel while following it.**

---

## 0. Current state (honest, as of this writing)

- **Branch:** `feat/maternal-screening`, ~40+ commits ahead of `main` (recompute with
  `git rev-list --count main..HEAD` — this number drifts every commit, so it's kept
  approximate rather than pinned), **not merged, not deployed**. Nothing in this document has
  run against production yet.
- **Phase 0 clinical sign-off:** `docs/clinical/maternal-screen-phase0-signoff.md` status is
  `PROVISIONAL_UNAPPROVED` — **both** sign-off blocks (§6.1 local-tier, §6.2 emergency-acuity)
  are blank. Until both are signed, the rule set stays `0.1.0-provisional` and no alert may
  drive a workflow (spec §11 exit gate). This runbook's Sections 4–6 cannot start for real
  hospital data before that signature.

### 0.1 Feature flags today

Read from `src/lib/feature-flags.ts` (all four are process-wide — **none of the four take a
hospital argument**; there is no per-hospital code-level gate, see §4.0 below):

| Flag (env var) | Function | Default when unset | Fail-safe direction |
| --- | --- | --- | --- |
| `MATERNAL_SCREEN_INGEST_ENABLED` | `isMaternalScreenIngestEnabled()` | **OFF** (`=== 'true'` to enable) | fail-closed |
| `MATERNAL_SCREEN_SHADOW_MODE` | `isMaternalScreenShadowMode()` | **ON** (`!== 'false'` to disable) | fail-safe-on (shadow is the safe state) |
| `MATERNAL_SCREEN_UI_ENABLED` | `isMaternalScreenUiEnabled()` | **ON** (`!== 'false'` to disable) — operator decision 2026-07-16, safe because every surface carries the shadow banner and nothing renders green pre-approval | fail-safe-on |
| `MATERNAL_SCREEN_EVENTS_ENABLED` | `isMaternalScreenEventsEnabled()` | **OFF** (`=== 'true'` to enable) | fail-closed |

**Step 0 gap you must close before any of these can be flipped in this deployment:**
`docker-compose.yml`'s `app.environment` block does **not** list any `MATERNAL_SCREEN_*`
variable today (verified: `grep MATERNAL_SCREEN docker-compose.yml` returns nothing, and
`docker compose config` shows none). Neither does `.env`, `.env.example`, or
`.env.production.example`. Docker Compose only forwards variables that are explicitly named in
the `environment:` block — putting a value in `.env` alone does **nothing** until the compose
file references it. Before Section 3 or 4 can do anything, add these four lines to the `app:`
service's `environment:` block in `docker-compose.yml` (commit this as its own change, reviewed
like any other code change):

```yaml
      MATERNAL_SCREEN_INGEST_ENABLED: ${MATERNAL_SCREEN_INGEST_ENABLED:-false}
      MATERNAL_SCREEN_SHADOW_MODE: ${MATERNAL_SCREEN_SHADOW_MODE:-true}
      MATERNAL_SCREEN_UI_ENABLED: ${MATERNAL_SCREEN_UI_ENABLED:-true}
      MATERNAL_SCREEN_EVENTS_ENABLED: ${MATERNAL_SCREEN_EVENTS_ENABLED:-false}
```

The `:-` defaults above **match the code's own fail-safe defaults**, so adding these lines is a
no-op for current behavior — it only wires the knobs up so that setting the var in `.env` and
recreating the container (`docker compose up -d`, no rebuild needed — see §4.2) actually takes
effect. These are plain server-side runtime env vars, **not** Next.js `NEXT_PUBLIC_*` build
args (only `NEXT_PUBLIC_BUILD_ID`/`NEXT_PUBLIC_BUILD_TIME` are baked in at image build time —
see `Dockerfile` lines 13–16), so flipping them never requires `npm run deploy`'s
`--build`.

### 0.2 What a user sees today, once this branch is deployed with defaults untouched

- **UI is ON, data is empty everywhere** — because ingest is off, nothing has ever been
  written to `maternal_screen_local_tier`/`maternal_screen_emergency_acuity` on
  `cached_patients`, so every surface renders its empty state:
  - Patient detail (`src/components/patient/MaternalScreeningCard.tsx`) shows the
    `ShadowBanner` and the text `ยังไม่มีข้อมูลการคัดกรอง` ("no screening data yet").
  - Dashboard chip (`src/components/dashboard/MaternalScreenCell.tsx`, used from
    `HighRiskPatientList.tsx`) renders nothing — its own header comment states nothing may
    render green under the `PROVISIONAL_UNAPPROVED` rule set, and there is no data to show
    regardless.
  - Ward bed-tile pills (`src/components/maternity/WardLayoutViewFull.tsx` /
    `BedTileFull.tsx`, backed by `GET /api/hospitals/{hcode}/maternal-screen-summaries`)
    show no chips — the cross-source join has nothing to join against.
- **No alerts, no SSE transitions, no workflow effect anywhere** — `MATERNAL_SCREEN_EVENTS_ENABLED`
  is off, and even shadow-mode calculation only runs on assessments that were ingested (none
  yet).

---

## 1. Pre-requisites (must hold before Section 4 touches a real hospital)

1. **Signed Phase 0 bundle** — `docs/clinical/maternal-screen-phase0-signoff.md` §6.1 AND §6.2
   both completed (name, position, license no., organization, date, signature, rule-set
   version) — independently, per AC #24. Neither table may be treated as approved because the
   other was signed.
2. **Complete Thai source manual** — §2 of the sign-off doc requires the hospital to supply the
   full text of "คู่มือการดูแลรักษาสตรีตั้งครรภ์ที่มีความเสี่ยงสูงฯ เขตสุขภาพที่ (ปรับปรุงครั้งที่ 3)
   หน้า 14–17" including health-region number, issuing organization, edition date, and complete
   title — all currently unresolved. Until supplied, `LOCAL_PDF` evidence citations remain
   scoped to the excerpt already in `docs/maternal-screen.pdf`.
3. **Per-site lab-unit verification (the H1 hazard) — required before enabling any hospital's
   real lab-backed fields:**
   - `docs/hosxp/maternal-screening-field-map.md` flags `creatinine_mg_dl` as the dangerous
     one: **a µmol/L lab result (e.g. 88, ≈ 1.0 mg/dL) silently passes the server's 0.05–100
     mg/dL bounds check as a ~88× overstated value** — this is not caught by validation, only
     by a correct per-site unit configuration. Before enabling creatinine capture for any
     hospital, confirm that hospital's `lab_items.lab_items_unit` for its creatinine item code
     reads mg/dL, and refuse to enable it otherwise.
   - `platelet_per_ul` has the mirror hazard: a 10³/µL (thousands) CBC convention needs ×1000
     conversion before sending; sending raw thousands (e.g. `250`) is safely rejected by the
     server's 500–5,000,000 bound, but must still be configured correctly per site rather than
     relied on to fail loud every time.
   - These conversions are **per-site config, never hardcoded in the shared Pascal unit** (27
     hospitals, 27 lab catalogs) — see field-map §6.

---

## 2. Dev rehearsal (optional but recommended before touching a real hospital)

Exercises the full ingest → persist → summary → UI path with **zero** production reach, using
the executable oracle-derived profiles built for this purpose.

1. Confirm you are **not** running with `NODE_ENV=production` — `isSimulationEnabled()` in
   `src/lib/feature-flags.ts` is hard-coded to return `false` in production regardless of any
   env var. Outside production it defaults on; `DEV_SIMULATION_ENABLED=false` turns it off if
   needed.
2. Locally, set `MATERNAL_SCREEN_INGEST_ENABLED=true` (and optionally
   `MATERNAL_SCREEN_EVENTS_ENABLED=true` to also rehearse the SSE transition) in your dev
   environment.
3. Start a simulation run:
   ```bash
   curl -X POST http://localhost:3000/api/dev/simulate/start \
     -H 'Content-Type: application/json' \
     -d '{"hospitals":["<dev-hospital-id>"],"eventTypes":["labor"],"ratePerHospitalPerMin":2,"durationMin":5}'
   ```
   Each simulated labor admission attaches a `maternal_screening` object sourced from
   `src/services/dev-simulation/maternal-screening-profiles.ts` — every clinical value there is
   copied verbatim from a named case in the approved 66-case oracle
   (`tests/fixtures/maternal-screen-clinical-cases.json`) and mechanically mapped to the wire
   format using the same field maps the server validates against (`MS_BOOLEAN_FIELD_MAP` /
   `MS_NUMERIC_FIELD_MAP` / `MATERNAL_SCREEN_ENUM_VALUES` in `src/services/webhook.ts`), so it
   cannot silently drift from the real transport contract.
4. What to check:
   - `docker compose logs app` (or your dev console) shows no
     `maternal_screen_webhook_ingest_rejected` warnings for the simulated traffic.
   - `MaternalScreeningCard` on a simulated patient's detail page shows a populated card
     (still shadow-banner-labeled) instead of the empty state.
   - `tests/unit/services/dev-simulation-maternal-screening.test.ts` is the automated version
     of this check — it proves a representative subset of the profiles round-trip to the exact
     `localTier`/`emergencyAcuity` the oracle case declares, via the real
     `processWebhookPayload` path on a PGlite database. Run it directly if you want the same
     proof without standing up a dev server:
     ```bash
     npx vitest run tests/unit/services/dev-simulation-maternal-screening.test.ts
     ```

Stop the simulation with `POST /api/dev/simulate/stop`, and clear simulated rows with
`POST /api/dev/simulate/clear` before leaving the dev environment (both routes are behind the
same `simulationGuard()` — refuses outside dev, see `src/app/api/dev/simulate/_guard.ts`).

---

## 3. Deploy the code (still fully dormant)

This step ships everything code-complete but changes no runtime behavior — all four flags stay
at their fail-safe defaults (per §0.1's compose defaults).

```bash
# From a clean main after this branch is reviewed and merged:
docker tag $(docker compose images -q app) kk-lrms-app:rollback-$(date +%F)-maternal-screen-h5 || true
git push origin main
npm run deploy   # BUILD_SHA=$(git rev-parse --short HEAD) BUILD_TIME=... docker compose up -d --build
curl -s -o /dev/null -w '%{http_code}\n' https://kk-lrms.bmscloud.in.th/api/health   # expect 200
docker compose logs app --since 5m | grep initialization_completed
```

`initialization_completed` is the structured-log line `src/app/api/startup.ts` emits once
startup finishes (`logger.info('initialization_completed', { elapsedMs })`); its absence in a
5-minute window after deploy means startup did not complete and you should not proceed.

At this point the state matches §0.2 exactly: UI visible, empty, no ingest, no events.

---

## 4. Pilot (one hospital)

### 4.0 Read this first — the ingest flag is deployment-wide, not per-hospital

`isMaternalScreenIngestEnabled()` takes no hospital argument; flipping
`MATERNAL_SCREEN_INGEST_ENABLED=true` turns on **server-side acceptance of the
`maternal_screening` object for every hospital connected to this deployment**, not just the
pilot. This is safe only because the object is entirely optional per patient — flipping the
server flag with no sender emitting the object yet is a pure no-op (identical to §0.2). The
**actual** pilot scoping happens on the sender side: only the pilot hospital's integration is
changed to emit the object. Do the two steps in this order (server flag first, sender second)
so you can verify the pipe is quiet before any real data can flow through it.

### 4.1 Choose the pilot hospital

Pick one hospital already onboarded and actively syncing (admin hospital list). Confirm its
recent sync health via the existing admin sync-progress API before starting:
```bash
# Authenticated admin session required (requireAdmin() guard)
curl -s 'https://kk-lrms.bmscloud.in.th/api/admin/hospitals/<hcode>/sync-progress?latest=true' \
  -H 'Cookie: <admin session cookie>'
```

### 4.2 Server-side: enable ingest

Edit `.env` (or your deployment's secret store) to set:
```
MATERNAL_SCREEN_INGEST_ENABLED=true
```
Then recreate the app container to pick up the new value — **no image rebuild needed** (this is
a runtime env var, not a `NEXT_PUBLIC_*` build arg):
```bash
docker compose up -d
docker compose logs app --since 2m | grep initialization_completed
```

### 4.3 Sender-side: opt the pilot hospital in

Pick the branch that matches the pilot hospital's integration:

- **Webhook hospital (non-HOSxP):** the hospital's integrator adds the optional
  `maternal_screening` sub-object to the existing labor patient entries it already POSTs to
  `/api/webhooks/patient-data` (or pushes via `/api/sync/browser-push`), per
  `docs/WEBHOOK-SPEC.md` §1 (Optional Fields — Maternal Labor-Triage Screening). No other
  sender needs to change anything — the object is ignored (not validated, not stored) on
  every hospital that doesn't send it.
- **HOSxP hospital:** deploy the H2 Pascal unit
  (`docs/hosxp/KKLRMSWebhookUnit.pas`) to that hospital's integration server with:
  ```pascal
  KKLRMS_SEND_MATERNAL_SCREENING := True;
  ```
  (the unit's module-level default is `False` — line 103 — so every other HOSxP hospital
  running the same reference unit stays silent unless this constant is flipped in their
  deployment too). `BuildMaternalScreeningJson` builds the object from the H1 field map;
  on any internal error it logs a warning via `SIMain.LogWarning` and omits the object rather
  than failing the whole labor payload — a screening build failure never blocks the base
  admission sync.

### 4.4 Verification checklist

Run these within the first sync cycle (~30 s) after the pilot hospital's first labor admission
carrying a `maternal_screening` object:

1. **Redis sync-run counters** (browser-push path — the production live path per the
   browser-only sync architecture): the `persist_labor` step of that hospital's latest sync run
   carries `counts.maternalScreenAssessments`, `counts.maternalScreenDuplicates`,
   `counts.maternalScreenErrors` (written by
   `src/app/api/sync/browser-push/route.ts`, persisted by
   `src/services/sync/progress-store.ts` under Redis key
   `kk-lrms:sync:run:<hospitalId>:<runId>` / `kk-lrms:sync:latest:<hospitalId>`, 24h TTL).
   Read the human-friendly view via the admin API used in §4.1, or directly from Redis:
   ```bash
   docker compose exec redis redis-cli GET "kk-lrms:sync:latest:<hospitalId>"
   ```
   Expect `maternalScreenAssessments` > 0 and `maternalScreenErrors` == 0 for a clean pilot
   send.
2. **Webhook/browser-push response** (if you control the sender and can inspect its own logs):
   the JSON response now carries `maternalScreenAssessments` / `maternalScreenDuplicates` /
   `maternalScreenIngestErrors` — present only when the flag is on **and** a screening rode
   along (legacy responses for every other hospital stay byte-identical, per
   `docs/WEBHOOK-SPEC.md` §1, Optional Fields — Maternal Labor-Triage Screening).
3. **Assessment rows persisted:** the patient's `cached_patients` row now has non-null
   `maternal_screen_local_tier` / `maternal_screen_emergency_acuity`, and a row exists in the
   assessment history table reachable via
   `GET /api/patients/{an}/maternal-screenings` (session-authenticated, tenant-isolated —
   confirm the pilot hospital's own admin/clinician account can read it and another hospital's
   account cannot).
4. **UI renders:**
   - Patient-detail shadow card (`MaternalScreeningCard`) shows the populated result instead of
     `ยังไม่มีข้อมูลการคัดกรอง`, still under the shadow banner.
   - Dashboard chip (`MaternalScreenCell` on `HighRiskPatientList`) shows the pilot patient.
   - Ward bed-tile pill (`BedTileFull` via `GET /api/hospitals/{hcode}/maternal-screen-summaries`)
     shows the chip on the correct bed.
5. **Rejection channel stays quiet for good sends:** watch for
   `maternal_screen_webhook_ingest_rejected` (warn-level structured log,
   `src/services/webhook.ts`, fields `hospitalId` + PHI-free `errors[]`) and
   `maternal_screen_store_failed` (error-level, `src/services/maternal-screening-store.ts`,
   fields `hospitalId`, `laborAdmissionId`, `sourceSystem`, `code`):
   ```bash
   docker compose logs app --since 30m | grep -E 'maternal_screen_webhook_ingest_rejected|maternal_screen_store_failed'
   ```
   Any hit during the pilot warrants investigation before expanding — both log lines are
   PHI-free by construction, safe to paste into an incident channel as-is.

---

## 5. Shadow comparison

With `MATERNAL_SCREEN_SHADOW_MODE` left at its default `true`, every ingested assessment is
calculated but drives no workflow — it exists only for clinicians to compare against their own
independent assessment.

- The clinician reviewing the pilot cohort opens the patient-detail shadow card and compares
  the system's suspected local-tier / emergency-acuity against what they charted independently
  for the same encounter.
- Record mismatches using the same evidence-file convention this project already uses for
  clinical reconciliation (see `docs/superpowers/plans/evidence/` for the existing pattern from
  prior releases, e.g. `2026-07-13-release-b-reconciliation.md`) — do not record PHI, only
  hospital id, admission reference, the system's output, the clinician's independent judgment,
  and the resolution.
- **Standing rule (spec Phase 6 exit gate):** no unexplained severe false negative may exist in
  the pilot cohort before Section 6 (events/alerts) is enabled. A severe false negative — the
  system says stable/mild while the clinician found a severe/emergency pattern — must be
  triaged and either explained (data gap, timing) or fixed and re-verified against the oracle
  before proceeding.

---

## 6. Events/alerts activation (LAST, gated)

Only after **all** of: Phase 0 sign-off (§1.1), the pilot's shadow comparison (§5) shows
acceptance with no unexplained severe false negative, and the clinical owner records explicit
acceptance.

```bash
# .env
MATERNAL_SCREEN_EVENTS_ENABLED=true
```
```bash
docker compose up -d
```

What changes: `src/services/webhook.ts` starts calling `sseManager.broadcast('patient-update',
buildMaternalScreenStateChangedEvent(...))` after a real `localTier`/`emergencyAcuity`
transition (never on a duplicate replay, never on a save that doesn't change the projected
summary — see `shouldEmitMaternalScreenTransition` in
`src/services/maternal-screening-events.ts`). The event type is `maternal_screen_state_changed`
(`src/types/api.ts`).

**SSE fan-out cost note:** this broadcasts on the existing `patient-update` SSE channel used by
every other dashboard-affecting change in this system — every connected client's dashboard
revalidates on receipt. The system's stated budget is 200 concurrent users with SSE broadcast
within 5 seconds (project constitution §VI); a pilot-scale rollout (one hospital) is well inside
that budget, but re-check `SseManager` connection counts before expanding to multiple hospitals
simultaneously, since transition frequency scales with active-labor volume across all
events-enabled hospitals combined (the flag, like ingest, is deployment-wide).

---

## 7. Rollback

Data is **append-only** — do not attempt to delete `maternal_screen_*` columns or assessment
history rows during rollback. Per spec §17.3, disable the visible/active surfaces first, retain
raw assessments if safe:

```bash
# .env — disable events and hide the UI (fastest, least destructive)
MATERNAL_SCREEN_EVENTS_ENABLED=false
MATERNAL_SCREEN_UI_ENABLED=false
```
```bash
docker compose up -d
```

If the input pipeline itself is defective (bad data being accepted/stored, not just a UI/alert
concern), also disable ingest:
```bash
MATERNAL_SCREEN_INGEST_ENABLED=false
```

Full rollback-to-dormant .env values:
```
MATERNAL_SCREEN_INGEST_ENABLED=false
MATERNAL_SCREEN_SHADOW_MODE=true
MATERNAL_SCREEN_UI_ENABLED=false
MATERNAL_SCREEN_EVENTS_ENABLED=false
```

**Verify quiet state after rollback:**
1. `curl -s -o /dev/null -w '%{http_code}\n' https://kk-lrms.bmscloud.in.th/api/health` — 200.
2. `docker compose logs app --since 5m | grep initialization_completed` — present.
3. `GET /api/hospitals/{hcode}/maternal-screen-summaries` returns an empty/no-chips result
   (`isMaternalScreenUiEnabled()` gate returns `[]` — `src/services/dashboard.ts`).
4. No new `maternal_screen_webhook_ingest_rejected` / `maternal_screen_store_failed` lines
   appear after the rollback deploy (any prior ones were from before rollback and are expected
   to stop, not retroactively disappear).
5. **Never** run a destructive migration or manual `DELETE`/`UPDATE` against
   `maternal_screen_local_tier` / `maternal_screen_emergency_acuity` or the assessment history
   table as part of rollback. If a bad rule set already wrote incorrect summaries, the only
   sanctioned fix is a future, explicit, versioned re-evaluation operation — not built in this
   phase — never a silent overwrite of historical results (spec §17.3).

---

## 8. Watchlist (what to look at, and where, during and after each activation step)

| Signal | Type | Source | How to check |
| --- | --- | --- | --- |
| `maternal_screen_webhook_ingest_rejected` | warn log | `src/services/webhook.ts` | `docker compose logs app --since <window> \| grep maternal_screen_webhook_ingest_rejected` |
| `maternal_screen_store_failed` | error log | `src/services/maternal-screening-store.ts` | same, grep for `maternal_screen_store_failed` |
| `initialization_completed` | info log | `src/app/api/startup.ts` | post-deploy startup proof, same `docker compose logs` pattern |
| `maternalScreenAssessments` / `maternalScreenDuplicates` / `maternalScreenErrors` | counters | sync-run `persist_labor` step, `src/services/sync/progress-store.ts` | Redis key `kk-lrms:sync:run:<hospitalId>:<runId>` / `kk-lrms:sync:latest:<hospitalId>` (24h TTL), or `GET /api/admin/hospitals/{hcode}/sync-progress?latest=true` |
| `maternal_screen_state_changed` | SSE event (post-events-activation only) | `src/services/maternal-screening-events.ts`, broadcast via `SseManager` on channel `patient-update` | connected client dashboards; not a docker log line |
| `maternalScreenAssessments` / `maternalScreenDuplicates` / `maternalScreenIngestErrors` | webhook/browser-push JSON response fields | `src/services/webhook.ts`, `src/app/api/sync/browser-push/route.ts` | sender-side response inspection |

**docker logs caveat:** container log retention on this host is not unlimited — treat
`docker compose logs` as a short-window tool (recent minutes/hours via `--since`), not a
durable audit trail. The **Redis sync-run records are the durable evidence** for what a given
sync cycle actually did (24h TTL, keyed per hospital per run) — this is the same mechanism used
to diagnose prior sync-related production incidents in this project (e.g. the stale-ACTIVE-labor
reconciliation finding), and is the source to pull from when a log window has already rolled
over. For anything you need to keep beyond 24h, copy the relevant sync-run JSON or the admin
API's response into the same `docs/superpowers/plans/evidence/` convention used elsewhere in
this project.
