// Phase 6 Task H4 — GET /api/hospitals/[hcode]/maternal-screen-summaries
// (docs/superpowers/plans/2026-07-17-maternal-screening-hosxp.md, GC-H4).
//
// Route-level test, same mock/call convention as
// tests/integration/maternal-screenings-api.test.ts: mock @/db/connection,
// @/lib/ensure-init, @/lib/auth, then invoke the route's GET export
// directly with a Next-style params Promise. This route mirrors the sibling
// GET /api/hospitals/[hcode]/patients (src/app/api/hospitals/[hcode]/patients/route.ts):
// there is no in-route session/401 gate (that's middleware.ts's job, which
// doesn't run when calling GET() directly) — only a fire-and-forget audit
// log when a session happens to be present. This file asserts that same
// shape, NOT an invented 401.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createTestDb } from '../helpers/testDb';
import { testSessionUser } from '../helpers/session';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import { UserRole } from '@/types/domain';
import type { MaternalScreenSummariesResponse } from '@/types/api';

let testDb: DatabaseAdapter;
let mockSessionUser: Record<string, unknown> | null = null;

vi.mock('@/db/connection', () => ({
  getDatabase: async () => testDb,
}));
vi.mock('@/lib/ensure-init', () => ({
  ensureInit: async () => undefined,
}));
vi.mock('@/lib/auth', () => ({
  auth: async () => (mockSessionUser ? { user: mockSessionUser } : null),
}));

// Import the route under test AFTER the mocks are registered.
import { GET } from '@/app/api/hospitals/[hcode]/maternal-screen-summaries/route';

const HCODE_A = '10670';
const HCODE_B = '10995';

async function hospitalIdFor(db: DatabaseAdapter, hcode: string): Promise<string> {
  const rows = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [hcode]);
  expect(rows).toHaveLength(1);
  return rows[0].id;
}

async function callRoute(
  hcode: string,
): Promise<{ status: number; body: MaternalScreenSummariesResponse }> {
  const res = await GET({} as never, { params: Promise.resolve({ hcode }) });
  return { status: res.status, body: await res.json() };
}

let seq = 0;
async function seedPatient(
  db: DatabaseAdapter,
  hospitalId: string,
  overrides: {
    an?: string;
    laborStatus?: string;
    localTier?: string | null;
    emergencyAcuity?: string | null;
    isComplete?: boolean | null;
    assessedAt?: string | null;
  } = {},
): Promise<{ id: string; an: string }> {
  seq += 1;
  const id = uuidv4();
  const now = new Date().toISOString();
  const an = overrides.an ?? `AN-H4-${seq}`;
  await db.execute(
    `INSERT INTO cached_patients
       (id, hospital_id, hn, an, name, age, admit_date, labor_status,
        maternal_screen_local_tier, maternal_screen_emergency_acuity,
        maternal_screen_is_complete, maternal_screen_assessed_at,
        synced_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      hospitalId,
      `HN-H4-${seq}`,
      an,
      'enc-name',
      28,
      now,
      overrides.laborStatus ?? 'ACTIVE',
      overrides.localTier ?? null,
      overrides.emergencyAcuity ?? null,
      overrides.isComplete ?? null,
      overrides.assessedAt ?? null,
      now,
      now,
      now,
    ],
  );
  return { id, an };
}

describe('GET /api/hospitals/[hcode]/maternal-screen-summaries (Task H4)', () => {
  let hospitalAId: string;
  let hospitalBId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    await new SeedOrchestrator().run(testDb);
    hospitalAId = await hospitalIdFor(testDb, HCODE_A);
    hospitalBId = await hospitalIdFor(testDb, HCODE_B);
    mockSessionUser = testSessionUser({ hospitalCode: HCODE_A, role: UserRole.NURSE });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await testDb.close();
  });

  it('returns the shape { uiEnabled, summaries } with an empty array when nothing qualifies', async () => {
    const { status, body } = await callRoute(HCODE_A);
    expect(status).toBe(200);
    expect(body).toEqual({ uiEnabled: true, summaries: [] });
  });

  it('returns one summary item per ACTIVE admission that has a non-null tier or acuity, in the documented shape', async () => {
    const assessedAt = '2026-07-17T06:30:00.000Z';
    const { an } = await seedPatient(testDb, hospitalAId, {
      localTier: 'LOCAL_SEVERE',
      emergencyAcuity: 'EMERGENCY',
      isComplete: true,
      assessedAt,
    });

    const { status, body } = await callRoute(HCODE_A);
    expect(status).toBe(200);
    expect(body.uiEnabled).toBe(true);
    expect(body.summaries).toEqual([
      { an, localTier: 'LOCAL_SEVERE', emergencyAcuity: 'EMERGENCY', isComplete: true, assessedAt },
    ]);
  });

  it('excludes an ACTIVE admission with both axes null (nothing to render as a pill)', async () => {
    await seedPatient(testDb, hospitalAId, { localTier: null, emergencyAcuity: null });
    const { body } = await callRoute(HCODE_A);
    expect(body.summaries).toEqual([]);
  });

  it('excludes a non-ACTIVE (DELIVERED) admission even with a non-null tier', async () => {
    await seedPatient(testDb, hospitalAId, {
      laborStatus: 'DELIVERED',
      localTier: 'LOCAL_MILD',
    });
    const { body } = await callRoute(HCODE_A);
    expect(body.summaries).toEqual([]);
  });

  it('includes a row when only emergencyAcuity is set (localTier null)', async () => {
    const { an } = await seedPatient(testDb, hospitalAId, {
      localTier: null,
      emergencyAcuity: 'URGENT',
    });
    const { body } = await callRoute(HCODE_A);
    expect(body.summaries).toHaveLength(1);
    expect(body.summaries[0]).toEqual({
      an,
      localTier: null,
      emergencyAcuity: 'URGENT',
      isComplete: null,
      assessedAt: null,
    });
  });

  it('flag OFF: returns { uiEnabled: false, summaries: [] } even though qualifying rows exist', async () => {
    vi.stubEnv('MATERNAL_SCREEN_UI_ENABLED', 'false');
    await seedPatient(testDb, hospitalAId, {
      localTier: 'LOCAL_SEVERE',
      emergencyAcuity: 'EMERGENCY',
    });

    const { status, body } = await callRoute(HCODE_A);
    expect(status).toBe(200);
    expect(body).toEqual({ uiEnabled: false, summaries: [] });
  });

  it('tenant isolation: hospital A never sees hospital B summaries, even under a colliding AN', async () => {
    const sharedAn = 'AN-H4-SHARED';
    await seedPatient(testDb, hospitalAId, {
      an: sharedAn,
      localTier: 'LOCAL_MILD',
      emergencyAcuity: 'STABLE',
    });
    await seedPatient(testDb, hospitalBId, {
      an: sharedAn,
      localTier: 'LOCAL_SEVERE',
      emergencyAcuity: 'EMERGENCY',
    });

    const resultA = await callRoute(HCODE_A);
    expect(resultA.body.summaries).toHaveLength(1);
    expect(resultA.body.summaries[0].an).toBe(sharedAn);
    expect(resultA.body.summaries[0].localTier).toBe('LOCAL_MILD');

    const resultB = await callRoute(HCODE_B);
    expect(resultB.body.summaries).toHaveLength(1);
    expect(resultB.body.summaries[0].localTier).toBe('LOCAL_SEVERE');
  });

  it('returns an empty summaries array (not an error) for an hcode that does not exist', async () => {
    const { status, body } = await callRoute('99999');
    expect(status).toBe(200);
    expect(body).toEqual({ uiEnabled: true, summaries: [] });
  });
});
