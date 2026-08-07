// T23: Extended partogram response — observations, alerts, severity, source.
// Exercises the GET /api/patients/[an]/partogram handler end-to-end against
// the shared in-memory pglite harness (same as tests/unit/api/partogram.test.ts).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { PartogramResponse } from '@/types/api';

// Mock the database connection and ensureInit so the route handler picks up
// our in-memory pglite test db rather than the real Postgres pool.
let testDb: DatabaseAdapter;

vi.mock('@/db/connection', () => ({
  getDatabase: async () => testDb,
}));

vi.mock('@/lib/ensure-init', () => ({
  ensureInit: async () => undefined,
}));

// Import the route under test AFTER the mocks are registered.
import { GET } from '@/app/api/patients/[an]/partogram/route';

describe('GET /api/patients/[an]/partogram — extended response', () => {
  let hospitalId: string;
  let patientId: string;
  const hcode = '10670';
  const an = 'AN-PG1';
  const admitDate = '2026-04-19T06:00:00Z';

  beforeEach(async () => {
    testDb = await createTestDb();
    await new SeedOrchestrator().run(testDb);

    const hospitals = await testDb.query<{ id: string }>(
      'SELECT id FROM hospitals WHERE hcode = ? LIMIT 1',
      [hcode],
    );
    hospitalId = hospitals[0].id;

    patientId = uuidv4();
    const now = new Date().toISOString();
    await testDb.execute(
      'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [patientId, hospitalId, 'HN-PG1', an, 'enc-name', 28, admitDate, 'ACTIVE', now, now, now],
    );
  });

  afterEach(async () => {
    await testDb.close();
  });

  // Helper — inserts a single observation row. Only fields useful for the
  // tests are exposed; everything else defaults to null.
  async function insertObs(opts: {
    observeDatetime: string;
    sourceSystem: 'hosxp' | 'webhook';
    moulding?: string | null;
    cervicalDilationCm?: number | null;
    fetalHeartRate?: number | null;
  }) {
    const id = uuidv4();
    const now = new Date().toISOString();
    await testDb.execute(
      `INSERT INTO cached_partograph_observations
        (id, patient_id, hospital_id, source_system, source_pk, observe_datetime,
         moulding, cervical_dilation_cm, fetal_heart_rate,
         synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        patientId,
        hospitalId,
        opts.sourceSystem,
        id,
        opts.observeDatetime,
        opts.moulding ?? null,
        opts.cervicalDilationCm ?? null,
        opts.fetalHeartRate ?? null,
        now,
        now,
        now,
      ],
    );
    return id;
  }

  async function callRoute(targetAn: string): Promise<{
    status: number;
    body: PartogramResponse | { error: string; code: string };
  }> {
    const res = await GET(
      // request not used by the handler
      {} as never,
      { params: Promise.resolve({ an: `${hcode}-${targetAn}` }) },
    );
    return { status: res.status, body: await res.json() };
  }

  it('returns empty observations + null severity when no rows exist', async () => {
    const { status, body } = await callRoute(an);
    expect(status).toBe(200);
    const r = body as PartogramResponse;
    expect(r.partogram.observations).toEqual([]);
    expect(r.partogram.alerts).toEqual([]);
    expect(r.partogram.severity.highest).toBeNull();
    expect(r.partogram.severity.counts).toEqual({
      critical: 0,
      alert: 0,
      warn: 0,
      info: 0,
    });
    expect(r.partogram.source).toBe('none');
    expect(r.partogram.lastObservedAt).toBeNull();
    expect(r.partogram.entries).toEqual([]);
    expect(r.partogram.startTime).toBe('2026-04-19T06:00:00.000Z');
  });

  it('flags ALERT moulding (++) and counts severity', async () => {
    await insertObs({
      observeDatetime: '2026-04-19T07:00:00Z',
      sourceSystem: 'hosxp',
      moulding: '++',
    });

    const { status, body } = await callRoute(an);
    expect(status).toBe(200);
    const r = body as PartogramResponse;
    expect(r.partogram.observations).toHaveLength(1);
    expect(r.partogram.observations[0].moulding).toBe('++');

    const mouldingAlerts = r.partogram.alerts.filter((a) => a.section === 'MOULDING');
    expect(mouldingAlerts).toHaveLength(1);
    expect(mouldingAlerts[0].severity).toBe('ALERT');

    expect(r.partogram.severity.highest).toBe('ALERT');
    expect(r.partogram.severity.counts.alert).toBe(1);
    expect(r.partogram.source).toBe('hosxp');
    expect(r.partogram.lastObservedAt).toBe('2026-04-19T07:00:00.000Z');
  });

  it('reports source=mixed when HOSxP and webhook rows coexist', async () => {
    await insertObs({
      observeDatetime: '2026-04-19T07:00:00Z',
      sourceSystem: 'hosxp',
    });
    await insertObs({
      observeDatetime: '2026-04-19T08:00:00Z',
      sourceSystem: 'webhook',
    });

    const { body } = await callRoute(an);
    const r = body as PartogramResponse;
    expect(r.partogram.source).toBe('mixed');
    expect(r.partogram.observations).toHaveLength(2);
  });

  it('populates legacy entries[] for non-null cervix rows', async () => {
    await insertObs({
      observeDatetime: '2026-04-19T07:00:00Z',
      sourceSystem: 'hosxp',
      cervicalDilationCm: 5,
    });
    // Row without dilation should NOT contribute to entries[].
    await insertObs({
      observeDatetime: '2026-04-19T08:00:00Z',
      sourceSystem: 'hosxp',
      fetalHeartRate: 140,
    });

    const { body } = await callRoute(an);
    const r = body as PartogramResponse;
    expect(r.partogram.entries).toHaveLength(1);
    expect(r.partogram.entries[0].dilationCm).toBe(5);
    expect(r.partogram.entries[0].measuredAt).toBe('2026-04-19T07:00:00.000Z');
  });

  it('returns 404 for unknown patient AN', async () => {
    const { status, body } = await callRoute('AN-UNKNOWN');
    expect(status).toBe(404);
    expect((body as { code: string }).code).toBe('NOT_FOUND');
  });
});
