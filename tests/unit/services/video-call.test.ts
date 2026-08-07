// Unified group-call service: header (active → ended) + per-participant
// lifecycle (ringing → joined/declined/missed/cancelled → left). Real PGlite,
// real in-memory presence, real SseManager with captured controllers.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Session } from 'next-auth';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SseManager } from '@/lib/sse';
import { recordOnlineUser } from '@/lib/presence';
import { cacheDelPattern } from '@/lib/cache';
import { MAX_CALL_PARTICIPANTS } from '@/config/video-call';
import { FailingAdapter } from '../../helpers/failingDb';
import {
  createCall,
  inviteToCall,
  acceptInvite,
  declineInvite,
  leaveCall,
  getCall,
  VideoCallError,
  clearCallTimersForTests,
  type CallActor,
} from '@/services/video-call';

const CREATOR: CallActor = {
  userId: 'user-creator',
  name: 'พญ.ต้นทาง ทดสอบ',
  hospitalCode: '10670',
  hospitalName: 'รพ.ขอนแก่น',
};
const INVITEE_B: CallActor = {
  userId: 'user-b',
  name: 'นพ.สอง ทดสอบ',
  hospitalCode: '11004',
  hospitalName: 'รพ.น้ำพอง',
};
const INVITEE_C: CallActor = {
  userId: 'user-c',
  name: 'นส.สาม ทดสอบ',
  hospitalCode: '11005',
  hospitalName: 'รพ.ชนบท',
};

function fakeSession(actor: CallActor): Session {
  return {
    user: {
      id: actor.userId,
      name: actor.name,
      role: 'user',
      hospitalCode: actor.hospitalCode,
      hospitalName: actor.hospitalName,
      authProvider: 'test',
      accessMode: 'full',
    },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  } as unknown as Session;
}

interface CapturedEvent {
  event: string;
  data: Record<string, unknown>;
}

function connectTab(userId: string, tabId: string) {
  const chunks: Uint8Array[] = [];
  const controller = {
    enqueue: (chunk: Uint8Array) => chunks.push(chunk),
    close: () => {},
  } as unknown as ReadableStreamDefaultController;
  SseManager.getInstance().addClient(tabId, controller, userId);
  return {
    events(): CapturedEvent[] {
      const decoder = new TextDecoder();
      const text = chunks.map((c) => decoder.decode(c)).join('');
      return text
        .split('\n\n')
        .filter((block) => block.startsWith('event: '))
        .map((block) => {
          const [eventLine, dataLine] = block.split('\n');
          return {
            event: eventLine.replace('event: ', ''),
            data: JSON.parse(dataLine.replace('data: ', '')),
          };
        });
    },
  };
}

async function allOnline(...actors: CallActor[]): Promise<void> {
  for (const actor of actors) await recordOnlineUser(fakeSession(actor));
}

async function participantStatus(
  db: DatabaseAdapter,
  callId: string,
  userId: string,
): Promise<string | undefined> {
  const rows = await db.query<{ status: string }>(
    'SELECT status FROM video_call_participants WHERE call_id = ? AND user_id = ?',
    [callId, userId],
  );
  return rows[0]?.status;
}

async function headerStatus(db: DatabaseAdapter, callId: string): Promise<string | undefined> {
  const rows = await db.query<{ status: string }>('SELECT status FROM video_calls WHERE id = ?', [
    callId,
  ]);
  return rows[0]?.status;
}

describe('group video-call service', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = await createTestDb();
    SseManager.resetForTests();
    clearCallTimersForTests();
    await cacheDelPattern('presence:users:*');
  });

  describe('createCall', () => {
    it('creates an active header, joined creator, ringing invitees', async () => {
      await allOnline(CREATOR, INVITEE_B, INVITEE_C);
      const call = await createCall(db, CREATOR, [INVITEE_B.userId, INVITEE_C.userId]);

      expect(call.roomId).toMatch(/^kklrms-[0-9a-f-]{36}$/);
      expect(call.invited.map((i) => i.userId).sort()).toEqual(['user-b', 'user-c']);
      expect(call.skipped).toEqual([]);

      expect(await headerStatus(db, call.callId)).toBe('active');
      expect(await participantStatus(db, call.callId, CREATOR.userId)).toBe('joined');
      expect(await participantStatus(db, call.callId, INVITEE_B.userId)).toBe('ringing');
      expect(await participantStatus(db, call.callId, INVITEE_C.userId)).toBe('ringing');
    });

    it('rings every invitee tab with inviter identity and room id', async () => {
      await allOnline(CREATOR, INVITEE_B, INVITEE_C);
      const tabB = connectTab(INVITEE_B.userId, 'tab-b');
      const tabC = connectTab(INVITEE_C.userId, 'tab-c');

      const call = await createCall(db, CREATOR, [INVITEE_B.userId, INVITEE_C.userId]);

      for (const tab of [tabB, tabC]) {
        const invites = tab.events().filter((e) => e.event === 'call:invite');
        expect(invites).toHaveLength(1);
        expect(invites[0].data.callId).toBe(call.callId);
        expect(invites[0].data.roomId).toBe(call.roomId);
        expect((invites[0].data.inviter as CallActor).name).toBe(CREATOR.name);
        expect(invites[0].data.participantCount).toBe(3);
      }
    });

    it('throws NO_INVITEES when every target is busy, offline, duplicate or self', async () => {
      await allOnline(CREATOR, INVITEE_B, INVITEE_C);
      await createCall(db, INVITEE_C, [INVITEE_B.userId]); // B now ringing-busy
      await expect(
        createCall(db, CREATOR, [
          INVITEE_B.userId, // busy
          'user-ghost', // offline
          INVITEE_B.userId, // duplicate
          CREATOR.userId, // self
        ]),
      ).rejects.toMatchObject({ code: 'NO_INVITEES' });
    });

    it('partially invites: online user in, offline user skipped with reason', async () => {
      await allOnline(CREATOR, INVITEE_B);
      const call = await createCall(db, CREATOR, [INVITEE_B.userId, 'user-ghost']);

      expect(call.invited.map((i) => i.userId)).toEqual([INVITEE_B.userId]);
      expect(call.skipped).toEqual([{ userId: 'user-ghost', reason: 'offline' }]);
    });

    it('rejects a busy creator', async () => {
      await allOnline(CREATOR, INVITEE_B, INVITEE_C);
      await createCall(db, CREATOR, [INVITEE_B.userId]);
      await expect(createCall(db, CREATOR, [INVITEE_C.userId])).rejects.toMatchObject({
        code: 'BUSY',
      });
    });

    it('caps participants at MAX_CALL_PARTICIPANTS and skips the excess as limit', async () => {
      const extras: CallActor[] = Array.from({ length: MAX_CALL_PARTICIPANTS }, (_, i) => ({
        userId: `user-extra-${i}`,
        name: `ผู้ใช้ ${i}`,
        hospitalCode: '11004',
        hospitalName: 'รพ.น้ำพอง',
      }));
      await allOnline(CREATOR, ...extras);

      const call = await createCall(
        db,
        CREATOR,
        extras.map((e) => e.userId),
      );
      // creator + invitees ≤ MAX ⇒ MAX-1 invited, 1 skipped for the limit.
      expect(call.invited).toHaveLength(MAX_CALL_PARTICIPANTS - 1);
      expect(call.skipped).toEqual([
        { userId: `user-extra-${MAX_CALL_PARTICIPANTS - 1}`, reason: 'limit' },
      ]);
    });

    it('self-heals: stale rings and liveness-dead joined participants stop blocking calls', async () => {
      // user-x stays ONLINE (presence) — the prod incident: a user whose
      // leave was lost stayed "joined" on an active call forever because the
      // old sweep only released offline users. Liveness (last_seen_at,
      // stamped by the room page's 15 s poll) is the authority now.
      const userX: CallActor = {
        userId: 'user-x',
        name: 'X',
        hospitalCode: '11004',
        hospitalName: 'รพ.น้ำพอง',
      };
      await allOnline(CREATOR, INVITEE_B, userX);
      await db.execute(
        `INSERT INTO video_calls (id, room_id, created_by_user_id, created_by_name, created_by_hospital_code, status, created_at)
         VALUES ('aaaaaaaa-0000-4000-8000-00000000000a', 'kklrms-stale', 'user-x', 'X', '11004', 'active', NOW() - INTERVAL '10 minutes')`,
      );
      await db.execute(
        `INSERT INTO video_call_participants (id, call_id, user_id, name, hospital_code, hospital_name, role, status, invited_by_user_id, invited_at, joined_at, last_seen_at)
         VALUES
          ('aaaaaaaa-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-00000000000a', 'user-x', 'X', '11004', 'รพ.น้ำพอง', 'creator', 'joined', 'user-x', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes', NULL),
          ('aaaaaaaa-0000-4000-8000-00000000000c', 'aaaaaaaa-0000-4000-8000-00000000000a', ?, ?, ?, ?, 'invitee', 'ringing', 'user-x', NOW() - INTERVAL '10 minutes', NULL, NULL)`,
        [INVITEE_B.userId, INVITEE_B.name, INVITEE_B.hospitalCode, INVITEE_B.hospitalName],
      );

      // user-x has no room liveness (last_seen_at NULL, joined long ago) and
      // INVITEE_B's ring is stale — both must be released even though user-x
      // is still online elsewhere in the app.
      const call = await createCall(db, CREATOR, [INVITEE_B.userId]);
      expect(call.invited.map((i) => i.userId)).toEqual([INVITEE_B.userId]);

      expect(
        await participantStatus(db, 'aaaaaaaa-0000-4000-8000-00000000000a', INVITEE_B.userId),
      ).toBe('missed');
      expect(await participantStatus(db, 'aaaaaaaa-0000-4000-8000-00000000000a', 'user-x')).toBe(
        'left',
      );
      expect(await headerStatus(db, 'aaaaaaaa-0000-4000-8000-00000000000a')).toBe('ended');
    });

    it('does not sweep joined participants with fresh room liveness', async () => {
      const userX: CallActor = {
        userId: 'user-x',
        name: 'X',
        hospitalCode: '11004',
        hospitalName: 'รพ.น้ำพอง',
      };
      await allOnline(CREATOR, INVITEE_B, userX);
      await db.execute(
        `INSERT INTO video_calls (id, room_id, created_by_user_id, created_by_name, created_by_hospital_code, status, created_at)
         VALUES ('bbbbbbbb-0000-4000-8000-00000000000a', 'kklrms-live', 'user-x', 'X', '11004', 'active', NOW() - INTERVAL '10 minutes')`,
      );
      await db.execute(
        `INSERT INTO video_call_participants (id, call_id, user_id, name, hospital_code, hospital_name, role, status, invited_by_user_id, invited_at, joined_at, last_seen_at)
         VALUES ('bbbbbbbb-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-00000000000a', 'user-x', 'X', '11004', 'รพ.น้ำพอง', 'creator', 'joined', 'user-x', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes', NOW())`,
      );

      // user-x's room page polled recently (last_seen_at fresh) → still in
      // the call → busy → inviting them is skipped.
      const call = await createCall(db, CREATOR, [INVITEE_B.userId, 'user-x']);
      expect(call.skipped).toEqual([{ userId: 'user-x', reason: 'busy' }]);
      expect(await participantStatus(db, 'bbbbbbbb-0000-4000-8000-00000000000a', 'user-x')).toBe(
        'joined',
      );
    });
  });

  describe('accept / decline', () => {
    it('accept joins the invitee, notifies joined peers, resolves own tabs', async () => {
      await allOnline(CREATOR, INVITEE_B);
      const creatorTab = connectTab(CREATOR.userId, 'tab-creator');
      const call = await createCall(db, CREATOR, [INVITEE_B.userId]);
      const inviteeOtherTab = connectTab(INVITEE_B.userId, 'tab-b2');

      const result = await acceptInvite(db, call.callId, INVITEE_B);
      expect(result.roomId).toBe(call.roomId);
      expect(await participantStatus(db, call.callId, INVITEE_B.userId)).toBe('joined');

      const joinedEvents = creatorTab.events().filter((e) => e.event === 'call:participant-joined');
      expect(joinedEvents).toHaveLength(1);
      expect(joinedEvents[0].data.userId).toBe(INVITEE_B.userId);

      const resolved = inviteeOtherTab.events().filter((e) => e.event === 'call:resolved');
      expect(resolved).toHaveLength(1);
    });

    it('only a ringing participant may accept; double-accept is INVALID_STATE', async () => {
      await allOnline(CREATOR, INVITEE_B);
      const call = await createCall(db, CREATOR, [INVITEE_B.userId]);

      await expect(acceptInvite(db, call.callId, INVITEE_C)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await acceptInvite(db, call.callId, INVITEE_B);
      await expect(acceptInvite(db, call.callId, INVITEE_B)).rejects.toMatchObject({
        code: 'INVALID_STATE',
      });
    });

    it('decline marks the participant declined and notifies joined peers', async () => {
      await allOnline(CREATOR, INVITEE_B);
      const creatorTab = connectTab(CREATOR.userId, 'tab-creator');
      const call = await createCall(db, CREATOR, [INVITEE_B.userId]);

      await declineInvite(db, call.callId, INVITEE_B);
      expect(await participantStatus(db, call.callId, INVITEE_B.userId)).toBe('declined');
      expect(creatorTab.events().some((e) => e.event === 'call:participant-declined')).toBe(true);
      // Call stays active — the creator is still in the room deciding what to do.
      expect(await headerStatus(db, call.callId)).toBe('active');
    });
  });

  describe('leave', () => {
    it('a joined participant leaving notifies peers; the call stays active', async () => {
      await allOnline(CREATOR, INVITEE_B);
      const call = await createCall(db, CREATOR, [INVITEE_B.userId]);
      await acceptInvite(db, call.callId, INVITEE_B);
      const creatorTab = connectTab(CREATOR.userId, 'tab-creator');

      await leaveCall(db, call.callId, INVITEE_B);
      expect(await participantStatus(db, call.callId, INVITEE_B.userId)).toBe('left');
      expect(await headerStatus(db, call.callId)).toBe('active');
      expect(creatorTab.events().some((e) => e.event === 'call:participant-left')).toBe(true);
    });

    it('the last joined participant leaving ends the call and revokes pending rings', async () => {
      await allOnline(CREATOR, INVITEE_B, INVITEE_C);
      const call = await createCall(db, CREATOR, [INVITEE_B.userId, INVITEE_C.userId]);
      const ringingTab = connectTab(INVITEE_C.userId, 'tab-c');

      await leaveCall(db, call.callId, CREATOR);

      expect(await headerStatus(db, call.callId)).toBe('ended');
      expect(await participantStatus(db, call.callId, INVITEE_B.userId)).toBe('cancelled');
      expect(await participantStatus(db, call.callId, INVITEE_C.userId)).toBe('cancelled');
      expect(ringingTab.events().some((e) => e.event === 'call:cancelled')).toBe(true);
    });

    it('only joined participants can leave', async () => {
      await allOnline(CREATOR, INVITEE_B);
      const call = await createCall(db, CREATOR, [INVITEE_B.userId]);
      await expect(leaveCall(db, call.callId, INVITEE_B)).rejects.toMatchObject({
        code: 'INVALID_STATE',
      });
      await expect(leaveCall(db, call.callId, INVITEE_C)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  describe('ring timeout', () => {
    it('marks an unanswered invitee missed and notifies joined peers', async () => {
      await allOnline(CREATOR, INVITEE_B);
      const creatorTab = connectTab(CREATOR.userId, 'tab-creator');
      const call = await createCall(db, CREATOR, [INVITEE_B.userId], { ringTimeoutMs: 60 });

      await vi.waitFor(
        async () => {
          expect(await participantStatus(db, call.callId, INVITEE_B.userId)).toBe('missed');
        },
        { timeout: 5000, interval: 25 },
      );
      expect(creatorTab.events().some((e) => e.event === 'call:participant-missed')).toBe(true);
      // Creator remains in the room.
      expect(await headerStatus(db, call.callId)).toBe('active');
    });

    it('accepting clears the timer', async () => {
      await allOnline(CREATOR, INVITEE_B);
      const call = await createCall(db, CREATOR, [INVITEE_B.userId], { ringTimeoutMs: 60 });
      await acceptInvite(db, call.callId, INVITEE_B);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await participantStatus(db, call.callId, INVITEE_B.userId)).toBe('joined');
    });
  });

  describe('inviteToCall (mid-call add)', () => {
    it('a joined participant rings a new person into the active call', async () => {
      await allOnline(CREATOR, INVITEE_B, INVITEE_C);
      const call = await createCall(db, CREATOR, [INVITEE_B.userId]);
      await acceptInvite(db, call.callId, INVITEE_B);
      const tabC = connectTab(INVITEE_C.userId, 'tab-c');

      const result = await inviteToCall(db, call.callId, INVITEE_B, [INVITEE_C.userId]);
      expect(result.invited.map((i) => i.userId)).toEqual([INVITEE_C.userId]);
      expect(await participantStatus(db, call.callId, INVITEE_C.userId)).toBe('ringing');

      const invites = tabC.events().filter((e) => e.event === 'call:invite');
      expect(invites).toHaveLength(1);
      expect((invites[0].data.inviter as CallActor).userId).toBe(INVITEE_B.userId);
    });

    it('re-inviting someone who declined flips their row back to ringing', async () => {
      await allOnline(CREATOR, INVITEE_B);
      const call = await createCall(db, CREATOR, [INVITEE_B.userId]);
      await declineInvite(db, call.callId, INVITEE_B);

      const result = await inviteToCall(db, call.callId, CREATOR, [INVITEE_B.userId]);
      expect(result.invited.map((i) => i.userId)).toEqual([INVITEE_B.userId]);
      expect(await participantStatus(db, call.callId, INVITEE_B.userId)).toBe('ringing');

      const rows = await db.query<{ n: number }>(
        'SELECT COUNT(*) AS n FROM video_call_participants WHERE call_id = ? AND user_id = ?',
        [call.callId, INVITEE_B.userId],
      );
      expect(Number(rows[0].n)).toBe(1);
    });

    it('only joined participants may invite; ended calls reject invites', async () => {
      await allOnline(CREATOR, INVITEE_B, INVITEE_C);
      const call = await createCall(db, CREATOR, [INVITEE_B.userId]);

      // Still ringing — not yet joined — cannot invite.
      await expect(
        inviteToCall(db, call.callId, INVITEE_B, [INVITEE_C.userId]),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      await leaveCall(db, call.callId, CREATOR); // ends the call
      await expect(
        inviteToCall(db, call.callId, CREATOR, [INVITEE_C.userId]),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });
  });

  describe('getCall', () => {
    it('stamps room liveness (last_seen_at) for a joined requester', async () => {
      await allOnline(CREATOR, INVITEE_B);
      const call = await createCall(db, CREATOR, [INVITEE_B.userId]);

      await getCall(db, call.callId, CREATOR.userId);
      const rows = await db.query<{ last_seen_at: Date | null }>(
        'SELECT last_seen_at FROM video_call_participants WHERE call_id = ? AND user_id = ?',
        [call.callId, CREATOR.userId],
      );
      expect(rows[0].last_seen_at).not.toBeNull();
    });

    it('returns header + participants to ringing/joined participants only', async () => {
      await allOnline(CREATOR, INVITEE_B);
      const call = await createCall(db, CREATOR, [INVITEE_B.userId]);

      const forCreator = await getCall(db, call.callId, CREATOR.userId);
      expect(forCreator.roomId).toBe(call.roomId);
      expect(forCreator.participants).toHaveLength(2);
      const invitee = forCreator.participants.find((p) => p.userId === INVITEE_B.userId);
      expect(invitee?.status).toBe('ringing');
      expect(invitee?.hospitalName).toBe(INVITEE_B.hospitalName);

      // Ringing invitee may look (they hold the invite payload anyway).
      const forInvitee = await getCall(db, call.callId, INVITEE_B.userId);
      expect(forInvitee.roomId).toBe(call.roomId);

      await declineInvite(db, call.callId, INVITEE_B);
      await expect(getCall(db, call.callId, INVITEE_B.userId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(getCall(db, call.callId, 'user-stranger')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        getCall(db, '00000000-0000-4000-8000-000000000000', CREATOR.userId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  it('errors carry Thai actionable messages', async () => {
    await allOnline(CREATOR);
    try {
      await createCall(db, CREATOR, ['user-ghost']);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(VideoCallError);
      expect((error as Error).message).toMatch(/[ก-๙]/);
    }
  });

  describe('concurrency (Release C task C2)', () => {
    async function createRingingCallTo(invitee: CallActor): Promise<{ callId: string }> {
      await allOnline(CREATOR, invitee);
      const call = await createCall(db, CREATOR, [invitee.userId]);
      return { callId: call.callId };
    }

    async function createJoinedCallWith(invitee: CallActor): Promise<{ callId: string }> {
      const { callId } = await createRingingCallTo(invitee);
      await acceptInvite(db, callId, invitee);
      return { callId };
    }

    it('concurrent accept + decline: exactly one terminal participant state', async () => {
      const { callId } = await createRingingCallTo(INVITEE_B);
      const results = await Promise.allSettled([
        acceptInvite(db, callId, INVITEE_B),
        declineInvite(db, callId, INVITEE_B),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBe(1);
      expect(['joined', 'declined']).toContain(
        await participantStatus(db, callId, INVITEE_B.userId),
      );
    });

    it('two concurrent createCall by the same creator produce exactly one active call', async () => {
      await allOnline(CREATOR, INVITEE_B);
      const results = await Promise.allSettled([
        createCall(db, CREATOR, [INVITEE_B.userId]),
        createCall(db, CREATOR, [INVITEE_B.userId]),
      ]);
      const wins = results.filter((r) => r.status === 'fulfilled');
      const busy = results.filter(
        (r) => r.status === 'rejected' && (r.reason as { code?: string }).code === 'BUSY',
      );
      expect(wins.length).toBe(1);
      expect(busy.length).toBe(1);
      const calls = await db.query(`SELECT id FROM video_calls WHERE status = 'active'`);
      expect(calls.length).toBe(1);
    });

    it('a failed ring INSERT rolls back the whole call (no creator-less/ghost call)', async () => {
      await allOnline(CREATOR, INVITEE_B);
      const failing = new FailingAdapter(db, /'invitee', 'ringing'/);
      await expect(createCall(failing, CREATOR, [INVITEE_B.userId])).rejects.toThrow(
        /injected failure/,
      );
      const calls = await db.query(`SELECT id FROM video_calls`);
      expect(calls.length).toBe(0);
    });

    it('duplicate concurrent invites of one user leave exactly one participant row', async () => {
      await allOnline(CREATOR, INVITEE_B, INVITEE_C);
      const { callId } = await createJoinedCallWith(INVITEE_B);
      await Promise.allSettled([
        inviteToCall(db, callId, INVITEE_B, [INVITEE_C.userId]),
        inviteToCall(db, callId, INVITEE_B, [INVITEE_C.userId]),
      ]);
      const rows = await db.query(
        `SELECT id FROM video_call_participants WHERE call_id = ? AND user_id = ?`,
        [callId, INVITEE_C.userId],
      );
      expect(rows.length).toBe(1);
    });
  });
});
