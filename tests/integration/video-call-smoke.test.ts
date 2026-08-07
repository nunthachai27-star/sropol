// Video-call smoke test — one continuous real-world scenario through the
// REAL route handlers, service, PGlite database and SSE fan-out. Only the
// session identity is mocked (switched per actor, like real users on their
// own browsers).
//
// Story: a referral consult between three hospitals —
//   1. Nurse A (รพช.) sees who is online and calls Dr B (รพ.แม่ข่าย)
//   2. B's browser rings; B accepts and both are in the room
//   3. They need a specialist: A invites Dr C mid-call; C declines
//   4. A tries to start a second call while busy → rejected
//   5. B leaves (call continues), A leaves (call ends)
//   6. A can immediately place a new call — nobody is stuck busy
//
// NOT covered here (needs real browsers + camera): Jitsi media itself.
// The Permissions-Policy regression that broke media in prod is guarded by
// tests/unit/middleware-headers.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Session } from 'next-auth';
import { createTestDb } from '../helpers/testDb';
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

const NURSE_A = {
  id: 'user-nurse-a',
  name: 'พว.หนึ่ง ทดสอบ',
  role: 'user',
  hospitalCode: '11004',
  hospitalName: 'รพ.น้ำพอง',
  authProvider: 'test',
  accessMode: 'full',
};
const DOCTOR_B = {
  id: 'user-doctor-b',
  name: 'นพ.สอง ทดสอบ',
  role: 'user',
  hospitalCode: '10670',
  hospitalName: 'รพ.ขอนแก่น',
  authProvider: 'test',
  accessMode: 'full',
};
const SPECIALIST_C = {
  id: 'user-specialist-c',
  name: 'พญ.สาม ทดสอบ',
  role: 'user',
  hospitalCode: '11005',
  hospitalName: 'รพ.ชนบท',
  authProvider: 'test',
  accessMode: 'full',
};

type User = typeof NURSE_A;

function sessionFor(user: User): Session {
  return {
    user: { ...user },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  } as unknown as Session;
}

// A fake browser tab: a real SseManager registration whose received events
// can be inspected — the same wire format production browsers get.
function browserTab(user: User) {
  const chunks: Uint8Array[] = [];
  const controller = {
    enqueue: (chunk: Uint8Array) => chunks.push(chunk),
    close: () => {},
  } as unknown as ReadableStreamDefaultController;
  SseManager.getInstance().addClient(`tab-${user.id}`, controller, user.id);
  return {
    events(): { event: string; data: Record<string, unknown> }[] {
      const text = chunks.map((c) => new TextDecoder().decode(c)).join('');
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
    last(eventName: string): Record<string, unknown> | undefined {
      return this.events()
        .filter((e) => e.event === eventName)
        .at(-1)?.data;
    },
  };
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

describe('video-call smoke: referral consult across three hospitals', () => {
  beforeEach(async () => {
    db = await createTestDb();
    SseManager.resetForTests();
    clearCallTimersForTests();
    await cacheDelPattern('presence:users:*');
    mockSessionUser = null;
  });

  it('runs the full real-world flow end to end', async () => {
    // Everyone is online with a live signaling tab.
    for (const user of [NURSE_A, DOCTOR_B, SPECIALIST_C]) {
      await recordOnlineUser(sessionFor(user));
    }
    const tabA = browserTab(NURSE_A);
    const tabB = browserTab(DOCTOR_B);
    const tabC = browserTab(SPECIALIST_C);

    // 1. Nurse A opens the directory and sees B and C.
    mockSessionUser = NURSE_A;
    const directory = await directoryRoute();
    const listed = (await directory.json()).hospitals.flatMap(
      (h: { users: { userId: string }[] }) => h.users.map((u) => u.userId),
    );
    expect(listed).toContain(DOCTOR_B.id);
    expect(listed).toContain(SPECIALIST_C.id);

    // 2. A calls B; B's browser rings with A's identity.
    const createRes = await createCallRoute(
      postJson('http://t/api/calls', { calleeUserIds: [DOCTOR_B.id] }) as never,
    );
    expect(createRes.status).toBe(201);
    const { callId, roomId } = await createRes.json();

    const ring = tabB.last('call:invite');
    expect(ring?.callId).toBe(callId);
    expect((ring?.inviter as { name: string }).name).toBe(NURSE_A.name);

    // 3. B accepts and lands in the same room; A sees B join.
    mockSessionUser = DOCTOR_B;
    const acceptRes = await acceptRoute(postJson('http://t') as never, params(callId));
    expect(acceptRes.status).toBe(200);
    expect((await acceptRes.json()).roomId).toBe(roomId);
    expect(tabA.last('call:participant-joined')?.userId).toBe(DOCTOR_B.id);

    // Both room pages resolve the call (and stamp liveness).
    for (const user of [NURSE_A, DOCTOR_B]) {
      mockSessionUser = user;
      const view = await getCallRoute(new Request('http://t') as never, params(callId));
      expect(view.status).toBe(200);
      expect((await view.json()).roomId).toBe(roomId);
    }

    // 4. Mid-call, A invites specialist C; C rings, then declines.
    mockSessionUser = NURSE_A;
    const inviteRes = await inviteRoute(
      postJson('http://t', { calleeUserIds: [SPECIALIST_C.id] }) as never,
      params(callId),
    );
    expect(inviteRes.status).toBe(200);
    expect((await inviteRes.json()).invited).toHaveLength(1);
    expect(tabC.last('call:invite')?.callId).toBe(callId);

    mockSessionUser = SPECIALIST_C;
    expect((await declineRoute(postJson('http://t') as never, params(callId))).status).toBe(200);
    expect(tabA.last('call:participant-declined')?.userId).toBe(SPECIALIST_C.id);
    expect(tabB.last('call:participant-declined')?.userId).toBe(SPECIALIST_C.id);

    // 5. While in the call, A cannot start a second one.
    mockSessionUser = NURSE_A;
    const busyRes = await createCallRoute(
      postJson('http://t/api/calls', { calleeUserIds: [SPECIALIST_C.id] }) as never,
    );
    expect(busyRes.status).toBe(409);
    expect((await busyRes.json()).code).toBe('BUSY');

    // 6. B leaves — call continues for A; then A leaves — call ends.
    mockSessionUser = DOCTOR_B;
    expect((await leaveRoute(postJson('http://t') as never, params(callId))).status).toBe(200);
    expect(tabA.last('call:participant-left')?.userId).toBe(DOCTOR_B.id);

    mockSessionUser = NURSE_A;
    expect((await leaveRoute(postJson('http://t') as never, params(callId))).status).toBe(200);
    const header = await db.query<{ status: string; ended_at: Date | null }>(
      'SELECT status, ended_at FROM video_calls WHERE id = ?',
      [callId],
    );
    expect(header[0].status).toBe('ended');
    expect(header[0].ended_at).not.toBeNull();

    // 7. Nobody is stuck busy: A can immediately ring B again.
    const again = await createCallRoute(
      postJson('http://t/api/calls', { calleeUserIds: [DOCTOR_B.id] }) as never,
    );
    expect(again.status).toBe(201);

    // 8. The audit trail survives: every participant row accounted for.
    const rows = await db.query<{ status: string }>(
      'SELECT status FROM video_call_participants WHERE call_id = ? ORDER BY status',
      [callId],
    );
    expect(rows.map((r) => r.status)).toEqual(['declined', 'left', 'left']);
  });
});
