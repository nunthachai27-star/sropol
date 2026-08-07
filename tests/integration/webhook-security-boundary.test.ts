// Security-boundary integration tests for the webhook route handler.
//
// These tests exercise the actual POST route (not just the service layer)
// because the hospitalCode-vs-API-key check lives in the route, between
// authentication and validation. A regression in route.ts that only
// touched service tests would slip through unnoticed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestDb } from '../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import { generateKey } from '@/lib/encryption';
import { createApiKey } from '@/services/webhook';
import { createJourney } from '@/services/journey';
import { AncRiskLevel } from '@/types/domain';
import { SseManager } from '@/lib/sse';
import * as connection from '@/db/connection';
import * as ensureInit from '@/lib/ensure-init';

const TEST_ENCRYPTION_KEY = generateKey();
process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

const HOSPITAL_A_ID = '11111111-1111-1111-1111-111111111111';
const HOSPITAL_B_ID = '22222222-2222-2222-2222-222222222222';
const HOSPITAL_C_ID = '33333333-3333-3333-3333-333333333333';
const HOSPITAL_A_HCODE = '99901';
const HOSPITAL_B_HCODE = '99902';
const HOSPITAL_C_HCODE = '99903';

describe('Webhook Route — security boundaries', () => {
  let db: DatabaseAdapter;
  let keyForHospitalA: string;

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);

    // Two distinct hospitals, each with their own HCODE.
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [HOSPITAL_A_ID, HOSPITAL_A_HCODE, 'Hospital A', 'M2', true, 'UNKNOWN', now, now],
    );
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [HOSPITAL_B_ID, HOSPITAL_B_HCODE, 'Hospital B', 'M2', true, 'UNKNOWN', now, now],
    );
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [HOSPITAL_C_ID, HOSPITAL_C_HCODE, 'Hospital C', 'M2', true, 'UNKNOWN', now, now],
    );

    // API key bound to hospital A only — sending it with payload.hospitalCode = "B"
    // is the attack scenario we're guarding against.
    const created = await createApiKey(db, HOSPITAL_A_ID, 'Hospital A test key');
    keyForHospitalA = created.rawKey;

    // Make the route's getDatabase()/ensureInit() use our in-memory db.
    vi.spyOn(connection, 'getDatabase').mockResolvedValue(db);
    vi.spyOn(ensureInit, 'ensureInit').mockResolvedValue(undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
  });

  // Helper: build a NextRequest the way the route expects
  function buildRequest(body: unknown, opts: { auth?: string } = {}): NextRequest {
    return new NextRequest('http://localhost/api/webhooks/patient-data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.auth ? { Authorization: opts.auth } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  // Helper: POST a webhook payload authenticated with the given raw API key.
  async function postWebhook(rawKey: string, body: unknown) {
    const { POST } = await import('@/app/api/webhooks/patient-data/route');
    return POST(buildRequest(body, { auth: `Bearer ${rawKey}` }));
  }

  describe('hospitalCode vs API key', () => {
    it('returns 403 when payload.hospitalCode does not match API key hospital', async () => {
      const { POST } = await import('@/app/api/webhooks/patient-data/route');
      const req = buildRequest(
        {
          hospitalCode: HOSPITAL_B_HCODE, // sender claims to be hospital B
          patients: [
            {
              hn: 'HN1',
              an: 'AN1',
              name: 'Test',
              cid: '1100500090099',
              age: 28,
              admit_date: '2026-03-08T10:00:00+07:00',
            },
          ],
        },
        { auth: `Bearer ${keyForHospitalA}` }, // ...but uses hospital A's key
      );

      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.code).toBe('HOSPITAL_CODE_MISMATCH');
      expect(body.details.expected).toBe(HOSPITAL_A_HCODE);
      expect(body.details.received).toBe(HOSPITAL_B_HCODE);
    });

    it('accepts the request when hospitalCode matches the API key', async () => {
      const { POST } = await import('@/app/api/webhooks/patient-data/route');
      const req = buildRequest(
        {
          hospitalCode: HOSPITAL_A_HCODE, // matches the key
          patients: [
            {
              hn: 'HN1',
              an: 'AN1',
              name: 'Test',
              cid: '1100500090099',
              age: 28,
              admit_date: '2026-03-08T10:00:00+07:00',
            },
          ],
        },
        { auth: `Bearer ${keyForHospitalA}` },
      );

      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.patientsProcessed).toBe(1);
    });

    it('returns 401 when Authorization header is missing', async () => {
      const { POST } = await import('@/app/api/webhooks/patient-data/route');
      const req = buildRequest({ hospitalCode: HOSPITAL_A_HCODE, patients: [] });

      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.code).toBe('MISSING_AUTH');
    });

    it('returns 401 when API key is invalid', async () => {
      const { POST } = await import('@/app/api/webhooks/patient-data/route');
      const req = buildRequest(
        { hospitalCode: HOSPITAL_A_HCODE, patients: [] },
        { auth: 'Bearer kklrms_invalid_key_that_does_not_exist_in_db__' },
      );

      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.code).toBe('INVALID_API_KEY');
    });

    it('returns 400 when body is not valid JSON', async () => {
      const { POST } = await import('@/app/api/webhooks/patient-data/route');
      const req = new NextRequest('http://localhost/api/webhooks/patient-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${keyForHospitalA}`,
        },
        body: 'not-json{{',
      });

      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.code).toBe('INVALID_JSON');
    });

    it('rejects with 400 when CID is not 13 digits even with matching hospitalCode', async () => {
      // Defense-in-depth: both auth and hospitalCode pass, but the format
      // validator should still catch a malformed CID before it reaches the DB.
      const { POST } = await import('@/app/api/webhooks/patient-data/route');
      const req = buildRequest(
        {
          hospitalCode: HOSPITAL_A_HCODE,
          patients: [
            {
              hn: 'HN1',
              an: 'AN1',
              name: 'Test',
              cid: '12345', // too short
              age: 28,
              admit_date: '2026-03-08T10:00:00+07:00',
            },
          ],
        },
        { auth: `Bearer ${keyForHospitalA}` },
      );

      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.details).toContain('CID must be exactly 13 digits');
    });
  });

  describe('referral_update tenant boundary', () => {
    let hospA: { id: string; hcode: string };
    let hospB: { id: string; hcode: string };
    let keyB: string;
    let keyC: string;
    let referralId: string;
    let journeyId: string;

    beforeEach(async () => {
      // db seeded by the file-level beforeEach; resolve the three hospitals
      const rows = await db.query<{ id: string; hcode: string }>(
        `SELECT id, hcode FROM hospitals WHERE hcode IN ('99901','99902','99903')`,
      );
      hospA = rows.find((r) => r.hcode === '99901')!;
      hospB = rows.find((r) => r.hcode === '99902')!;
      const hospC = rows.find((r) => r.hcode === '99903')!;
      keyB = (await createApiKey(db, hospB.id, 'boundary-b')).rawKey;
      keyC = (await createApiKey(db, hospC.id, 'boundary-c')).rawKey;

      const journey = await createJourney(db, {
        hospitalId: hospA.id,
        hn: 'HN-A7',
        personAncId: null,
        name: '',
        cid: '',
        cidHash: 'hash-a7',
        age: 30,
        gravida: 1,
        para: 0,
        lmp: null,
        edc: null,
        ancRiskLevel: AncRiskLevel.LOW,
      });
      journeyId = journey.id;
      referralId = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO cached_referrals
           (id, journey_id, refer_number, from_hospital_id, to_hospital_id, status,
            reason, urgency_level, initiated_at, created_at, updated_at)
         VALUES (?, ?, 'RF-A7', ?, ?, 'INITIATED', 'ทดสอบ', 'URGENT', ?, ?, ?)`,
        [referralId, journeyId, hospA.id, hospB.id, now, now, now],
      );
    });

    function updatePayload(status: string, extra: Record<string, unknown> = {}) {
      return {
        type: 'referral_update',
        referralId: 'RF-A7',
        fromHospitalCode: '99901',
        status,
        ...extra,
      };
    }

    it('404s a third hospital updating another pair referral, with no mutation and no SSE', async () => {
      const sseSpy = vi.spyOn(SseManager.getInstance(), 'broadcast');
      const res = await postWebhook(keyC, updatePayload('REJECTED'));
      expect(res.status).toBe(404);
      const rows = await db.query<{ status: string }>(
        'SELECT status FROM cached_referrals WHERE id = ?',
        [referralId],
      );
      expect(rows[0].status).toBe('INITIATED');
      expect(sseSpy).not.toHaveBeenCalled();
    });

    it('404s the SOURCE hospital sending a status update (destination-only)', async () => {
      const sseSpy = vi.spyOn(SseManager.getInstance(), 'broadcast');
      const keyA = (await createApiKey(db, hospA.id, 'boundary-a')).rawKey;
      const res = await postWebhook(keyA, updatePayload('ACCEPTED'));
      expect(res.status).toBe(404);
      const rows = await db.query<{ status: string }>(
        'SELECT status FROM cached_referrals WHERE id = ?',
        [referralId],
      );
      expect(rows[0].status).toBe('INITIATED');
      expect(sseSpy).not.toHaveBeenCalled();
    });

    it('allows the destination hospital to accept', async () => {
      const res = await postWebhook(keyB, updatePayload('ACCEPTED'));
      expect(res.status).toBe(200);
      const rows = await db.query<{ status: string }>(
        'SELECT status FROM cached_referrals WHERE id = ?',
        [referralId],
      );
      expect(rows[0].status).toBe('ACCEPTED');
    });

    it('400s an unknown status with no mutation and no broadcast', async () => {
      const sseSpy = vi.spyOn(SseManager.getInstance(), 'broadcast');
      const res = await postWebhook(keyB, updatePayload('TOTALLY_FAKE'));
      expect(res.status).toBe(400);
      const rows = await db.query<{ status: string }>(
        'SELECT status FROM cached_referrals WHERE id = ?',
        [referralId],
      );
      expect(rows[0].status).toBe('INITIATED');
      expect(sseSpy).not.toHaveBeenCalled();
    });

    it('rejects a third hospital deleting the referral; parties may delete', async () => {
      const sseSpy = vi.spyOn(SseManager.getInstance(), 'broadcast');
      const resC = await postWebhook(keyC, updatePayload('', { action: 'delete' }));
      expect(resC.status).toBe(404);
      expect(
        (await db.query('SELECT id FROM cached_referrals WHERE id = ?', [referralId])).length,
      ).toBe(1);
      expect(sseSpy).not.toHaveBeenCalled();

      const resB = await postWebhook(keyB, updatePayload('', { action: 'delete' }));
      expect(resB.status).toBe(200);
      expect(
        (await db.query('SELECT id FROM cached_referrals WHERE id = ?', [referralId])).length,
      ).toBe(0);
    });
  });
});
