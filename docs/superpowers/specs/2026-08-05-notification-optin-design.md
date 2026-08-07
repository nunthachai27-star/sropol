# Self-service notification opt-in — design spec

**Date:** 2026-08-05 · **Status:** Approved (design review) · **Feature:** per-user
opt-in for MOPH Prompt (LINE) risk alerts
**Flow:** this spec → writing-plans → implementation (TDD).

## Problem

Alert recipients are admin-configured lists (`hospital_consult_doctors`, `moph_center_monitors`)
keyed by CID. Anyone on a list receives HIGH/EMERGENCY MOPH LINE alerts **unconditionally**.
There is no per-user preference and no CID on the `users` table, so a clinician who no longer
wants alerts (or who was never admin-added but does want them) has no self-service surface.

Goal: **only users who want to receive alerts do**, via a per-user profile page.

## Decisions (user-confirmed)

1. **Default OFF (opt-in).** A recipient CID with no preference row does NOT receive alerts.
   Consequence: currently-configured consult doctors / center monitors stop receiving until
   they individually enable the toggle on their profile. Release note + clinician comms required.
2. **Self-subscribe is authoritative.** Any logged-in clinician at hospital X who enables the
   toggle creates a `notification_preferences` row; that CID is resolved as a recipient for
   hospital X **even if an admin never added them** — the preference row is authoritative and
   bypasses the consult-doctors list.
3. **MOPH LINE only.** Single boolean toggle. Schema is single-column now; future channels
   (email, in-app, SMS) can add columns.

## Data model

New table `notification_preferences` (PDPA-safe: carries no plaintext name/full CID — only the
13-digit CID used as `recipient_cid` identity and the hospital scope):

```text
notification_preferences
  id              uuid        PK
  user_cid        string(13)  NOT NULL          -- matches recipient_cid / session.userCid
  hospital_code   string(10)  NOT NULL          -- scope: the hospital the user belongs to
  moph_line_enabled boolean   NOT NULL DEFAULT true
  created_at      datetime    NOT NULL
  updated_at      datetime    NOT NULL
  UNIQUE (user_cid, hospital_code)
  INDEX idx_np_hospital_enabled (hospital_code, moph_line_enabled)
```

- No foreign key to `users` (BMS sessions aren't guaranteed to be in `users`; CID is the stable
  identity used by the alert pipeline already).
- No plaintext name stored — the profile page masks via existing `maskName`/`maskCid`.

## Recipient resolution change (src/services/risk-alert.ts)

`resolveRecipients` currently returns active consult doctors + active center monitors.

New contract:

```text
candidates = active hospital_consult_doctors (hospital_staff)
          ∪ active moph_center_monitors   (province_center)
          ∪ notification_preferences WHERE hospital_code = session.hospital
              AND moph_line_enabled = true      (self-subscribers, deduped by cid)

delivered = candidates with (cid, hospital_code) in notification_preferences(moph_line_enabled=true)
```

I.e.:
- Admin-listed CID: delivered **only if** an enabled preference row exists for that
  (cid, hospital_code). No row → skipped (default OFF).
- Self-subscriber CID (enabled row, not on any admin list): delivered (authoritative).
- Center monitors (province scope): gated through the same preference table keyed by their
  hospital_code — they must also enable their toggle to keep receiving (their admin list
  membership is still the "who is a monitor" record; the preference is the "do they want alerts"
  record).

Dedup: unique index `(case_id, hospital_id, recipient_cid, alert_source, severity, rule_id,
local_date)` already prevents duplicate sends per CID.

## API

New session-gated route (auth() required; CSRF manifest entry):

```
GET  /api/profile/notification-preference
  200 { userCid, hospitalCode, mophLineEnabled: boolean }   (false when no row)
  401 unauthenticated

PUT  /api/profile/notification-preference   body { mophLineEnabled: boolean }
  200 { ...updated }
  400 invalid body
  401 unauthenticated
```

- Identity from session: `session.user.userCid` + `session.user.hospitalCode`. No body CID
  submission → no cross-account tampering.
- Upsert on `(user_cid, hospital_code)`.

## UI

- Route: `src/app/(hospital)/profile/page.tsx` (already session-gated by the (hospital) layout).
- Entry point: a "การตั้งค่าการแจ้งเตือน" item in `TopNavBar` user area (small dropdown/avatar
  menu — none exists today; add one with the notification settings link). Acceptable per user.
- Content (constitution §V informative UX, Thai):
  - Header: hospital name + masked name/CID (maskName/maskCid reuse).
  - Single toggle card "รับการแจ้งเตือน MOPH ทาง LINE (ผู้ป่วยเสี่ยงสูง/ฉุกเฉิน)".
  - Optimistic toggle with immediate confirm; failure shows actionable Thai error + revert.
  - No full CID shown.
- Disabled-feature note: the toggle is independent of `CLINICAL_CHAT_ENABLED` (unrelated cost
  gate); always shown.

## Testing (TDD — first test per unit)

1. `src/services/risk-alert.ts` `resolveRecipients`:
   - consult doctor without pref row → excluded
   - consult doctor with enabled row → included
   - self-subscriber (enabled row, not admin-listed) → included
   - center monitor with enabled row → included; with no row → excluded
2. API route: GET 401 anonymous / 200 with false-when-empty; PUT upserts + 200; PUT 400 bad body;
   PUT 401 anonymous; PUT uses session identity (body can't set CID).
3. Service layer `notification-preference.ts` (get/upsert helpers) — pure, no route.
4. Profile page: renders masked CID + toggle reflecting stored state.

## Migration

- Schema-sync DDL for `notification_preferences` added to `src/db/tables/` (project uses additive
  schema-sync; no separate migration tool).
- Seed/backfill: none — Default OFF means empty table = everyone stops (intended). Optionally a
  data-URI/ops note listing currently-configured CIDs so admins can pre-enable if desired (out of
  scope; release note only).

## Risks / notes

- **Silence risk (flagged):** after deploy, no one receives alerts until they opt in. Mitigation:
  release note + admin can prompt staff; center monitors must also self-enable.
- Change is contained: no chat/GLM coupling; no changes to `moph_alert_log` or drain.
- `resolveRecipients` signature stays `(db, hospitalId, province)` — needs the hospital's
  hcode for the preference key; ensure caller passes session hospital code (currently passes
  `hospitalId` = uuid; will add `hospitalCode` param). Implementation detail for writing-plans.
