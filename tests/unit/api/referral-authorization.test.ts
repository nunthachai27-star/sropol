import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { AncRiskLevel, ReferralStatus } from '@/types/domain';
import { testSessionUser } from '../../helpers/session';
import { createJourney } from '@/services/journey';
import { initiateReferral, acceptReferral, markInTransit } from '@/services/referral';

let db: DatabaseAdapter;
let mockSessionUser: Record<string, unknown> | null = null;

vi.mock('@/db/connection', () => ({ getDatabase: async () => db }));
vi.mock('@/lib/auth', () => ({
  auth: async () => (mockSessionUser ? { user: mockSessionUser } : null),
}));
vi.mock('@/lib/ensure-init', () => ({ ensureInit: async () => {} }));

import { POST as createRoute, GET as listRoute } from '@/app/api/referrals/route';
import { PATCH as acceptRoute } from '@/app/api/referrals/[id]/accept/route';
import { PATCH as arriveRoute } from '@/app/api/referrals/[id]/arrive/route';

const HCODE_A = '10670'; // source
const HCODE_B = '11004'; // destination

async function hospitalId(hcode: string): Promise<string> {
  const rows = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [hcode]);
  return rows[0].id;
}

async function seedJourneyAt(hcode: string): Promise<string> {
  const journey = await createJourney(db, {
    hospitalId: await hospitalId(hcode),
    hn: `HN-${hcode}`,
    personAncId: null,
    name: '',
    cid: '',
    cidHash: `hash-${hcode}`,
    age: 30,
    gravida: 1,
    para: 0,
    lmp: null,
    edc: null,
    ancRiskLevel: AncRiskLevel.LOW,
  });
  return journey.id;
}

function jsonRequest(url: string, body: unknown, method = 'POST'): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe('referral session-hospital binding', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    mockSessionUser = null;
  });

  it('401s referral creation without a session', async () => {
    const res = await createRoute(
      jsonRequest('http://test/api/referrals', {
        journeyId: 'x',
        toHospitalId: 'y',
        reason: 'r',
        urgencyLevel: 'URGENT',
      }) as never,
    );
    expect(res.status).toBe(401);
  });

  it('403s referral creation for a readonly session', async () => {
    mockSessionUser = testSessionUser({ hospitalCode: HCODE_A, accessMode: 'readonly' });
    const res = await createRoute(
      jsonRequest('http://test/api/referrals', {
        journeyId: 'x',
        toHospitalId: 'y',
        reason: 'r',
        urgencyLevel: 'URGENT',
      }) as never,
    );
    expect(res.status).toBe(403);
  });

  it('415s a form-encoded body on this JSON-only handler (CSRF simple-request vector)', async () => {
    mockSessionUser = testSessionUser({ hospitalCode: HCODE_A });
    const res = await createRoute(
      new Request('http://test/api/referrals', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'journeyId=x&toHospitalId=y',
      }) as never,
    );
    expect(res.status).toBe(415);
  });

  it('binds from_hospital to the SESSION hospital, ignoring body fromHospitalId', async () => {
    mockSessionUser = testSessionUser({ hospitalCode: HCODE_A, name: 'พว.เอ ทดสอบ' });
    const journeyId = await seedJourneyAt(HCODE_A);
    const res = await createRoute(
      jsonRequest('http://test/api/referrals', {
        journeyId,
        fromHospitalId: await hospitalId(HCODE_B), // attacker-controlled — must be ignored
        toHospitalId: await hospitalId(HCODE_B),
        reason: 'ส่งต่อทดสอบ',
        urgencyLevel: 'URGENT',
        initiatedBy: 'attacker',
      }) as never,
    );
    expect(res.status).toBe(201);
    const rows = await db.query<{ from_hospital_id: string; initiated_by: string }>(
      'SELECT from_hospital_id, initiated_by FROM cached_referrals WHERE journey_id = ?',
      [journeyId],
    );
    expect(rows[0].from_hospital_id).toBe(await hospitalId(HCODE_A));
    expect(rows[0].initiated_by).toBe('พว.เอ ทดสอบ');
  });

  it('403s creation when the journey is at another hospital, creating no row', async () => {
    mockSessionUser = testSessionUser({ hospitalCode: HCODE_B });
    const journeyId = await seedJourneyAt(HCODE_A);
    const res = await createRoute(
      jsonRequest('http://test/api/referrals', {
        journeyId,
        toHospitalId: await hospitalId(HCODE_A),
        reason: 'r',
        urgencyLevel: 'URGENT',
      }) as never,
    );
    expect(res.status).toBe(403);
    const rows = await db.query('SELECT id FROM cached_referrals WHERE journey_id = ?', [
      journeyId,
    ]);
    expect(rows.length).toBe(0);
  });

  it('403s accept from a hospital that is not the destination, leaving status unchanged', async () => {
    const journeyId = await seedJourneyAt(HCODE_A);
    const referral = await initiateReferral(db, {
      journeyId,
      fromHospitalId: await hospitalId(HCODE_A),
      toHospitalId: await hospitalId(HCODE_B),
      reason: 'r',
      urgencyLevel: 'URGENT' as never,
    });
    mockSessionUser = testSessionUser({ hospitalCode: HCODE_A }); // source tries to accept
    const res = await acceptRoute(
      jsonRequest(`http://test/api/referrals/${referral.id}/accept`, {}, 'PATCH') as never,
      params(referral.id),
    );
    expect(res.status).toBe(403);
    const rows = await db.query<{ status: string }>(
      'SELECT status FROM cached_referrals WHERE id = ?',
      [referral.id],
    );
    expect(rows[0].status).toBe(ReferralStatus.INITIATED);
  });

  it('lets the destination hospital accept, stamping the session actor', async () => {
    const journeyId = await seedJourneyAt(HCODE_A);
    const referral = await initiateReferral(db, {
      journeyId,
      fromHospitalId: await hospitalId(HCODE_A),
      toHospitalId: await hospitalId(HCODE_B),
      reason: 'r',
      urgencyLevel: 'URGENT' as never,
    });
    mockSessionUser = testSessionUser({ hospitalCode: HCODE_B, name: 'พว.บี ทดสอบ' });
    const res = await acceptRoute(
      jsonRequest(
        `http://test/api/referrals/${referral.id}/accept`,
        { acceptedBy: 'attacker' },
        'PATCH',
      ) as never,
      params(referral.id),
    );
    expect(res.status).toBe(200);
    const rows = await db.query<{ status: string; accepted_by: string }>(
      'SELECT status, accepted_by FROM cached_referrals WHERE id = ?',
      [referral.id],
    );
    expect(rows[0].status).toBe(ReferralStatus.ACCEPTED);
    expect(rows[0].accepted_by).toBe('พว.บี ทดสอบ');
  });

  it('403s arrive from a third hospital and does not move journey ownership', async () => {
    const journeyId = await seedJourneyAt(HCODE_A);
    const referral = await initiateReferral(db, {
      journeyId,
      fromHospitalId: await hospitalId(HCODE_A),
      toHospitalId: await hospitalId(HCODE_B),
      reason: 'r',
      urgencyLevel: 'URGENT' as never,
    });
    await acceptReferral(db, referral.id, 'พว.บี');
    await markInTransit(db, referral.id, 'ambulance');
    mockSessionUser = testSessionUser({ hospitalCode: '10998' }); // neither party
    const res = await arriveRoute(
      jsonRequest(
        `http://test/api/referrals/${referral.id}/arrive`,
        { receivingAn: 'AN1' },
        'PATCH',
      ) as never,
      params(referral.id),
    );
    expect(res.status).toBe(403);
    const journeyRows = await db.query<{ current_hospital_id: string }>(
      'SELECT current_hospital_id FROM maternal_journeys WHERE id = ?',
      [journeyId],
    );
    expect(journeyRows[0].current_hospital_id).toBe(await hospitalId(HCODE_A));
  });

  it('accepts a session actor name longer than 36 chars without truncation or error', async () => {
    // Thai names commonly carry title + honorific prefixes and easily exceed
    // 36 chars — initiated_by/accepted_by must not be sized to a uuid.
    const LONG_NAME = 'นางสาวสมหญิง ทองดีมีสุขสวัสดิ์วงศ์ ณ อยุธยา'; // 43 chars
    mockSessionUser = testSessionUser({ hospitalCode: HCODE_A, name: LONG_NAME });
    const journeyId = await seedJourneyAt(HCODE_A);
    const res = await createRoute(
      jsonRequest('http://test/api/referrals', {
        journeyId,
        toHospitalId: await hospitalId(HCODE_B),
        reason: 'ส่งต่อทดสอบชื่อยาว',
        urgencyLevel: 'URGENT',
      }) as never,
    );
    expect(res.status).toBe(201);
    const rows = await db.query<{ initiated_by: string }>(
      'SELECT initiated_by FROM cached_referrals WHERE journey_id = ?',
      [journeyId],
    );
    expect(rows[0].initiated_by).toBe(LONG_NAME);
  });

  it('GET list is scoped to the session hospital and ignores ?hospital', async () => {
    const journeyId = await seedJourneyAt(HCODE_A);
    await initiateReferral(db, {
      journeyId,
      fromHospitalId: await hospitalId(HCODE_A),
      toHospitalId: await hospitalId(HCODE_B),
      reason: 'r',
      urgencyLevel: 'URGENT' as never,
    });
    mockSessionUser = testSessionUser({ hospitalCode: '10998' }); // unrelated hospital
    const res = await listRoute(
      new Request(
        `http://test/api/referrals?hospital=${await hospitalId(HCODE_A)}&dir=out`,
      ) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]); // param ignored — unrelated hospital sees nothing
  });
});
