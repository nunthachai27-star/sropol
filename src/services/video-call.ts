// Video-call signaling service — unified group model (Constitution IV:
// business rules live in services). A 1:1 call is a group call with one
// invitee.
//
// Media never touches this server: participants join a Jitsi room on
// jitsi1.hosxp.net whose name is an unguessable UUID (the instance is
// anonymous-join, so room-name entropy IS the access control). This service
// manages the call/participant lifecycle and pushes signaling over SSE.
//
//   header:      active ──(last joined participant leaves)──▶ ended
//   creator:     joined ──▶ left
//   invitee:     ringing ──accept──▶ joined ──▶ left
//                   │──decline──▶ declined
//                   │──timeout──▶ missed
//                   └──call ends─▶ cancelled
import { v4 as uuidv4 } from 'uuid';
import type { DatabaseAdapter } from '@/db/adapter';
import { SseManager } from '@/lib/sse';
import { listOnlineUsers, type OnlineUserSnapshot } from '@/lib/presence';
import { logger } from '@/lib/logger';
import { MAX_CALL_PARTICIPANTS } from '@/config/video-call';

export interface CallActor {
  userId: string;
  name: string;
  hospitalCode: string;
  hospitalName: string;
}

export type VideoCallErrorCode =
  'NO_INVITEES' | 'BUSY' | 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_STATE';

export class VideoCallError extends Error {
  constructor(
    readonly code: VideoCallErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'VideoCallError';
  }
}

export type SkipReason = 'self' | 'duplicate' | 'offline' | 'busy' | 'limit';

export interface SkippedInvitee {
  userId: string;
  reason: SkipReason;
}

export interface InviteResult {
  invited: CallActor[];
  skipped: SkippedInvitee[];
}

export interface CreatedCall extends InviteResult {
  callId: string;
  roomId: string;
}

export interface CallParticipantView {
  userId: string;
  name: string;
  hospitalCode: string;
  hospitalName: string;
  role: string;
  status: string;
}

export interface VideoCallView {
  callId: string;
  roomId: string;
  status: string;
  createdByUserId: string;
  createdByName: string;
  participants: CallParticipantView[];
}

interface CallHeaderRow {
  id: string;
  room_id: string;
  status: string;
  created_by_user_id: string;
  created_by_name: string;
}

interface ParticipantRow {
  id: string;
  call_id: string;
  user_id: string;
  name: string;
  hospital_code: string;
  hospital_name: string;
  role: string;
  status: string;
}

const DEFAULT_RING_TIMEOUT_MS = 45_000;
// A ring older than this has lost its in-process timer (redeploy mid-ring).
const STALE_RING_MS = 2 * 60_000;
// A joined participant absent from Redis presence for this long is gone
// (crashed browser / closed laptop) — they must not hold the call open.
// The room page sends its own presence heartbeats to stay visible.
const STALE_JOIN_MS = 3 * 60_000;

// Ring timers must survive Next.js bundle duplication/HMR just like the DB
// singleton, otherwise accept() in one bundle can't clear the timer armed by
// createCall() in another. Keyed by `${callId}:${userId}`.
const _global = globalThis as unknown as { __videoCallTimers?: Map<string, NodeJS.Timeout> };
const _timers: Map<string, NodeJS.Timeout> = _global.__videoCallTimers ?? new Map();
if (!_global.__videoCallTimers) _global.__videoCallTimers = _timers;

export function clearCallTimersForTests(): void {
  for (const timer of _timers.values()) clearTimeout(timer);
  _timers.clear();
}

export async function createCall(
  db: DatabaseAdapter,
  creator: CallActor,
  calleeUserIds: string[],
  options: { ringTimeoutMs?: number } = {},
): Promise<CreatedCall> {
  await sweepStaleParticipants(db);

  const evaluation = await evaluateInvitees(db, creator.userId, null, calleeUserIds, 1);
  if (evaluation.candidates.length === 0) {
    throw new VideoCallError(
      'NO_INVITEES',
      'ไม่มีผู้ใช้ที่สามารถเชิญได้ — ผู้ที่เลือกอาจออฟไลน์ สายไม่ว่าง หรือเป็นตัวคุณเอง',
    );
  }

  const callId = uuidv4();
  const roomId = `kklrms-${uuidv4()}`;
  await db.transaction(async (tx) => {
    // Serialize per-creator creation: concurrent createCall() calls for the
    // same user queue on this xact-scoped advisory lock instead of both
    // passing the isBusy check and each creating an active call.
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext(?))`, [creator.userId]);
    if (await isBusy(tx, creator.userId)) {
      throw new VideoCallError(
        'BUSY',
        'คุณมีสายที่กำลังสนทนาหรือกำลังเรียกอยู่ กรุณาวางสายเดิมก่อนเริ่มสายใหม่',
      );
    }
    await tx.execute(
      `INSERT INTO video_calls
         (id, room_id, created_by_user_id, created_by_name, created_by_hospital_code, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', NOW())`,
      [callId, roomId, creator.userId, creator.name, creator.hospitalCode],
    );
    await tx.execute(
      `INSERT INTO video_call_participants
         (id, call_id, user_id, name, hospital_code, hospital_name, role, status,
          invited_by_user_id, invited_at, joined_at)
       VALUES (?, ?, ?, ?, ?, ?, 'creator', 'joined', ?, NOW(), NOW())`,
      [
        uuidv4(),
        callId,
        creator.userId,
        creator.name,
        creator.hospitalCode,
        creator.hospitalName,
        creator.userId,
      ],
    );
    await persistRingRows(tx, callId, creator, evaluation.candidates);
  });

  // Timers/SSE only after the transaction commits — a rolled-back call must
  // never arm a ring timer or notify anyone.
  const invited = await announceRings(
    db,
    { id: callId, roomId },
    creator,
    evaluation.candidates,
    options.ringTimeoutMs ?? DEFAULT_RING_TIMEOUT_MS,
  );

  return { callId, roomId, invited, skipped: evaluation.skipped };
}

export async function inviteToCall(
  db: DatabaseAdapter,
  callId: string,
  actor: CallActor,
  calleeUserIds: string[],
  options: { ringTimeoutMs?: number } = {},
): Promise<InviteResult> {
  await sweepStaleParticipants(db);

  const header = await loadHeader(db, callId);
  if (header.status !== 'active') {
    throw new VideoCallError('INVALID_STATE', 'สายนี้สิ้นสุดแล้ว ไม่สามารถเชิญผู้เข้าร่วมเพิ่มได้');
  }
  const me = await loadParticipant(db, callId, actor.userId);
  if (!me || me.status !== 'joined') {
    throw new VideoCallError('FORBIDDEN', 'ต้องเข้าร่วมสายนี้อยู่จึงจะเชิญผู้อื่นได้');
  }

  const current = await countActiveParticipants(db, callId);
  const evaluation = await evaluateInvitees(db, actor.userId, callId, calleeUserIds, current);
  if (evaluation.candidates.length === 0) {
    return { invited: [], skipped: evaluation.skipped };
  }

  await db.transaction(async (tx) => {
    await persistRingRows(tx, callId, actor, evaluation.candidates);
  });
  const invited = await announceRings(
    db,
    { id: header.id, roomId: header.room_id },
    actor,
    evaluation.candidates,
    options.ringTimeoutMs ?? DEFAULT_RING_TIMEOUT_MS,
  );
  return { invited, skipped: evaluation.skipped };
}

export async function acceptInvite(
  db: DatabaseAdapter,
  callId: string,
  actor: CallActor,
): Promise<{ roomId: string }> {
  const header = await loadHeader(db, callId);
  if (header.status !== 'active') {
    throw new VideoCallError('INVALID_STATE', 'สายนี้สิ้นสุดแล้ว ไม่สามารถรับสายได้');
  }

  const won = await db.query<{ id: string; name: string }>(
    `UPDATE video_call_participants
        SET status = 'joined', joined_at = NOW(), left_at = NULL
      WHERE call_id = ? AND user_id = ? AND status = 'ringing'
      RETURNING id, name`,
    [callId, actor.userId],
  );
  if (won.length === 0) {
    // Covers both a stranger (no participant row → FORBIDDEN) and a
    // participant whose state already moved on (double-accept, decline,
    // timeout, cancel → INVALID_STATE).
    const me = await requireParticipant(db, callId, actor.userId);
    throw new VideoCallError('INVALID_STATE', `ไม่สามารถรับสายได้ — สถานะของคุณคือ "${me.status}"`);
  }
  clearRingTimer(callId, actor.userId); // ONLY after the DB transition wins

  await notifyJoined(
    db,
    callId,
    'call:participant-joined',
    { callId, userId: actor.userId, name: won[0].name },
    actor.userId,
  );
  SseManager.getInstance().sendToUser(actor.userId, 'call:resolved', {
    callId,
    status: 'joined',
  });
  return { roomId: header.room_id };
}

export async function declineInvite(
  db: DatabaseAdapter,
  callId: string,
  actor: CallActor,
): Promise<void> {
  const header = await loadHeader(db, callId);
  if (header.status !== 'active') {
    throw new VideoCallError('INVALID_STATE', 'สายนี้สิ้นสุดแล้ว');
  }

  const won = await db.query<{ id: string; name: string }>(
    `UPDATE video_call_participants
        SET status = 'declined', left_at = NOW()
      WHERE call_id = ? AND user_id = ? AND status = 'ringing'
      RETURNING id, name`,
    [callId, actor.userId],
  );
  if (won.length === 0) {
    const me = await requireParticipant(db, callId, actor.userId);
    if (me.status === 'declined') return; // idempotent duplicate
    throw new VideoCallError(
      'INVALID_STATE',
      `ไม่สามารถปฏิเสธสายได้ — สถานะของคุณคือ "${me.status}"`,
    );
  }
  clearRingTimer(callId, actor.userId); // ONLY after the DB transition wins

  await notifyJoined(
    db,
    callId,
    'call:participant-declined',
    { callId, userId: actor.userId, name: won[0].name },
    actor.userId,
  );
  SseManager.getInstance().sendToUser(actor.userId, 'call:resolved', {
    callId,
    status: 'declined',
  });
}

export async function leaveCall(
  db: DatabaseAdapter,
  callId: string,
  actor: CallActor,
): Promise<void> {
  const header = await loadHeader(db, callId);

  const won = await db.query<{ id: string; name: string }>(
    `UPDATE video_call_participants
        SET status = 'left', left_at = NOW()
      WHERE call_id = ? AND user_id = ? AND status = 'joined'
      RETURNING id, name`,
    [callId, actor.userId],
  );
  if (won.length === 0) {
    const me = await requireParticipant(db, callId, actor.userId);
    if (me.status === 'left') return; // idempotent duplicate
    throw new VideoCallError('INVALID_STATE', 'คุณไม่ได้อยู่ในสายนี้แล้ว');
  }

  const remaining = await countJoined(db, callId);
  if (remaining === 0) {
    await endCall(db, header);
  } else {
    await notifyJoined(
      db,
      callId,
      'call:participant-left',
      { callId, userId: actor.userId, name: won[0].name },
      actor.userId,
    );
  }
}

/** Participant-guarded read for the room page: header + everyone's status.
 *  Only ringing/joined participants may look — the room id is the Jitsi
 *  access control and must not leak to declined/left users or strangers. */
export async function getCall(
  db: DatabaseAdapter,
  callId: string,
  userId: string,
): Promise<VideoCallView> {
  const header = await loadHeader(db, callId);
  const me = await loadParticipant(db, callId, userId);
  if (!me || (me.status !== 'ringing' && me.status !== 'joined')) {
    throw new VideoCallError(
      'FORBIDDEN',
      'คุณไม่ใช่ผู้ร่วมสนทนาของสายนี้ หรือสายนี้สิ้นสุดแล้วสำหรับคุณ',
    );
  }
  if (me.status === 'joined') {
    // Room liveness: the room page polls this endpoint every 15 s. The
    // stale-join sweep releases joined rows whose liveness went quiet, so a
    // lost leave (aborted fetch, crashed browser) can't hold anyone "busy".
    await db.execute(`UPDATE video_call_participants SET last_seen_at = NOW() WHERE id = ?`, [
      me.id,
    ]);
  }
  const participants = await db.query<ParticipantRow>(
    `SELECT * FROM video_call_participants WHERE call_id = ? ORDER BY invited_at, user_id`,
    [callId],
  );
  return {
    callId: header.id,
    roomId: header.room_id,
    status: header.status,
    createdByUserId: header.created_by_user_id,
    createdByName: header.created_by_name,
    participants: participants.map((row) => ({
      userId: row.user_id,
      name: row.name,
      hospitalCode: row.hospital_code,
      hospitalName: row.hospital_name,
      role: row.role,
      status: row.status,
    })),
  };
}

export interface DirectoryUser {
  userId: string;
  name: string;
  role: string;
}

export interface DirectoryHospital {
  hospitalCode: string;
  hospitalName: string;
  users: DirectoryUser[];
}

/** Online users grouped by hospital — who can be called right now. The
 *  requesting user is excluded (you cannot call yourself). */
export async function getCallDirectory(requestingUserId: string): Promise<DirectoryHospital[]> {
  const online = await listOnlineUsers();
  const byHospital = new Map<string, DirectoryHospital>();
  for (const user of online) {
    if (user.userId === requestingUserId) continue;
    let hospital = byHospital.get(user.hospitalCode);
    if (!hospital) {
      hospital = { hospitalCode: user.hospitalCode, hospitalName: user.hospitalName, users: [] };
      byHospital.set(user.hospitalCode, hospital);
    }
    hospital.users.push({ userId: user.userId, name: user.name, role: user.role });
  }
  return Array.from(byHospital.values())
    .map((hospital) => ({
      ...hospital,
      users: hospital.users.sort((a, b) => a.name.localeCompare(b.name, 'th')),
    }))
    .sort((a, b) => a.hospitalName.localeCompare(b.hospitalName, 'th'));
}

// ---------------------------------------------------------------------------
// internals

interface EvaluatedInvitees {
  candidates: OnlineUserSnapshot[];
  skipped: SkippedInvitee[];
}

async function evaluateInvitees(
  db: DatabaseAdapter,
  inviterUserId: string,
  callId: string | null,
  calleeUserIds: string[],
  currentCount: number,
): Promise<EvaluatedInvitees> {
  const online = new Map((await listOnlineUsers()).map((user) => [user.userId, user]));
  const busy = await findBusyUsers(db, calleeUserIds, callId);
  const alreadyInCall = callId ? await activeUserIdsInCall(db, callId) : new Set<string>();

  const seen = new Set<string>();
  const skipped: SkippedInvitee[] = [];
  const candidates: OnlineUserSnapshot[] = [];
  let count = currentCount;

  for (const userId of calleeUserIds) {
    if (userId === inviterUserId) {
      skipped.push({ userId, reason: 'self' });
      continue;
    }
    if (seen.has(userId) || alreadyInCall.has(userId)) {
      skipped.push({ userId, reason: 'duplicate' });
      continue;
    }
    seen.add(userId);
    const presence = online.get(userId);
    if (!presence) {
      skipped.push({ userId, reason: 'offline' });
      continue;
    }
    if (busy.has(userId)) {
      skipped.push({ userId, reason: 'busy' });
      continue;
    }
    if (count >= MAX_CALL_PARTICIPANTS) {
      skipped.push({ userId, reason: 'limit' });
      continue;
    }
    count += 1;
    candidates.push(presence);
  }
  return { candidates, skipped };
}

// DB half of ringing a batch of candidates: one atomic upsert per candidate,
// race-safe against a concurrent identical invite via the unique
// (call_id, user_id) index (migrateVideoCallParticipantsUnique /
// uq_vcp_call_user). Must run inside the caller's transaction — no
// timers/SSE here, those only fire after commit (see announceRings).
async function persistRingRows(
  tx: DatabaseAdapter,
  callId: string,
  inviter: CallActor,
  candidates: OnlineUserSnapshot[],
): Promise<void> {
  for (const presence of candidates) {
    // Re-invite after decline/miss/leave (or a duplicate concurrent invite)
    // flips the same row back to ringing instead of inserting a second one.
    await tx.execute(
      `INSERT INTO video_call_participants
         (id, call_id, user_id, name, hospital_code, hospital_name, role, status,
          invited_by_user_id, invited_at)
       VALUES (?, ?, ?, ?, ?, ?, 'invitee', 'ringing', ?, NOW())
       ON CONFLICT (call_id, user_id) DO UPDATE SET
         status = 'ringing',
         invited_by_user_id = EXCLUDED.invited_by_user_id,
         invited_at = NOW(),
         joined_at = NULL,
         left_at = NULL`,
      [
        uuidv4(),
        callId,
        presence.userId,
        presence.name,
        presence.hospitalCode,
        presence.hospitalName,
        inviter.userId,
      ],
    );
  }
}

// Post-commit half: arm ring timers and fan out SSE invites. Takes the
// caller's outer `db` (never a tx adapter — these fire well after the
// transaction that persisted the rows has committed or rolled back).
async function announceRings(
  db: DatabaseAdapter,
  call: { id: string; roomId: string },
  inviter: CallActor,
  candidates: OnlineUserSnapshot[],
  ringTimeoutMs: number,
): Promise<CallActor[]> {
  const invited: CallActor[] = [];
  for (const presence of candidates) {
    armRingTimer(db, call.id, presence.userId, ringTimeoutMs);
    invited.push({
      userId: presence.userId,
      name: presence.name,
      hospitalCode: presence.hospitalCode,
      hospitalName: presence.hospitalName,
    });
  }

  const participantCount = await countActiveParticipants(db, call.id);
  const sse = SseManager.getInstance();
  for (const target of invited) {
    sse.sendToUser(target.userId, 'call:invite', {
      callId: call.id,
      roomId: call.roomId,
      inviter,
      participantCount,
    });
  }
  return invited;
}

function armRingTimer(
  db: DatabaseAdapter,
  callId: string,
  userId: string,
  ringTimeoutMs: number,
): void {
  const key = `${callId}:${userId}`;
  const existing = _timers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    ringTimeout(db, callId, userId).catch((error) => {
      logger.warn('video_call_ring_timeout_failed', { callId, userId, error });
    });
  }, ringTimeoutMs);
  timer.unref?.();
  _timers.set(key, timer);
}

async function ringTimeout(db: DatabaseAdapter, callId: string, userId: string): Promise<void> {
  _timers.delete(`${callId}:${userId}`);
  const won = await db.query<{ id: string; name: string }>(
    `UPDATE video_call_participants AS p
        SET status = 'missed', left_at = NOW()
       FROM video_calls c
      WHERE c.id = p.call_id AND c.status = 'active'
        AND p.call_id = ? AND p.user_id = ? AND p.status = 'ringing'
      RETURNING p.id, p.name`,
    [callId, userId],
  );
  if (won.length === 0) return; // answered/declined/cancelled first

  await notifyJoined(db, callId, 'call:participant-missed', {
    callId,
    userId,
    name: won[0].name,
  });
  SseManager.getInstance().sendToUser(userId, 'call:resolved', { callId, status: 'missed' });
  await endCallIfEmpty(db, callId);
}

async function endCall(db: DatabaseAdapter, header: CallHeaderRow): Promise<void> {
  const won = await db.query<{ id: string }>(
    `UPDATE video_calls SET status = 'ended', ended_at = NOW()
      WHERE id = ? AND status = 'active' RETURNING id`,
    [header.id],
  );
  if (won.length === 0) return; // a concurrent leaver/timeout already ended it

  const stillRinging = await db.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM video_call_participants WHERE call_id = ? AND status = 'ringing'`,
    [header.id],
  );
  const sse = SseManager.getInstance();
  for (const ring of stillRinging) {
    clearRingTimer(header.id, ring.user_id);
    await db.execute(
      `UPDATE video_call_participants SET status = 'cancelled', left_at = NOW() WHERE id = ?`,
      [ring.id],
    );
    sse.sendToUser(ring.user_id, 'call:cancelled', { callId: header.id });
  }
}

async function endCallIfEmpty(db: DatabaseAdapter, callId: string): Promise<void> {
  const active = await countActiveParticipants(db, callId);
  if (active === 0) {
    await db.execute(
      `UPDATE video_calls SET status = 'ended', ended_at = NOW() WHERE id = ? AND status = 'active'`,
      [callId],
    );
  }
}

// Self-healing: release participants whose browser/server died so nobody
// stays "busy" (or keeps a call open) forever.
async function sweepStaleParticipants(db: DatabaseAdapter): Promise<void> {
  await db.execute(
    `UPDATE video_call_participants SET status = 'missed', left_at = NOW()
      WHERE status = 'ringing'
        AND invited_at < NOW() - INTERVAL '${STALE_RING_MS / 1000} seconds'`,
  );

  // Joined rows with quiet room liveness are gone: the room page stamps
  // last_seen_at via its 15 s getCall poll, so several minutes of silence
  // means the room tab is closed/crashed — even if the user is still online
  // elsewhere in the app (the 2026-07-11 stuck-busy incident).
  await db.execute(
    `UPDATE video_call_participants SET status = 'left', left_at = NOW()
      WHERE status = 'joined'
        AND joined_at < NOW() - INTERVAL '${STALE_JOIN_MS / 1000} seconds'
        AND (last_seen_at IS NULL OR last_seen_at < NOW() - INTERVAL '${STALE_JOIN_MS / 1000} seconds')
        AND call_id IN (SELECT id FROM video_calls WHERE status = 'active')`,
  );

  // Calls with nobody joined and nobody ringing are over.
  await db.execute(
    `UPDATE video_calls SET status = 'ended', ended_at = NOW()
      WHERE status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM video_call_participants p
           WHERE p.call_id = video_calls.id AND p.status IN ('ringing', 'joined'))`,
  );
}

async function isBusy(db: DatabaseAdapter, userId: string): Promise<boolean> {
  const busy = await findBusyUsers(db, [userId], null);
  return busy.has(userId);
}

/** Users with a live (ringing/joined) participation on any active call.
 *  excludeCallId: participations on that call are handled as 'duplicate'. */
async function findBusyUsers(
  db: DatabaseAdapter,
  userIds: string[],
  excludeCallId: string | null,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const placeholders = userIds.map(() => '?').join(', ');
  const params: unknown[] = [...userIds];
  let excludeClause = '';
  if (excludeCallId) {
    excludeClause = 'AND p.call_id != ?';
    params.push(excludeCallId);
  }
  const rows = await db.query<{ user_id: string }>(
    `SELECT DISTINCT p.user_id
       FROM video_call_participants p
       JOIN video_calls c ON c.id = p.call_id AND c.status = 'active'
      WHERE p.status IN ('ringing', 'joined')
        AND p.user_id IN (${placeholders}) ${excludeClause}`,
    params,
  );
  return new Set(rows.map((row) => row.user_id));
}

async function activeUserIdsInCall(db: DatabaseAdapter, callId: string): Promise<Set<string>> {
  const rows = await db.query<{ user_id: string }>(
    `SELECT user_id FROM video_call_participants
      WHERE call_id = ? AND status IN ('ringing', 'joined')`,
    [callId],
  );
  return new Set(rows.map((row) => row.user_id));
}

async function countActiveParticipants(db: DatabaseAdapter, callId: string): Promise<number> {
  const rows = await db.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM video_call_participants
      WHERE call_id = ? AND status IN ('ringing', 'joined')`,
    [callId],
  );
  return Number(rows[0]?.n ?? 0);
}

async function countJoined(db: DatabaseAdapter, callId: string): Promise<number> {
  const rows = await db.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM video_call_participants WHERE call_id = ? AND status = 'joined'`,
    [callId],
  );
  return Number(rows[0]?.n ?? 0);
}

async function notifyJoined(
  db: DatabaseAdapter,
  callId: string,
  event: string,
  payload: Record<string, unknown>,
  excludeUserId?: string,
): Promise<void> {
  const rows = await db.query<{ user_id: string }>(
    `SELECT user_id FROM video_call_participants WHERE call_id = ? AND status = 'joined'`,
    [callId],
  );
  const sse = SseManager.getInstance();
  for (const row of rows) {
    if (row.user_id === excludeUserId) continue;
    sse.sendToUser(row.user_id, event, payload);
  }
}

async function loadHeader(db: DatabaseAdapter, callId: string): Promise<CallHeaderRow> {
  const rows = await db.query<CallHeaderRow>('SELECT * FROM video_calls WHERE id = ?', [callId]);
  if (rows.length === 0) {
    throw new VideoCallError('NOT_FOUND', 'ไม่พบข้อมูลสายนี้ อาจถูกยกเลิกไปแล้ว');
  }
  return rows[0];
}

async function loadParticipant(
  db: DatabaseAdapter,
  callId: string,
  userId: string,
): Promise<ParticipantRow | null> {
  const rows = await db.query<ParticipantRow>(
    'SELECT * FROM video_call_participants WHERE call_id = ? AND user_id = ?',
    [callId, userId],
  );
  return rows[0] ?? null;
}

async function requireParticipant(
  db: DatabaseAdapter,
  callId: string,
  userId: string,
): Promise<ParticipantRow> {
  const participant = await loadParticipant(db, callId, userId);
  if (!participant) {
    throw new VideoCallError('FORBIDDEN', 'คุณไม่ใช่ผู้ร่วมสนทนาของสายนี้');
  }
  return participant;
}

function clearRingTimer(callId: string, userId: string): void {
  const key = `${callId}:${userId}`;
  const timer = _timers.get(key);
  if (timer) {
    clearTimeout(timer);
    _timers.delete(key);
  }
}
