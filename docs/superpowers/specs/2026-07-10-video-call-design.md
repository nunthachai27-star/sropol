# Video Call System — Design Spec (2026-07-10)

## Goal

Let staff at any hospital place a person-to-person video call to an online
user at another hospital, using the existing kk-lrms infrastructure for
signaling and jitsi1.hosxp.net for the actual audio/video.

**User decisions (2026-07-10):**
- Call model: **call a specific person** — caller picks one online user from
  the target hospital's presence list; only that person rings.
- Signaling: **no MQTT** (rbr1.hosxp.net skipped by user request) — use the
  project's own REST + SSE pipeline.

## Verified facts about external infrastructure

- `https://jitsi1.hosxp.net` is a standard docker-jitsi-meet: `external_api.js`
  served (HTTP 200), anonymous room join (no JWT/auth domain in config.js),
  prejoin screen configurable per-embed. Access control is therefore room-name
  entropy: rooms MUST be unguessable UUIDs.
- Video/audio flows browser ↔ Jitsi only; the kk-lrms server carries just
  signaling.

## Architecture

```
Caller browser ──POST /api/calls {calleeUserId}──▶ kk-lrms server
                                                    │ insert video_calls row (status=ringing)
                                                    │ roomId = kklrms-<uuid>
                                                    │ SSE "call:invite" → every tab of callee
Callee browser ◀── IncomingCallToast ────────────── │
      │ POST /api/calls/[id]/accept                 │
      ▼                                             ▼ SSE "call:accepted" → caller
Both browsers open /calls/[id] → Jitsi iframe (external_api.js, room kklrms-<uuid>)
```

## Components

### Database: `video_calls` (new table, src/db/tables/video-calls.ts)

| column | type | notes |
|---|---|---|
| id | uuid PK | call id |
| room_id | string(64) | `kklrms-<uuid>`, unguessable |
| caller_user_id / callee_user_id | string(255) | NextAuth user ids |
| caller_name / callee_name | string(255) | snapshotted inline (audit_logs actor pattern) |
| caller_hospital_code / callee_hospital_code | string(9) | hcode snapshot |
| status | string(16) | ringing → accepted \| declined \| cancelled \| missed; accepted → ended |
| created_at / answered_at / ended_at | datetime | answered_at, ended_at nullable |

Indexes: callee_user_id, caller_user_id, created_at, status.
No patient data anywhere in call rows or payloads.

### Service: `src/services/video-call.ts` (all business logic)

- `createCall(caller, calleeUserId)` — callee must be online (Redis presence)
  and not busy (no ringing/accepted-unended call as caller or callee → else
  Thai "สายไม่ว่าง" error); inserts row, arms 45 s ring timer, emits
  `call:invite` to callee.
- `acceptCall(id, user)` — callee only, status ringing → accepted, clears
  timer, emits `call:accepted` to caller and `call:resolved` to callee's
  other tabs.
- `declineCall(id, user)` — callee only, ringing → declined, notifies caller.
- `cancelCall(id, user)` — caller only, ringing → cancelled, stops callee ring.
- `endCall(id, user)` — either participant, accepted → ended, notifies peer.
- Ring timeout (45 s) — ringing → missed, `call:missed` to caller,
  `call:resolved` to callee.
- Ring timers live in a module Map pinned on `globalThis` (HMR-safe, same
  pattern as `__dbSingleton`). Single-container prod makes this sufficient.
- Illegal transitions rejected with actionable Thai error messages.

### SSE: extend `src/lib/sse.ts`

- Clients register with optional `userId`; new `sendToUser(userId, event,
  data)` reaches every tab of that user. `broadcast()` unchanged.
- Pin the SseManager singleton on `globalThis` (static-instance fragments
  across Next.js bundles — lesson already learned with `__dbSingleton`).
- New endpoint `GET /api/sse/calls`: authenticated personal stream.

### API routes (all NextAuth-guarded)

- `POST /api/calls` — place call.
- `POST /api/calls/[id]/accept | decline | cancel | end` — participant-guarded
  (callee for accept/decline, caller for cancel, either for end).
- `GET /api/calls/directory` — hospitals with online users from Redis
  presence, excluding the requesting user.

### UI (Thai, shadcn/ui)

- `CallProvider` client component in the authenticated layout: owns the single
  `EventSource(/api/sse/calls)`, holds call state, renders:
  - `IncomingCallToast` — caller name + hospital, รับสาย / ปฏิเสธ, looping
    Web-Audio ringtone (may be muted until first user gesture — accepted;
    toast is always visible).
  - `OutgoingCallOverlay` — กำลังโทร… + ยกเลิก; routes to room on accept;
    shows declined/missed feedback.
- TopNavBar phone icon → `CallDirectoryDialog` (hospital → online users →
  โทร button per user).
- `/calls/[id]` — full-screen Jitsi iframe via `external_api.js` from
  jitsi1.hosxp.net; `prejoinConfig.enabled=false`; displayName
  "ชื่อ (โรงพยาบาล)"; `videoConferenceLeft` → POST end → navigate back.

## Security

- Room ids are UUID-random; Jitsi server is anonymous-join so entropy is the
  access control. Call ids likewise UUIDs.
- Every endpoint requires a session; accept/decline/cancel/end verify the
  caller's role in that specific call.
- bms/bms broker credentials are NOT used anywhere (MQTT dropped).
- Audit: every call transition is a persisted row with actor snapshots.

## Error handling

- Callee offline / busy → immediate actionable Thai error to caller.
- SSE drop → EventSource auto-reconnects; ring loss on reconnect resolves via
  the 45 s missed timer. The room page resolves room id + peer through
  `GET /api/calls/[id]` (participant-guarded), so a room URL alone leaks
  nothing to non-participants.
- Jitsi script load failure → room page shows Thai error + retry link to
  open jitsi1.hosxp.net room directly in a new tab.

## Testing (TDD, red → green)

- Service state machine on PGlite `createTestDb()`: happy path, busy, offline
  callee, illegal transitions, 45 s timeout via fake timers.
- SseManager: per-user targeting, multi-tab fan-out, dead-client cleanup.
- Routes: 401 unauthenticated, 403 non-participant, happy paths.
- Components: IncomingCallToast renders caller info + fires accept/decline;
  CallDirectoryDialog lists online users, excludes self.

## Out of scope (v1, YAGNI)

Call history UI, group calls, patient/referral context attachment, kiosk-mode
ring suppression, external systems ringing kk-lrms users (would need MQTT).
The `video_calls` table already supports the first three later.
