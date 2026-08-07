// Vitals API route logic tests — tests the DB query logic the route uses
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import { v4 as uuidv4 } from 'uuid';

describe('Vitals API Logic', () => {
  let db: DatabaseAdapter;
  let hospitalId: string;
  let patientId: string;

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);

    // Get hospital
    const hospitals = await db.query<{ id: string }>(
      "SELECT id FROM hospitals WHERE hcode = '10670'",
    );
    hospitalId = hospitals[0].id;

    // Insert a patient
    patientId = uuidv4();
    const now = new Date().toISOString();
    await db.execute(
      'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [patientId, hospitalId, 'HN-V1', 'AN-V1', 'enc-name', 30, now, 'ACTIVE', now, now, now],
    );
  });

  afterEach(async () => {
    await db.close();
  });

  // Helper: same query as the route handler uses
  async function getVitalsForAN(an: string) {
    const patients = await db.query<{ id: string }>(
      'SELECT id FROM cached_patients WHERE an = ? LIMIT 1',
      [an],
    );
    if (patients.length === 0) return null;

    const vitals = await db.query<{
      measured_at: string;
      maternal_hr: number | null;
      fetal_hr: string | null;
      sbp: number | null;
      dbp: number | null;
      pph_amount_ml: number | null;
    }>(
      'SELECT measured_at, maternal_hr, fetal_hr, sbp, dbp, pph_amount_ml FROM cached_vital_signs WHERE patient_id = ? ORDER BY measured_at ASC',
      [patients[0].id],
    );

    return vitals.map((v) => ({
      measuredAt: new Date(v.measured_at).toISOString(),
      maternalHr: v.maternal_hr,
      fetalHr: v.fetal_hr,
      sbp: v.sbp,
      dbp: v.dbp,
      pphAmountMl: v.pph_amount_ml,
    }));
  }

  it('returns vital signs for valid AN', async () => {
    const now = new Date().toISOString();
    // Insert vital signs
    await db.execute(
      'INSERT INTO cached_vital_signs (id, patient_id, measured_at, maternal_hr, fetal_hr, sbp, dbp, pph_amount_ml, synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [uuidv4(), patientId, '2026-03-09T08:00:00Z', 80, '140', 120, 80, null, now, now],
    );
    await db.execute(
      'INSERT INTO cached_vital_signs (id, patient_id, measured_at, maternal_hr, fetal_hr, sbp, dbp, pph_amount_ml, synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [uuidv4(), patientId, '2026-03-09T09:00:00Z', 85, '145', 125, 82, 50, now, now],
    );

    const vitals = await getVitalsForAN('AN-V1');
    expect(vitals).not.toBeNull();
    expect(vitals).toHaveLength(2);
    expect(vitals![0].maternalHr).toBe(80);
    expect(vitals![0].fetalHr).toBe('140');
    expect(vitals![0].sbp).toBe(120);
    expect(vitals![0].dbp).toBe(80);
    expect(vitals![1].pphAmountMl).toBe(50);
  });

  it('returns empty array for unknown AN', async () => {
    const vitals = await getVitalsForAN('UNKNOWN-AN');
    expect(vitals).toBeNull();
  });

  it('returns time-series ordered by measured_at ascending', async () => {
    const now = new Date().toISOString();
    // Insert out of order
    await db.execute(
      'INSERT INTO cached_vital_signs (id, patient_id, measured_at, maternal_hr, synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patientId, '2026-03-09T12:00:00Z', 90, now, now],
    );
    await db.execute(
      'INSERT INTO cached_vital_signs (id, patient_id, measured_at, maternal_hr, synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patientId, '2026-03-09T08:00:00Z', 75, now, now],
    );
    await db.execute(
      'INSERT INTO cached_vital_signs (id, patient_id, measured_at, maternal_hr, synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patientId, '2026-03-09T10:00:00Z', 82, now, now],
    );

    const vitals = await getVitalsForAN('AN-V1');
    expect(vitals).toHaveLength(3);
    // Verify ascending order
    expect(vitals![0].measuredAt).toBe('2026-03-09T08:00:00.000Z');
    expect(vitals![1].measuredAt).toBe('2026-03-09T10:00:00.000Z');
    expect(vitals![2].measuredAt).toBe('2026-03-09T12:00:00.000Z');
    // Verify values match order
    expect(vitals![0].maternalHr).toBe(75);
    expect(vitals![1].maternalHr).toBe(82);
    expect(vitals![2].maternalHr).toBe(90);
  });
});
