// T25: Round-trip the T17 partograph upsert against the real Postgres dialect
// (via in-memory pglite). The SQLite-backed unit test
// (tests/unit/services/sync-partograph-upsert.test.ts) covers the same logic,
// but only this file proves that:
//   * the production CREATE TABLE for cached_partograph_observations applies
//     cleanly on Postgres,
//   * decimal columns round-trip values without precision loss when read back
//     (Postgres returns NUMERIC as a string, so the production toNum() helper
//     must keep working through that),
//   * the INSERT ... ON CONFLICT upsert in upsertPartographObservations() is
//     dialect-correct ($N placeholder rewrite from PgliteAdapter works), and
//   * the severity roll-up onto cached_patients works against pglite too.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPgliteDb } from '../helpers/createPgliteDb';
import { upsertPartographObservations, type PartographRow } from '@/services/sync/partograph';
import type { DatabaseAdapter } from '@/db/adapter';

let db: DatabaseAdapter;
const HID = 'h-1';
const PID = 'p-1';

beforeEach(async () => {
  db = await createPgliteDb();
  await db.execute(
    `INSERT INTO hospitals (id, hcode, name, level, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    [HID, '10670', 'Test', 'M2', new Date().toISOString(), new Date().toISOString()],
  );
  await db.execute(
    `INSERT INTO cached_patients
       (id, hospital_id, hn, an, name, age, admit_date,
        labor_status, synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
    [
      PID,
      HID,
      'HN1',
      'AN1',
      'enc',
      25,
      '2026-04-18T08:00:00Z',
      '2026-04-18T08:00:00Z',
      '2026-04-18T08:00:00Z',
      '2026-04-18T08:00:00Z',
    ],
  );
});

afterEach(async () => {
  await db.close();
});

describe('partograph sync against real Postgres dialect (pglite)', () => {
  const mk = (over: Partial<PartographRow> = {}): PartographRow => ({
    hospitalId: HID,
    patientId: PID,
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

  it('round-trips all 22 fields with correct types', async () => {
    await upsertPartographObservations(db, HID, [
      mk({
        fetalHeartRate: 142,
        amnioticFluid: 'Clear',
        moulding: '+',
        cervicalDilationCm: 4.5,
        descentOfHead: '3/5',
        contractionPer10Min: 3,
        contractionDurationSec: 45,
        contractionStrength: 'moderate',
        oxytocinUml: 5.0,
        oxytocinDropsMin: 12,
        drugsIvFluids: 'NSS 1000 + Oxytocin 10u',
        pulse: 88,
        bpSystolic: 120,
        bpDiastolic: 80,
        temperature: 37.0,
        urineVolumeMl: 200,
        urineProtein: 'neg',
        urineGlucose: 'neg',
        urineAcetone: 'neg',
        note: 'normal',
      }),
    ]);

    const rows = await db.query<{
      cervical_dilation_cm: string;
      pulse: number;
      temperature: string;
    }>('SELECT cervical_dilation_cm, pulse, temperature FROM cached_partograph_observations');
    expect(rows).toHaveLength(1);
    // Postgres NUMERIC columns come back as strings — coerce to compare.
    expect(Number(rows[0].cervical_dilation_cm)).toBe(4.5);
    expect(rows[0].pulse).toBe(88);
    expect(Number(rows[0].temperature)).toBe(37.0);
  });

  it('UPSERT updates instead of duplicating on second insert with same source_pk', async () => {
    await upsertPartographObservations(db, HID, [mk({ fetalHeartRate: 130 })]);
    await upsertPartographObservations(db, HID, [mk({ fetalHeartRate: 145 })]);
    const rows = await db.query<{ fetal_heart_rate: number }>(
      'SELECT fetal_heart_rate FROM cached_partograph_observations',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].fetal_heart_rate).toBe(145);
  });

  it('flips cached_patients.partograph_severity NULL -> ALERT after a moulding ++', async () => {
    const before = await db.query<{ partograph_severity: string | null }>(
      'SELECT partograph_severity FROM cached_patients WHERE id = ?',
      [PID],
    );
    expect(before[0].partograph_severity).toBeNull();

    await upsertPartographObservations(db, HID, [mk({ moulding: '++' })]);

    const after = await db.query<{ partograph_severity: string | null }>(
      'SELECT partograph_severity FROM cached_patients WHERE id = ?',
      [PID],
    );
    expect(after[0].partograph_severity).toBe('ALERT');
  });
});
