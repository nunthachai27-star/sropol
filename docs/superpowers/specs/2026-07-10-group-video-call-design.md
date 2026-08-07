# Group Video Call — Design Spec (2026-07-10)

Extends the person-to-person video-call system (see
`2026-07-10-video-call-design.md`) to group calls.

**User decisions (2026-07-10):**
- Model: **ad-hoc multi-ring + add mid-call** — select several online users
  when placing a call; any joined participant can ring more people into the
  same room. No persistent/scheduled rooms (out of scope).
- Architecture: **unified** — a 1:1 call is a group call with one invitee.
  The deployed 1:1 endpoints/UI are replaced, not kept alongside.

## Data model

`video_calls` becomes a slim call header:

| column | notes |
|---|---|
| id, room_id | unchanged semantics (room UUID = Jitsi access control) |
| created_by_user_id / _name / _hospital_code | creator snapshot |
| status | `active → ended` |
| created_at, ended_at | ended_at nullable |

New `video_call_participants` — one row per person per call:

| column | notes |
|---|---|
| id, call_id → video_calls.id | |
| user_id, name, hospital_code, hospital_name | identity snapshot |
| role | `creator` \| `invitee` |
| status | creator starts `joined`; invitee `ringing → joined → left`, or `ringing → declined \| missed \| cancelled` (cancelled = ring revoked because the call ended) |
| invited_by_user_id, invited_at, joined_at, left_at | joined_at/left_at nullable; left_at stamps every terminal status |

Indexes: participants(call_id), participants(user_id, status);
header(status), header(created_at).

### Migration (startup, BEFORE SchemaSync.sync)

`migrateVideoCallsGroupModel(db)`: if `video_calls` exists AND still has a
`callee_user_id` column → drop its old `idx_vc_*` indexes and
`ALTER TABLE video_calls RENAME TO video_calls_legacy_v1`. SchemaSync then
creates the new tables. The hours-old 1:1 history stays queryable in the
legacy table; no row munging. Idempotent (new-shape table lacks
callee_user_id, so re-runs no-op).

## Lifecycle rules (src/services/video-call.ts)

- `createCall(db, creator, calleeUserIds[])` — creator inserted `joined`;
  invitees processed by shared `ringInvitees()`: self/duplicates filtered,
  offline/busy users **skipped with a per-user Thai reason** (call fails with
  `NO_INVITEES` only if nobody is invitable), cap
  `MAX_CALL_PARTICIPANTS = 8` (src/config/video-call.ts) → excess skipped
  `limit`. Each invitee: `ringing` row + 45 s timer + `call:invite`
  {callId, roomId, inviter, participantCount}. Creator busy → `BUSY`.
- `inviteToCall(db, callId, actor, calleeUserIds[])` — actor must be a
  `joined` participant on an `active` call; same ringInvitees rules.
- `acceptInvite` / `declineInvite` — flips that participant's row only;
  joined peers receive `call:participant-joined|declined`; the invitee's
  other tabs get `call:resolved`.
- `leaveCall` (replaces end + cancel) — `joined → left`. When the last
  joined participant leaves: header `ended`, every still-`ringing`
  participant → `cancelled` (timers cleared, `call:cancelled` to their tabs).
  Otherwise peers get `call:participant-left`.
- Per-invitee ring timeout → `missed`, `call:participant-missed` to peers.
- **Self-healing sweep** (runs before busy checks): rings older than 2 min
  (dead timer after redeploy) → missed; `joined` participants absent from
  Redis presence with joined_at older than 3 min → left (crashed browsers
  can't hold calls open); active calls with no joined and no ringing → ended.
- Busy = any `ringing`/`joined` row on an `active` call.
- `getCall(db, callId, userId)` — requester must be a `ringing`/`joined`
  participant (room_id never leaks to declined/left/strangers); returns
  header + full participant list with statuses.

Error codes: `NO_INVITEES | BUSY | LIMIT | NOT_FOUND | FORBIDDEN |
INVALID_STATE` (SELF_CALL/CALLEE_OFFLINE become per-invitee skip reasons).

## API

- `POST /api/calls` — body `{ calleeUserIds: string[] }` (legacy single
  `calleeUserId` string accepted and wrapped) → 201
  `{ callId, roomId, invited[], skipped[] }`; creator navigates straight to
  the room.
- `POST /api/calls/[id]/invite` — `{ calleeUserIds }` → `{ invited, skipped }`.
- `POST /api/calls/[id]/accept | decline | leave` (end/cancel routes deleted).
- `GET /api/calls/[id]` — header + participants (participant-guarded).
- `GET /api/calls/directory`, `GET /api/sse/calls` — unchanged.

## UI

- **CallDirectoryDialog**: checkbox multi-select (row click toggles), footer
  button `โทร (n)`; shows the server's Thai error inline (dialog stays open
  on failure); also reused inside the room for เพิ่มผู้เข้าร่วม (posts to
  /invite and reports skipped users inline).
- **OutgoingCallOverlay deleted** — the caller waits inside the room.
- **CallRoomClient**: participant strip (name + hospital + Thai status chip:
  กำลังเรียก… / เข้าร่วมแล้ว / ปฏิเสธ / ไม่รับสาย / ออกแล้ว), เพิ่มผู้เข้าร่วม
  button, own EventSource on /api/sse/calls (refetch on any
  call:participant-* for its callId; 15 s polling fallback), and — critical —
  its own presence heartbeat (the room layout has no TopNavBar, and the
  stale-join sweep uses presence; without heartbeats in-room users would be
  swept out of their own call after the presence TTL).
- **IncomingCallToast**: unchanged, plus a สายกลุ่ม hint when
  participantCount > 2.
- CallProvider simplifies: incoming toast + directory only (no outgoing
  overlay, no call:accepted routing — the creator is already in the room).

## Testing (TDD)

Table shapes; migration (rename + idempotence); service (partial-skip
create, mid-call invite joined-only, accept/decline/leave, last-leave ends +
revokes rings, per-invitee timeout, presence-based stale-join sweep, cap);
routes (array body, invite/leave, guards); components (multi-select dialog,
toast group hint, participant strip). Full suite + build + deploy with
rollback tag.

## Out of scope

Persistent/named rooms, scheduling, screen-share policy (Jitsi default),
call recording, per-hospital broadcast rings.
