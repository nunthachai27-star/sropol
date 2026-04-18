// Security-boundary integration tests for the webhook route handler.
//
// These tests exercise the actual POST route (not just the service layer)
// because the hospitalCode-vs-API-key check lives in the route, between
// authentication and validation. A regression in route.ts that only
// touched service tests would slip through unnoticed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables/index';
import { SeedOrchestrator } from '@/db/seeds/index';
import { generateKey } from '@/lib/encryption';
import { createApiKey } from '@/services/webhook';
import * as connection from '@/db/connection';
import * as ensureInit from '@/lib/ensure-init';

const TEST_ENCRYPTION_KEY = generateKey();
process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

const HOSPITAL_A_ID = '11111111-1111-1111-1111-111111111111';
const HOSPITAL_B_ID = '22222222-2222-2222-2222-222222222222';
const HOSPITAL_A_HCODE = '99901';
const HOSPITAL_B_HCODE = '99902';

describe('Webhook Route — security boundaries', () => {
  let db: SqliteAdapter;
  let keyForHospitalA: string;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await SchemaSync.sync(db, ALL_TABLES, 'sqlite');
    await new SeedOrchestrator().run(db);

    // Two distinct hospitals, each with their own HCODE.
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [HOSPITAL_A_ID, HOSPITAL_A_HCODE, 'Hospital A', 'M2', 1, 'UNKNOWN', now, now],
    );
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [HOSPITAL_B_ID, HOSPITAL_B_HCODE, 'Hospital B', 'M2', 1, 'UNKNOWN', now, now],
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
  function buildRequest(
    body: unknown,
    opts: { auth?: string } = {},
  ): NextRequest {
    return new NextRequest('http://localhost/api/webhooks/patient-data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.auth ? { Authorization: opts.auth } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  describe('hospitalCode vs API key', () => {
    it('returns 403 when payload.hospitalCode does not match API key hospital', async () => {
      const { POST } = await import('@/app/api/webhooks/patient-data/route');
      const req = buildRequest(
        {
          hospitalCode: HOSPITAL_B_HCODE, // sender claims to be hospital B
          patients: [{
            hn: 'HN1', an: 'AN1', name: 'Test', cid: '1100500090099',
            age: 28, admit_date: '2026-03-08T10:00:00+07:00',
          }],
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
          patients: [{
            hn: 'HN1', an: 'AN1', name: 'Test', cid: '1100500090099',
            age: 28, admit_date: '2026-03-08T10:00:00+07:00',
          }],
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
          patients: [{
            hn: 'HN1', an: 'AN1', name: 'Test', cid: '12345', // too short
            age: 28, admit_date: '2026-03-08T10:00:00+07:00',
          }],
        },
        { auth: `Bearer ${keyForHospitalA}` },
      );

      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.details).toContain('cid must be exactly 13 digits');
    });
  });
});
