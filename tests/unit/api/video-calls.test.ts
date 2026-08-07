// Group video-call API routes — auth guards, participant guards, HTTP mapping
// of VideoCallError codes, invite/leave lifecycle, directory, SSE stream.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Session } from 'next-auth';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SseManager } from '@/lib/sse';
import { recordOnlineUser } from '@/lib/presence';
import { cacheDelPattern } from '@/lib/cache';
import { clearCallTimersForTests } from '@/services/video-call';

let db: DatabaseAdapter;
let mockSessionUser: Record<string, unknown> | null = null;

vi.mock('@/db/connection', () => ({
  getDatabase: async () => db,
}));
vi.mock('@/lib/auth', () => ({
  auth: async () => (mockSessionUser ? { user: mockSessionUser } : null),
}));
vi.mock('@/lib/ensure-init', () => ({
  ensureInit: async () => {},
}));

import { POST as createCallRoute } from '@/app/api/calls/route';
import { GET as getCallRoute } from '@/app/api/calls/[id]/route';
import { POST as acceptRoute } from '@/app/api/calls/[id]/accept/route';
import { POST as declineRoute } from '@/app/api/calls/[id]/decline/route';
import { POST as leaveRoute } from '@/app/api/calls/[id]/leave/route';
import { POST as inviteRoute } from '@/app/api/calls/[id]/invite/route';
import { GET as directoryRoute } from '@/app/api/calls/directory/route';
import { GET as callsSseRoute } from '@/app/api/sse/calls/route';

const CREATOR_USER = {
  id: 'user-creator',
  name: 'พญ.ต้นทาง ทดสอบ',
  role: 'user',
  hospitalCode: '10670',
  hospitalName: 'รพ.ขอนแก่น',
  authProvider: 'test',
  accessMode: 'full',
};
const INVITEE_USER = {
  id: 'user-b',
  name: 'นพ.สอง ทดสอบ',
  role: 'user',
  hospitalCode: '11004',
  hospitalName: 'รพ.น้ำพอง',
  authProvider: 'test',
  accessMode: 'full',
};
const THIRD_USER = {
  id: 'user-c',
  name: 'นส.สาม ทดสอบ',
  role: 'user',
  hospitalCode: '11005',
  hospitalName: 'รพ.ชนบท',
  authProvider: 'test',
  accessMode: 'full',
};

function sessionFor(user: typeof CREATOR_USER): Session {
  return {
    user: { ...user },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  } as unknown as Session;
}

async function online(...users: (typeof CREATOR_USER)[]): Promise<void> {
  for (const user of users) await recordOnlineUser(sessionFor(user));
}

function postJson(url: string, body?: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

async function placeCall(
  calleeUserIds: string[],
): Promise<{ callId: string; roomId: string; invited: unknown[]; skipped: unknown[] }> {
  mockSessionUser = CREATOR_USER;
  const res = await createCallRoute(postJson('http://test/api/calls', { calleeUserIds }) as never);
  expect(res.status).toBe(201);
  return res.json();
}

describe('group video-call API routes', () => {
  beforeEach(async () => {
    db = await createTestDb();
    SseManager.resetForTests();
    clearCallTimersForTests();
    await cacheDelPattern('presence:users:*');
    mockSessionUser = null;
  });

  describe('POST /api/calls', () => {
    it('401 without a session', async () => {
      const res = await createCallRoute(
        postJson('http://test/api/calls', { calleeUserIds: ['x'] }) as never,
      );
      expect(res.status).toBe(401);
    });

    it('400 when no callee ids are provided', async () => {
      mockSessionUser = CREATOR_USER;
      const empty = await createCallRoute(
        postJson('http://test/api/calls', { calleeUserIds: [] }) as never,
      );
      expect(empty.status).toBe(400);
      const missing = await createCallRoute(postJson('http://test/api/calls', {}) as never);
      expect(missing.status).toBe(400);
      expect((await missing.json()).message).toMatch(/[ก-๙]/);
    });

    it('creates a group call and reports invited + skipped', async () => {
      await online(CREATOR_USER, INVITEE_USER, THIRD_USER);
      const body = await placeCall([INVITEE_USER.id, THIRD_USER.id, 'user-ghost']);
      expect(body.callId).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.roomId).toMatch(/^kklrms-/);
      expect(body.invited).toHaveLength(2);
      expect(body.skipped).toEqual([{ userId: 'user-ghost', reason: 'offline' }]);
    });

    it('accepts the legacy single calleeUserId string', async () => {
      await online(CREATOR_USER, INVITEE_USER);
      mockSessionUser = CREATOR_USER;
      const res = await createCallRoute(
        postJson('http://test/api/calls', { calleeUserId: INVITEE_USER.id }) as never,
      );
      expect(res.status).toBe(201);
      expect((await res.json()).invited).toHaveLength(1);
    });

    it('409 NO_INVITEES with Thai message when nobody is invitable', async () => {
      await online(CREATOR_USER);
      mockSessionUser = CREATOR_USER;
      const res = await createCallRoute(
        postJson('http://test/api/calls', { calleeUserIds: ['user-ghost'] }) as never,
      );
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe('NO_INVITEES');
      expect(body.message).toMatch(/[ก-๙]/);
    });
  });

  describe('accept / decline / leave', () => {
    it('accept: 401 unauthenticated, 403 stranger, 200 with roomId for the invitee', async () => {
      await online(CREATOR_USER, INVITEE_USER);
      const { callId, roomId } = await placeCall([INVITEE_USER.id]);

      mockSessionUser = null;
      expect((await acceptRoute(postJson('http://t') as never, params(callId))).status).toBe(401);

      mockSessionUser = THIRD_USER;
      expect((await acceptRoute(postJson('http://t') as never, params(callId))).status).toBe(403);

      mockSessionUser = INVITEE_USER;
      const res = await acceptRoute(postJson('http://t') as never, params(callId));
      expect(res.status).toBe(200);
      expect((await res.json()).roomId).toBe(roomId);
    });

    it('decline resolves the ring; leave by the last joined participant ends the call', async () => {
      await online(CREATOR_USER, INVITEE_USER);
      const { callId } = await placeCall([INVITEE_USER.id]);

      mockSessionUser = INVITEE_USER;
      expect((await declineRoute(postJson('http://t') as never, params(callId))).status).toBe(200);

      mockSessionUser = CREATOR_USER;
      expect((await leaveRoute(postJson('http://t') as never, params(callId))).status).toBe(200);

      const header = await db.query<{ status: string }>(
        'SELECT status FROM video_calls WHERE id = ?',
        [callId],
      );
      expect(header[0].status).toBe('ended');
    });

    it('404 for unknown call ids', async () => {
      mockSessionUser = INVITEE_USER;
      const res = await acceptRoute(
        postJson('http://t') as never,
        params('00000000-0000-4000-8000-000000000000'),
      );
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/calls/[id]/invite', () => {
    it('lets a joined participant ring more people; forbids non-joined callers', async () => {
      await online(CREATOR_USER, INVITEE_USER, THIRD_USER);
      const { callId } = await placeCall([INVITEE_USER.id]);

      // Still ringing — cannot invite yet.
      mockSessionUser = INVITEE_USER;
      const early = await inviteRoute(
        postJson('http://t', { calleeUserIds: [THIRD_USER.id] }) as never,
        params(callId),
      );
      expect(early.status).toBe(403);

      mockSessionUser = CREATOR_USER;
      const res = await inviteRoute(
        postJson('http://t', { calleeUserIds: [THIRD_USER.id] }) as never,
        params(callId),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.invited).toHaveLength(1);

      const rows = await db.query<{ status: string }>(
        'SELECT status FROM video_call_participants WHERE call_id = ? AND user_id = ?',
        [callId, THIRD_USER.id],
      );
      expect(rows[0].status).toBe('ringing');
    });

    it('400 when calleeUserIds is missing', async () => {
      await online(CREATOR_USER, INVITEE_USER);
      const { callId } = await placeCall([INVITEE_USER.id]);
      mockSessionUser = CREATOR_USER;
      const res = await inviteRoute(postJson('http://t', {}) as never, params(callId));
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/calls/[id]', () => {
    it('returns header + participants to participants, 403 to strangers', async () => {
      await online(CREATOR_USER, INVITEE_USER);
      const { callId, roomId } = await placeCall([INVITEE_USER.id]);

      mockSessionUser = INVITEE_USER;
      const res = await getCallRoute(new Request('http://t') as never, params(callId));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.roomId).toBe(roomId);
      expect(body.participants).toHaveLength(2);
      expect(body.createdByName).toBe(CREATOR_USER.name);

      mockSessionUser = THIRD_USER;
      const forbidden = await getCallRoute(new Request('http://t') as never, params(callId));
      expect(forbidden.status).toBe(403);
    });
  });

  describe('GET /api/calls/directory', () => {
    it('401 without a session; groups online users excluding the requester', async () => {
      expect((await directoryRoute()).status).toBe(401);

      await online(CREATOR_USER, INVITEE_USER, THIRD_USER);
      mockSessionUser = CREATOR_USER;
      const res = await directoryRoute();
      expect(res.status).toBe(200);
      const body = await res.json();
      const allUserIds = body.hospitals.flatMap((h: { users: { userId: string }[] }) =>
        h.users.map((u) => u.userId),
      );
      expect(allUserIds).toContain(INVITEE_USER.id);
      expect(allUserIds).toContain(THIRD_USER.id);
      expect(allUserIds).not.toContain(CREATOR_USER.id);
    });
  });

  describe('GET /api/sse/calls', () => {
    it('401 without a session; registers the stream under the session user', async () => {
      expect((await callsSseRoute()).status).toBe(401);

      mockSessionUser = INVITEE_USER;
      const res = await callsSseRoute();
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/event-stream');
      expect(SseManager.getInstance().sendToUser(INVITEE_USER.id, 'call:test', {})).toBe(1);
    });
  });
});
