// Cold-start E2E: blank pglite database → schema-sync → seeders → live route
// handlers (auth, validator, processor) → patient API read.
//
// Why this exists: T32's roundtrip test pre-seeded the schema and bypassed
// auth. This test proves the *production startup path* (the same one
// initializeApp() runs in src/app/api/startup.ts) works against the real
// Postgres dialect from a literal blank database, AND that the live route
// handlers (with Bearer-token auth) accept the resulting webhook payload.
//
// What's exercised end-to-end:
//   - SchemaSync.sync(adapter, ALL_TABLES, 'postgresql')
//   - HospitalSeeder + AdminSeeder (idempotent, gated on COUNT(*))
//   - createApiKey() → webhook_api_keys row + raw bearer token
//   - POST /api/webhooks/patient-data (patient registration via webhook)
//   - POST /api/webhooks/patient-data with type:'partograph' (observation)
//   - GET /api/patients/[an]/partogram (extended response with alerts)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKey } from '@/lib/encryption';

// PDPA — the patient-registration webhook encrypts name/cid before storage,
// so processWebhookPayload throws without ENCRYPTION_KEY set. Match the
// existing pattern from tests/integration/full-flow.test.ts: generate a
// random per-process key at module load.
process.env.ENCRYPTION_KEY ??= generateKey();

import { createPgliteApp, type PgliteAppContext } from '../helpers/createPgliteApp';
import type { PartogramResponse } from '@/types/api';

// Module-scoped events buffer — the mocked SseManager.broadcast pushes here
// so the test can assert what the route handlers broadcast.
const sseEvents: Array<{ event: string; data: unknown }> = [];

let app: PgliteAppContext;

vi.mock('@/db/connection', () => ({
  getDatabase: async () => app.db,
  isSqliteEnabled: () => false,
}));

vi.mock('@/lib/ensure-init', () => ({
  ensureInit: async () => undefined,
}));

vi.mock('@/lib/sse', () => ({
  SseManager: class MockSse {
    static getInstance() {
      return new MockSse();
    }
    broadcast(event: string, data: unknown): void {
      sseEvents.push({ event, data });
    }
    destroy(): void {}
  },
}));

// Imports must come AFTER vi.mock so the mocks take effect when the route
// modules resolve `@/db/connection`, `@/lib/ensure-init`, `@/lib/sse`.
import { POST as postWebhook } from '@/app/api/webhooks/patient-data/route';
import { GET as getPartogram } from '@/app/api/patients/[an]/partogram/route';

// Build a real Request the route handler can consume. NextRequest extends
// Request, and the webhook handler only uses .headers.get + .json from the
// base contract, so a plain Request is sufficient (cast at the call site).
function bearerRequest(apiKey: string, body: unknown): Request {
  return new Request('http://test/api/webhooks/patient-data', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  app = await createPgliteApp();
  sseEvents.length = 0;
});

afterEach(async () => {
  await app.db.close();
});

describe('partograph cold-start E2E (blank pglite → live routes)', () => {
  it('schema synced — every table in ALL_TABLES exists', async () => {
    const tables = await app.db.getTableNames();
    // Spot-check the partograph chain's tables — schema-sync ran clean.
    for (const t of [
      'hospitals',
      'cached_patients',
      'cached_partograph_observations',
      'webhook_api_keys',
      'cpd_scores',
      'audit_logs',
    ]) {
      expect(tables).toContain(t);
    }
  });

  it('hospital seeder populated all 25 Khon Kaen community hospitals', async () => {
    const rows = await app.db.query<{ count: number | string }>(
      'SELECT COUNT(*) AS count FROM hospitals',
    );
    // pg returns COUNT(*) as a string; coerce before comparing.
    expect(Number(rows[0].count)).toBe(25);

    // Spot-check that no out-of-province hospital sneaks in. รพ.วังสะพุง
    // is in Loei (hcode 11446) and was removed from the seed list.
    const stray = await app.db.query<{ hcode: string }>(
      'SELECT hcode FROM hospitals WHERE hcode = ?',
      ['11446'],
    );
    expect(stray).toHaveLength(0);
  });

  it('admin seeder created the default admin user', async () => {
    const rows = await app.db.query<{ bms_user_name: string; role: string }>(
      "SELECT bms_user_name, role FROM users WHERE role = 'ADMIN'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].bms_user_name).toBe('admin');
  });

  it('webhook API key seeded — authenticates against the bound hospital', async () => {
    expect(app.apiKey).toMatch(/^kklrms_[0-9a-f]{40}$/);
    const rows = await app.db.query<{ id: string; hospital_id: string }>(
      'SELECT id, hospital_id FROM webhook_api_keys WHERE hospital_id = ?',
      [app.hospitalId],
    );
    expect(rows).toHaveLength(1);
  });

  it('rejects webhook POST with no Authorization header', async () => {
    const req = new Request('http://test/api/webhooks/patient-data', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'partograph',
        hospitalCode: app.hcode,
        observations: [],
      }),
    });
    const res = await postWebhook(req as never);
    expect(res.status).toBe(401);
  });

  it('rejects webhook POST with bogus Bearer token', async () => {
    const req = bearerRequest('kklrms_not-a-real-key', {
      type: 'partograph',
      hospitalCode: app.hcode,
      observations: [],
    });
    const res = await postWebhook(req as never);
    expect(res.status).toBe(401);
  });

  it('full chain: register patient → push partograph → read API → CRITICAL alert', async () => {
    // ── Step 1: patient registration via the regular webhook payload ──
    // This is exactly what a non-HOSxP hospital sends to put a patient on
    // the dashboard before any partograph observation flows in.
    const registerRes = await postWebhook(
      bearerRequest(app.apiKey, {
        hospitalCode: app.hcode,
        patients: [{
          hn: 'HN-CS-1',
          an: 'AN-CS-1',
          cid: '1234567890123',
          name: 'นางทดสอบ ระบบ',
          age: 28,
          admit_date: '2026-04-19T06:00:00+07:00',
        }],
      }) as never,
    );
    expect(registerRes.status).toBe(200);
    const registerBody = await registerRes.json();
    expect(registerBody.success).toBe(true);

    const cachedRows = await app.db.query<{ an: string }>(
      'SELECT an FROM cached_patients WHERE hospital_id = ?',
      [app.hospitalId],
    );
    expect(cachedRows.map((r) => r.an)).toContain('AN-CS-1');

    // ── Step 2: partograph observation via the new envelope ──
    // moulding '+++' triggers Pascal CDSS rule 9 → CRITICAL.
    const obsRes = await postWebhook(
      bearerRequest(app.apiKey, {
        type: 'partograph',
        hospitalCode: app.hcode,
        observations: [{
          an: 'AN-CS-1',
          externalObservationId: 'cs-obs-1',
          observeDatetime: '2026-04-19T08:00:00+07:00',
          hourNo: 1,
          fetalHeartRate: 140,
          cervicalDilationCm: 4,
          moulding: '+++',
        }],
      }) as never,
    );
    expect(obsRes.status).toBe(200);
    const obsBody = await obsRes.json();
    expect(obsBody.success).toBe(true);
    expect(obsBody.observationsAccepted).toBe(1);
    expect(obsBody.observationsSkipped).toEqual([]);

    // The severity roll-up wrote CRITICAL to cached_patients.
    const sevRows = await app.db.query<{ partograph_severity: string | null }>(
      'SELECT partograph_severity FROM cached_patients WHERE an = ? AND hospital_id = ?',
      ['AN-CS-1', app.hospitalId],
    );
    expect(sevRows[0].partograph_severity).toBe('CRITICAL');

    // ── Step 3: GET /api/patients/[an]/partogram — same call SWR makes ──
    const getRes = await getPartogram(
      {} as never,
      { params: Promise.resolve({ an: `${app.hcode}-AN-CS-1` }) },
    );
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as PartogramResponse;

    expect(body.partogram.source).toBe('webhook');
    expect(body.partogram.severity.highest).toBe('CRITICAL');
    expect(body.partogram.severity.counts.critical).toBeGreaterThan(0);
    expect(body.partogram.observations).toHaveLength(1);
    expect(body.partogram.observations[0].moulding).toBe('+++');

    const mouldingCriticals = body.partogram.alerts.filter(
      (a) => a.section === 'MOULDING' && a.severity === 'CRITICAL',
    );
    expect(mouldingCriticals).toHaveLength(1);
    expect(mouldingCriticals[0].message).toBe('กะโหลกเกยกันรุนแรง (+++)');

    // SSE broadcast fired on NULL → CRITICAL severity transition.
    expect(
      sseEvents.some(
        (e) =>
          e.event === 'patient-update' &&
          (e.data as Record<string, unknown>).type ===
            'partograph_severity_changed',
      ),
    ).toBe(true);
  });
});
