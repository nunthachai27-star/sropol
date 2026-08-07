// T17: upsertPartographObservations — UPSERT, delete, severity roll-up
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { upsertPartographObservations, type PartographRow } from '@/services/sync/partograph';

let db: DatabaseAdapter;
const HOSPITAL_ID = 'h-1';
const PATIENT_ID = 'p-1';

beforeEach(async () => {
  db = await createTestDb();
  await db.execute(
    `INSERT INTO hospitals (id, hcode, name, level, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    [HOSPITAL_ID, '10670', 'Test', 'M2', new Date().toISOString(), new Date().toISOString()],
  );
  await db.execute(
    `INSERT INTO cached_patients
       (id, hospital_id, hn, an, name, age, admit_date,
        labor_status, synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
    [
      PATIENT_ID,
      HOSPITAL_ID,
      'HN1',
      'AN1',
      'enc-name',
      25,
      '2026-04-18T08:00:00Z',
      '2026-04-18T08:00:00Z',
      '2026-04-18T08:00:00Z',
      '2026-04-18T08:00:00Z',
    ],
  );
});

const mkRow = (over: Partial<PartographRow>): PartographRow => ({
  hospitalId: HOSPITAL_ID,
  patientId: PATIENT_ID,
  sourceSystem: 'hosxp',
  sourcePk: '1',
  observeDatetime: '2026-04-18T10:00:00Z',
  hourNo: 1,
  fetalHeartRate: 130,
  amnioticFluid: 'Clear',
  amnioticTypeId: null,
  amnioticTypeName: null,
  moulding: null,
  cervicalDilationCm: null,
  descentOfHead: null,
  contractionPer10Min: null,
  contractionDurationSec: null,
  contractionStrength: null,
  oxytocinUml: null,
  oxytocinDropsMin: null,
  drugsIvFluids: null,
  pulse: null,
  bpSystolic: null,
  bpDiastolic: null,
  temperature: null,
  urineVolumeMl: null,
  urineProtein: null,
  urineGlucose: null,
  urineAcetone: null,
  note: null,
  entryStaff: null,
  entryDatetime: null,
  ...over,
});

describe('upsertPartographObservations', () => {
  it('inserts new rows', async () => {
    const r = await upsertPartographObservations(db, HOSPITAL_ID, [mkRow({})]);
    expect(r.upserted).toBe(1);
    const stored = await db.query('SELECT id, source_pk FROM cached_partograph_observations');
    expect(stored).toHaveLength(1);
  });

  it('UPSERTs on (hospital_id, source_system, source_pk) collision', async () => {
    await upsertPartographObservations(db, HOSPITAL_ID, [mkRow({ fetalHeartRate: 130 })]);
    await upsertPartographObservations(db, HOSPITAL_ID, [mkRow({ fetalHeartRate: 145 })]); // same source_pk
    const stored = await db.query<{ fetal_heart_rate: number }>(
      'SELECT fetal_heart_rate FROM cached_partograph_observations',
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].fetal_heart_rate).toBe(145);
  });

  it('rolls up severity to cached_patients', async () => {
    await upsertPartographObservations(db, HOSPITAL_ID, [mkRow({ moulding: '++' })]); // ALERT
    const p = await db.query<{
      partograph_severity: string | null;
      partograph_alert_count: number | null;
    }>(
      'SELECT partograph_severity, partograph_alert_count ' + 'FROM cached_patients WHERE id = ?',
      [PATIENT_ID],
    );
    expect(p[0].partograph_severity).toBe('ALERT');
    expect(p[0].partograph_alert_count).toBeGreaterThan(0);
  });

  it('reports severity changes', async () => {
    const r = await upsertPartographObservations(db, HOSPITAL_ID, [mkRow({ moulding: '+++' })]);
    expect(r.severityChanges).toEqual([
      {
        patientId: PATIENT_ID,
        an: 'AN1',
        from: null,
        to: 'CRITICAL',
        alertCount: expect.any(Number),
      },
    ]);
  });

  it('does not report severity change when severity stays the same', async () => {
    await upsertPartographObservations(db, HOSPITAL_ID, [mkRow({ sourcePk: '1', moulding: '++' })]);
    const r = await upsertPartographObservations(db, HOSPITAL_ID, [
      mkRow({ sourcePk: '2', moulding: '++', observeDatetime: '2026-04-18T11:00:00Z' }),
    ]);
    expect(r.severityChanges).toEqual([]);
  });

  it('handles delete action by removing the row', async () => {
    await upsertPartographObservations(db, HOSPITAL_ID, [mkRow({})]);
    const r = await upsertPartographObservations(db, HOSPITAL_ID, [
      { ...mkRow({}), action: 'delete' },
    ]);
    expect(r.deleted).toBe(1);
    const stored = await db.query('SELECT id FROM cached_partograph_observations');
    expect(stored).toHaveLength(0);
  });

  it('concurrent upserts of the same source row produce ONE row and no unique-violation', async () => {
    const row = mkRow({ sourcePk: 'race-1' });
    const results = await Promise.allSettled([
      upsertPartographObservations(db, HOSPITAL_ID, [row]),
      upsertPartographObservations(db, HOSPITAL_ID, [row]),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const rows = await db.query(
      `SELECT id FROM cached_partograph_observations WHERE source_pk = 'race-1'`,
    );
    expect(rows.length).toBe(1);
  });

  it('a failing row rolls back the WHOLE batch (no partial ingestion)', async () => {
    const good = mkRow({ sourcePk: 'batch-1' });
    const bad = mkRow({ sourcePk: 'batch-2', patientId: crypto.randomUUID() }); // FK violation
    await expect(upsertPartographObservations(db, HOSPITAL_ID, [good, bad])).rejects.toThrow();
    const rows = await db.query(
      `SELECT id FROM cached_partograph_observations WHERE source_pk = 'batch-1'`,
    );
    expect(rows.length).toBe(0); // good row rolled back with the bad one
  });
});
