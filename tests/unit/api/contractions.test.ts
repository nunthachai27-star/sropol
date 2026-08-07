// Contractions API route logic tests — tests the DB query + contraction calculation logic
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import { v4 as uuidv4 } from 'uuid';

describe('Contractions API Logic', () => {
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
      [patientId, hospitalId, 'HN-C1', 'AN-C1', 'enc-name', 30, now, 'ACTIVE', now, now, now],
    );
  });

  afterEach(async () => {
    await db.close();
  });

  // Helper: replicate the contraction calculation logic from route.ts
  async function getContractionsForAN(an: string) {
    const patients = await db.query<{ id: string }>(
      'SELECT id FROM cached_patients WHERE an = ? LIMIT 1',
      [an],
    );
    if (patients.length === 0) return null;

    const vitals = await db.query<{
      measured_at: string;
      cervix_cm: number | null;
    }>(
      'SELECT measured_at, cervix_cm FROM cached_vital_signs WHERE patient_id = ? ORDER BY measured_at ASC',
      [patients[0].id],
    );

    const contractions: {
      measuredAt: string;
      intervalMin: number;
      durationSec: null;
      intensity: 'MILD' | 'MODERATE' | 'STRONG';
    }[] = [];

    for (let i = 1; i < vitals.length; i++) {
      const prev = new Date(vitals[i - 1].measured_at).getTime();
      const curr = new Date(vitals[i].measured_at).getTime();
      const intervalMin = Math.round((curr - prev) / 60000);

      const cervixDiff = (vitals[i].cervix_cm ?? 0) - (vitals[i - 1].cervix_cm ?? 0);
      let intensity: 'MILD' | 'MODERATE' | 'STRONG' = 'MILD';
      if (cervixDiff >= 2) intensity = 'STRONG';
      else if (cervixDiff >= 1) intensity = 'MODERATE';

      contractions.push({
        measuredAt: vitals[i].measured_at,
        intervalMin,
        durationSec: null,
        intensity,
      });
    }

    return { contractions };
  }

  it('returns contraction data for valid AN with vital signs', async () => {
    const now = new Date().toISOString();
    // Insert vital signs with cervix measurements
    await db.execute(
      'INSERT INTO cached_vital_signs (id, patient_id, measured_at, cervix_cm, synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patientId, '2026-03-09T08:00:00Z', 3, now, now],
    );
    await db.execute(
      'INSERT INTO cached_vital_signs (id, patient_id, measured_at, cervix_cm, synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patientId, '2026-03-09T09:00:00Z', 4, now, now],
    );
    await db.execute(
      'INSERT INTO cached_vital_signs (id, patient_id, measured_at, cervix_cm, synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patientId, '2026-03-09T10:00:00Z', 6, now, now],
    );

    const result = await getContractionsForAN('AN-C1');
    expect(result).not.toBeNull();
    expect(result!.contractions).toHaveLength(2);

    // First contraction: 3cm -> 4cm, interval = 60 min, diff = 1 = MODERATE
    expect(result!.contractions[0].intervalMin).toBe(60);
    expect(result!.contractions[0].intensity).toBe('MODERATE');
    expect(result!.contractions[0].durationSec).toBeNull();

    // Second contraction: 4cm -> 6cm, interval = 60 min, diff = 2 = STRONG
    expect(result!.contractions[1].intervalMin).toBe(60);
    expect(result!.contractions[1].intensity).toBe('STRONG');
  });

  it('returns empty for patient without vital sign records', async () => {
    const result = await getContractionsForAN('AN-C1');
    expect(result).not.toBeNull();
    expect(result!.contractions).toHaveLength(0);
  });

  it('returns empty contractions when only one vital sign exists', async () => {
    const now = new Date().toISOString();
    await db.execute(
      'INSERT INTO cached_vital_signs (id, patient_id, measured_at, cervix_cm, synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patientId, '2026-03-09T08:00:00Z', 3, now, now],
    );

    const result = await getContractionsForAN('AN-C1');
    expect(result).not.toBeNull();
    // Need at least 2 measurements to calculate contractions
    expect(result!.contractions).toHaveLength(0);
  });

  it('returns null for unknown patient AN', async () => {
    const result = await getContractionsForAN('UNKNOWN-AN');
    expect(result).toBeNull();
  });

  it('calculates MILD intensity when cervix does not change', async () => {
    const now = new Date().toISOString();
    await db.execute(
      'INSERT INTO cached_vital_signs (id, patient_id, measured_at, cervix_cm, synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patientId, '2026-03-09T08:00:00Z', 5, now, now],
    );
    await db.execute(
      'INSERT INTO cached_vital_signs (id, patient_id, measured_at, cervix_cm, synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patientId, '2026-03-09T08:30:00Z', 5, now, now],
    );

    const result = await getContractionsForAN('AN-C1');
    expect(result!.contractions).toHaveLength(1);
    expect(result!.contractions[0].intensity).toBe('MILD');
    expect(result!.contractions[0].intervalMin).toBe(30);
  });
});
