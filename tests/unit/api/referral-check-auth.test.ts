// Unit tests: POST /api/referrals/check — Bearer auth, CID checksum, response
// minimization, per-hospital rate limiting. Task A8 (Phase 0 item 4): the
// route previously returned a full maternity dossier to any unauthenticated
// caller with a 13-char CID. This test file pins the locked-down contract.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { createApiKey } from '@/services/webhook';
import { cacheDelPattern } from '@/lib/cache';

let db: DatabaseAdapter;

vi.mock('@/db/connection', () => ({ getDatabase: async () => db }));
vi.mock('@/lib/ensure-init', () => ({ ensureInit: async () => {} }));

import { POST } from '@/app/api/referrals/check/route';

const VALID_CID = '1100500090006'; // checksum-valid synthetic CID (existing test fixture)

function checkRequest(body: unknown, bearer?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return new Request('http://test/api/referrals/check', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/referrals/check — auth + minimization', () => {
  let apiKey: string;

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    await cacheDelPattern('ratelimit:*');
    const hosp = await db.query<{ id: string }>(`SELECT id FROM hospitals WHERE hcode = '10670'`);
    apiKey = (await createApiKey(db, hosp[0].id, 'check-test')).rawKey;
  });

  it('401s without a Bearer key', async () => {
    const res = await POST(checkRequest({ cid: VALID_CID }) as never);
    expect(res.status).toBe(401);
  });

  it('401s with an invalid key', async () => {
    const res = await POST(checkRequest({ cid: VALID_CID }, 'kklrms_' + '0'.repeat(40)) as never);
    expect(res.status).toBe(401);
  });

  it('400s a 13-char CID with an invalid checksum', async () => {
    const res = await POST(checkRequest({ cid: '1234567890123' }, apiKey) as never);
    expect(res.status).toBe(400);
  });

  it('returns ONLY canRefer/reason/activeReferrals — no patient or labor PHI', async () => {
    const res = await POST(checkRequest({ cid: VALID_CID }, apiKey) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['activeReferrals', 'canRefer', 'reason']);
  });

  it('429s after the per-hospital limit inside one window', async () => {
    let last: Response | null = null;
    for (let i = 0; i < 31; i++) {
      last = await POST(checkRequest({ cid: VALID_CID }, apiKey) as never);
    }
    expect(last!.status).toBe(429);
  });
});
