// tests/unit/api/profile-notification-preference.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { generateKey } from '@/lib/encryption';
import { testSessionUser } from '../../helpers/session';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? generateKey();

let db: DatabaseAdapter;
let mockSessionUser: Record<string, unknown> | null = null;

vi.mock('@/db/connection', () => ({ getDatabase: async () => db }));
vi.mock('@/lib/auth', () => ({
  auth: async () => (mockSessionUser ? { user: mockSessionUser } : null),
}));
vi.mock('@/lib/ensure-init', () => ({ ensureInit: async () => {} }));

import { GET, PUT } from '@/app/api/profile/notification-preference/route';

function req(method: string, body?: unknown): Request {
  return new Request('http://test/api/profile/notification-preference', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('GET/PUT /api/profile/notification-preference', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    mockSessionUser = testSessionUser({ hospitalCode: '10670' });
  });
  afterEach(() => vi.restoreAllMocks());

  it('GET 401 when anonymous', async () => {
    mockSessionUser = null;
    const res = await GET(req('GET') as never);
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('GET 200 with mophLineEnabled=false when no row (Default OFF)', async () => {
    const res = await GET(req('GET') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      userCid: '1100500090006', // testSessionUser default userCid
      hospitalCode: '10670',
      mophLineEnabled: false,
    });
  });

  it('PUT upserts from session identity (body cannot set CID)', async () => {
    const res = await PUT(req('PUT', { mophLineEnabled: true }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      userCid: '1100500090006',
      hospitalCode: '10670',
      mophLineEnabled: true,
    });
    const rows = await db.query<{ user_cid: string }>(
      'SELECT user_cid FROM notification_preferences',
    );
    expect(rows[0].user_cid).toBe('1100500090006');
  });

  it('PUT 400 on non-boolean body and 401 when anonymous', async () => {
    const bad = await PUT(req('PUT', { mophLineEnabled: 'yes' }) as never);
    expect(bad.status).toBe(400);
    mockSessionUser = null;
    const anon = await PUT(req('PUT', { mophLineEnabled: true }) as never);
    expect(anon.status).toBeGreaterThanOrEqual(401);
  });

  it('PUT rejects a session with empty/non-13-digit userCid (no false opt-in)', async () => {
    // P1-B (codex): BMS can map a missing user_cid to '' — a preference row
    // keyed '' is silently dropped by isValidCid at enqueue time, so the user
    // would falsely believe they opted in. The API must reject it.
    mockSessionUser = testSessionUser({ hospitalCode: '10670', userCid: '' });
    const res = await PUT(req('PUT', { mophLineEnabled: true }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('CID');
    const rows = await db.query<{ user_cid: string }>(
      'SELECT user_cid FROM notification_preferences',
    );
    expect(rows).toHaveLength(0);
  });
});
