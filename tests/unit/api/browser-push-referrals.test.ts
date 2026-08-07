// Referral gateway sync — route wiring tests (plan:
// docs/superpowers/plans/2026-07-20-referral-gateway-sync.md). Drives the real
// browser-push POST handler and asserts the optional `referrals` section
// (referouts from the origin gateway, referins from the destination gateway)
// is persisted best-effort and surfaced in the response counts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'crypto';
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

import { POST } from '@/app/api/sync/browser-push/route';

const HCODE = '10670';
const CID = '1111111111113';
const CID_HASH = createHash('sha256').update(CID).digest('hex');

function jsonRequest(body: unknown): Request {
  return new Request('http://test/api/sync/browser-push', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function hospitalIdOf(hcode: string): Promise<string> {
  const rows = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [hcode]);
  return rows[0].id;
}

async function otherHcode(): Promise<string> {
  const rows = await db.query<{ hcode: string }>(
    `SELECT hcode FROM hospitals WHERE hcode <> ? ORDER BY hcode LIMIT 1`,
    [HCODE],
  );
  return rows[0].hcode;
}

async function seedJourney(hospitalId: string): Promise<string> {
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, registered_at, stage_changed_at, synced_at, created_at, updated_at)
     VALUES ('j-ref-1', ?, ?, 'HN-REF-1', 'enc-name', 'enc-cid', ?, 30, 1, 0, 'PREGNANCY', ?, ?, ?, ?, ?)`,
    [hospitalId, hospitalId, CID_HASH, now, now, now, now, now],
  );
  return 'j-ref-1';
}

describe('POST /api/sync/browser-push — referral sections', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    mockSessionUser = testSessionUser({ hospitalCode: HCODE });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists referout rows from the origin gateway and reports counts', async () => {
    const hid = await hospitalIdOf(HCODE);
    await seedJourney(hid);
    const destHcode = await otherHcode();

    const res = await POST(
      jsonRequest({
        referrals: {
          referouts: [
            {
              refer_number: 'RF-ROUTE-1',
              refer_date: '2026-07-19',
              refer_hospcode: destHcode,
              pre_diagnosis: 'severe PIH',
              pdx: 'O14',
              hn: 'HN-REF-1',
              cid: CID,
            },
          ],
          referins: [],
        },
      }) as never,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.referrals).toMatchObject({ referouts: { created: 1 } });
    const rows = await db.query<{ status: string; refer_number: string }>(
      `SELECT status, refer_number FROM cached_referrals`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'INITIATED', refer_number: 'RF-ROUTE-1' });
  });

  it('marks a referral ARRIVED from destination referin evidence', async () => {
    const destHid = await hospitalIdOf(HCODE); // pushing hospital = destination
    const originHcode = await otherHcode();
    const originHid = await hospitalIdOf(originHcode);
    const journeyId = await seedJourney(originHid);
    const now = new Date().toISOString();
    // The cached referral must sit inside the referin's [refer_date-30d,
    // refer_date+1d] match window. Production referout ingestion derives
    // initiated_at from refer_date (not wall-clock now), so mirror that here
    // to keep the fixture stable across the calendar (was a date-drift bomb).
    const referDate = '2026-07-20';
    const initiatedAt = new Date(`${referDate}T09:00:00+07:00`).toISOString();
    await db.execute(
      `INSERT INTO cached_referrals (id, journey_id, refer_number, from_hospital_id, to_hospital_id, status, reason, urgency_level, initiated_at, created_at, updated_at)
       VALUES ('ref-in-1', ?, 'RF-IN-1', ?, ?, 'INITIATED', 'r', 'ROUTINE', ?, ?, ?)`,
      [journeyId, originHid, destHid, initiatedAt, now, now],
    );

    const res = await POST(
      jsonRequest({
        referrals: {
          referouts: [],
          referins: [{ hn: 'DHN-1', cid: CID, refer_hospcode: originHcode, refer_date: referDate }],
        },
      }) as never,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.referrals).toMatchObject({ referins: { arrived: 1 } });
    const rows = await db.query<{ status: string }>(`SELECT status FROM cached_referrals`);
    expect(rows[0].status).toBe('ARRIVED');
    const journey = await db.query<{ current_hospital_id: string }>(
      `SELECT current_hospital_id FROM maternal_journeys WHERE id = ?`,
      [journeyId],
    );
    expect(journey[0].current_hospital_id).toBe(destHid);
  });
});
