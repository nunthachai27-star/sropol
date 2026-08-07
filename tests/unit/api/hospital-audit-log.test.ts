// Task 17: Audit-log server route tests — TDD: write tests FIRST
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';

let db: DatabaseAdapter;
let mockUserId = 'u-fake';
let mockHospitalCode = '10670';

vi.mock('@/db/connection', () => ({
  getDatabase: async () => db,
}));
vi.mock('@/lib/auth', () => ({
  auth: async () => ({
    user: { id: mockUserId, hospitalCode: mockHospitalCode, role: 'NURSE' },
  }),
}));

import { POST } from '@/app/api/hospital/audit-log/route';

function jsonRequest(body: unknown): Request {
  return new Request('http://test/api/hospital/audit-log', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/hospital/audit-log', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    // Use a real seeded user_id so the FK constraint is satisfiable.
    const users = await db.query<{ id: string }>('SELECT id FROM users LIMIT 1');
    mockUserId = users[0].id;
    mockHospitalCode = '10670';
  });

  afterEach(async () => {
    try {
      await db.close();
    } catch {
      // already closed in some tests
    }
  });

  it('400 when entity missing', async () => {
    const res = await POST(jsonRequest({ op: 'update', hcode: '10670' }) as never);
    expect(res.status).toBe(400);
  });

  it('400 when op missing', async () => {
    const res = await POST(jsonRequest({ entity: 'iptbedmove', hcode: '10670' }) as never);
    expect(res.status).toBe(400);
  });

  it('400 when hcode missing', async () => {
    const res = await POST(jsonRequest({ entity: 'x', op: 'y' }) as never);
    expect(res.status).toBe(400);
  });

  it('403 when hcode does not match session', async () => {
    const res = await POST(jsonRequest({ entity: 'x', op: 'y', hcode: '99999' }) as never);
    expect(res.status).toBe(403);
  });

  it('200 + inserts row on valid input', async () => {
    const res = await POST(
      jsonRequest({
        entity: 'iptbedmove',
        op: 'insert',
        resourceId: '42',
        fieldsTouched: ['nbedno', 'nroomno'],
        hcode: '10670',
        staff: 'nurse1',
      }) as never,
    );
    expect(res.status).toBe(200);

    const rows = await db.query<{
      action: string;
      resource_type: string;
      resource_id: string;
      metadata: { fieldsTouched: string[]; hcode: string; staff: string };
    }>(
      'SELECT action, resource_type, resource_id, metadata FROM audit_logs WHERE resource_id = ?',
      ['42'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('bms.iptbedmove.insert');
    expect(rows[0].resource_type).toBe('iptbedmove');
    const meta = rows[0].metadata;
    expect(meta.fieldsTouched).toEqual(['nbedno', 'nroomno']);
    expect(meta.hcode).toBe('10670');
    expect(meta.staff).toBe('nurse1');
  });

  it('still returns 200 even if DB insert throws (fire-and-forget contract)', async () => {
    // Close the DB to force the insert to throw
    await db.close();
    const res = await POST(
      jsonRequest({
        entity: 'x',
        op: 'y',
        hcode: '10670',
      }) as never,
    );
    expect(res.status).toBe(200);
  });
});

// Separate describe for unauthorized — uses a different vi.mock
describe('POST /api/hospital/audit-log (unauthorized)', () => {
  beforeEach(async () => {
    vi.doMock('@/lib/auth', () => ({
      auth: async () => null,
    }));
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
  });

  afterEach(async () => {
    try {
      await db.close();
    } catch {
      // already closed
    }
    vi.doUnmock('@/lib/auth');
    vi.resetModules();
  });

  it('401 when no NextAuth session', async () => {
    // Re-import after doMock to get the unauth version
    vi.resetModules();
    const { POST: postNoAuth } = await import('@/app/api/hospital/audit-log/route');
    const res = await postNoAuth(jsonRequest({ entity: 'x', op: 'y', hcode: '10670' }) as never);
    expect(res.status).toBe(401);
  });
});
