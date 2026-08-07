// Partogram API route logic tests — tests the DB + partogram service logic
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import { generatePartogramEntries } from '@/services/partogram';
import { v4 as uuidv4 } from 'uuid';

describe('Partogram API Logic', () => {
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
      [
        patientId,
        hospitalId,
        'HN-P1',
        'AN-P1',
        'enc-name',
        28,
        '2026-03-09T06:00:00Z',
        'ACTIVE',
        now,
        now,
        now,
      ],
    );
  });

  afterEach(async () => {
    await db.close();
  });

  // Helper: replicate route logic — query DB then call service
  async function getPartogramForAN(an: string) {
    const patients = await db.query<{ id: string; admit_date: string }>(
      'SELECT id, admit_date FROM cached_patients WHERE an = ? LIMIT 1',
      [an],
    );
    if (patients.length === 0) return null;

    const patient = patients[0];
    const vitals = await db.query<{
      measured_at: string;
      cervix_cm: number;
    }>(
      'SELECT measured_at, cervix_cm FROM cached_vital_signs WHERE patient_id = ? AND cervix_cm IS NOT NULL ORDER BY measured_at ASC',
      [patient.id],
    );

    const vitalInputs = vitals.map((v) => ({
      measuredAt: v.measured_at,
      cervixCm: v.cervix_cm,
    }));

    const entries = generatePartogramEntries(vitalInputs);
    return {
      partogram: {
        startTime: new Date(patient.admit_date).toISOString(),
        entries,
      },
    };
  }

  it('returns partogram entries for patient with cervix data', async () => {
    const now = new Date().toISOString();
    // Insert cervix measurements progressing through active phase
    const measurements = [
      { time: '2026-03-09T06:00:00Z', cervix: 3 },
      { time: '2026-03-09T07:00:00Z', cervix: 4 },
      { time: '2026-03-09T08:00:00Z', cervix: 5 },
      { time: '2026-03-09T09:00:00Z', cervix: 6 },
      { time: '2026-03-09T10:00:00Z', cervix: 7 },
    ];

    for (const m of measurements) {
      await db.execute(
        'INSERT INTO cached_vital_signs (id, patient_id, measured_at, cervix_cm, synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [uuidv4(), patientId, m.time, m.cervix, now, now],
      );
    }

    const result = await getPartogramForAN('AN-P1');
    expect(result).not.toBeNull();
    expect(result!.partogram.entries).toHaveLength(5);
    expect(result!.partogram.startTime).toBe('2026-03-09T06:00:00.000Z');

    // First entry (3cm) is before active phase so no alert/action lines
    expect(result!.partogram.entries[0].dilationCm).toBe(3);
    expect(result!.partogram.entries[0].alertLineCm).toBeNull();
    expect(result!.partogram.entries[0].actionLineCm).toBeNull();

    // Second entry (4cm) starts active phase, should have alert/action lines
    expect(result!.partogram.entries[1].dilationCm).toBe(4);
    expect(result!.partogram.entries[1].alertLineCm).not.toBeNull();
  });

  it('returns empty entries for patient without cervix data', async () => {
    const now = new Date().toISOString();
    // Insert vital signs WITHOUT cervix data
    await db.execute(
      'INSERT INTO cached_vital_signs (id, patient_id, measured_at, maternal_hr, synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patientId, '2026-03-09T08:00:00Z', 80, now, now],
    );

    const result = await getPartogramForAN('AN-P1');
    expect(result).not.toBeNull();
    expect(result!.partogram.entries).toHaveLength(0);
  });

  it('includes alert and action line calculations', async () => {
    const now = new Date().toISOString();
    // Measurements starting at 4cm (active phase from the start)
    const measurements = [
      { time: '2026-03-09T08:00:00Z', cervix: 4 },
      { time: '2026-03-09T09:00:00Z', cervix: 5 },
      { time: '2026-03-09T10:00:00Z', cervix: 6 },
    ];

    for (const m of measurements) {
      await db.execute(
        'INSERT INTO cached_vital_signs (id, patient_id, measured_at, cervix_cm, synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [uuidv4(), patientId, m.time, m.cervix, now, now],
      );
    }

    const result = await getPartogramForAN('AN-P1');
    expect(result).not.toBeNull();

    const entries = result!.partogram.entries;
    expect(entries).toHaveLength(3);

    // All entries should have alert line values (all >= 4cm)
    for (const entry of entries) {
      expect(entry.alertLineCm).not.toBeNull();
      expect(entry.actionLineCm).not.toBeNull();
    }

    // Alert line at start time (4cm) should be 4
    expect(entries[0].alertLineCm).toBe(4);
    // Alert line at +1 hour should be 5 (1cm/hour progression)
    expect(entries[1].alertLineCm).toBe(5);
    // Alert line at +2 hours should be 6
    expect(entries[2].alertLineCm).toBe(6);

    // Action line is 4 hours behind alert line in dilation
    // At the alert line start time, action line = alert line value at time - 4h
    // Since action line starts 4 hours after alert line, at time 08:00
    // the action line is for time 08:00 on the action line, which starts at 12:00
    // So at 08:00 the action line value should be 4 (start of action line)
    expect(entries[0].actionLineCm).toBe(4);
  });

  it('returns null for unknown patient AN', async () => {
    const result = await getPartogramForAN('UNKNOWN-AN');
    expect(result).toBeNull();
  });
});
