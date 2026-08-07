// High-risk patients service tests — TDD
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import { getHighRiskPatients } from '@/services/dashboard';
import { v4 as uuidv4 } from 'uuid';

describe('getHighRiskPatients', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('should return empty array when no patients exist', async () => {
    const result = await getHighRiskPatients(db);
    expect(result).toEqual([]);
  });

  it('returns ALL active patients — high first, LOW included, unscored last', async () => {
    const hospitals = await db.query<{ id: string }>(
      "SELECT id FROM hospitals WHERE hcode = '10670'",
    );
    const hospitalId = hospitals[0].id;
    const now = new Date().toISOString();

    // Insert 3 patients: LOW, MEDIUM, HIGH
    const patLow = uuidv4();
    const patMed = uuidv4();
    const patHigh = uuidv4();

    for (const [id, hn, an] of [
      [patLow, 'HN-L1', 'AN-L1'],
      [patMed, 'HN-M1', 'AN-M1'],
      [patHigh, 'HN-H1', 'AN-H1'],
    ] as const) {
      await db.execute(
        'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, ga_weeks, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, hospitalId, hn, an, 'enc-name', 28, 38, now, 'ACTIVE', now, now, now],
      );
    }

    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patLow, 2, 'LOW', now, now],
    );
    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patMed, 7, 'MEDIUM', now, now],
    );
    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patHigh, 12, 'HIGH', now, now],
    );

    // A fourth ACTIVE patient with no CPD score at all — must still appear
    // (the INNER JOIN used to silently drop her), sorted last.
    await db.execute(
      'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, ga_weeks, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [uuidv4(), hospitalId, 'HN-U1', 'AN-U1', 'enc-name', 30, 36, now, 'ACTIVE', now, now, now],
    );

    const result = await getHighRiskPatients(db);
    expect(result).toHaveLength(4);
    // Score DESC: HIGH (12), MEDIUM (7), LOW (2), then unscored.
    expect(result.map((r) => r.riskLevel)).toEqual(['HIGH', 'MEDIUM', 'LOW', 'UNSCORED']);
    expect(result[0].cpdScore).toBe(12);
    expect(result[3].cpdScore).toBe(0);
    expect(result[3].an).toBe('AN-U1');
  });

  it('should order by score DESC (highest risk first)', async () => {
    const hospitals = await db.query<{ id: string }>(
      "SELECT id FROM hospitals WHERE hcode = '10670'",
    );
    const hospitalId = hospitals[0].id;
    const now = new Date().toISOString();

    const pat1 = uuidv4();
    const pat2 = uuidv4();
    const pat3 = uuidv4();

    for (const [id, hn, an] of [
      [pat1, 'HN-1', 'AN-1'],
      [pat2, 'HN-2', 'AN-2'],
      [pat3, 'HN-3', 'AN-3'],
    ] as const) {
      await db.execute(
        'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, hospitalId, hn, an, 'enc-name', 30, now, 'ACTIVE', now, now, now],
      );
    }

    // Scores: 8, 15, 10 — should return in order 15, 10, 8
    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), pat1, 8, 'HIGH', now, now],
    );
    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), pat2, 15, 'HIGH', now, now],
    );
    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), pat3, 10, 'HIGH', now, now],
    );

    const result = await getHighRiskPatients(db);
    expect(result[0].cpdScore).toBe(15);
    expect(result[1].cpdScore).toBe(10);
    expect(result[2].cpdScore).toBe(8);
  });

  it('should exclude non-ACTIVE patients', async () => {
    const hospitals = await db.query<{ id: string }>(
      "SELECT id FROM hospitals WHERE hcode = '10670'",
    );
    const hospitalId = hospitals[0].id;
    const now = new Date().toISOString();

    const patActive = uuidv4();
    const patDelivered = uuidv4();

    await db.execute(
      'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [patActive, hospitalId, 'HN-A1', 'AN-A1', 'enc-name', 25, now, 'ACTIVE', now, now, now],
    );
    await db.execute(
      'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [patDelivered, hospitalId, 'HN-D1', 'AN-D1', 'enc-name', 30, now, 'DELIVERED', now, now, now],
    );

    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patActive, 12, 'HIGH', now, now],
    );
    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patDelivered, 14, 'HIGH', now, now],
    );

    const result = await getHighRiskPatients(db);
    expect(result).toHaveLength(1);
    expect(result[0].an).toBe('AN-A1');
  });

  it('should include hospital name and hcode', async () => {
    const hospitals = await db.query<{ id: string; name: string }>(
      "SELECT id, name FROM hospitals WHERE hcode = '10670'",
    );
    const hospitalId = hospitals[0].id;
    const hospitalName = hospitals[0].name;
    const now = new Date().toISOString();

    const patId = uuidv4();
    await db.execute(
      'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [patId, hospitalId, 'HN-1', 'AN-1', 'enc-name', 28, now, 'ACTIVE', now, now, now],
    );
    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patId, 11, 'HIGH', now, now],
    );

    const result = await getHighRiskPatients(db);
    expect(result).toHaveLength(1);
    expect(result[0].hospital).toBe(hospitalName);
    expect(result[0].hcode).toBe('10670');
  });

  it('should include last vital sign timestamp', async () => {
    const hospitals = await db.query<{ id: string }>(
      "SELECT id FROM hospitals WHERE hcode = '10670'",
    );
    const hospitalId = hospitals[0].id;
    const now = new Date().toISOString();
    const vitalTime = '2026-03-08T14:30:00.000Z';

    const patId = uuidv4();
    await db.execute(
      'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [patId, hospitalId, 'HN-1', 'AN-1', 'enc-name', 28, now, 'ACTIVE', now, now, now],
    );
    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patId, 11, 'HIGH', now, now],
    );
    // Insert vital signs
    await db.execute(
      'INSERT INTO cached_vital_signs (id, patient_id, measured_at, synced_at, created_at) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), patId, '2026-03-08T10:00:00.000Z', now, now],
    );
    await db.execute(
      'INSERT INTO cached_vital_signs (id, patient_id, measured_at, synced_at, created_at) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), patId, vitalTime, now, now],
    );

    const result = await getHighRiskPatients(db);
    expect(result).toHaveLength(1);
    expect(result[0].lastVitalAt).toBe(vitalTime);
  });

  it('should return null lastVitalAt when no vital signs exist', async () => {
    const hospitals = await db.query<{ id: string }>(
      "SELECT id FROM hospitals WHERE hcode = '10670'",
    );
    const hospitalId = hospitals[0].id;
    const now = new Date().toISOString();

    const patId = uuidv4();
    await db.execute(
      'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [patId, hospitalId, 'HN-1', 'AN-1', 'enc-name', 28, now, 'ACTIVE', now, now, now],
    );
    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patId, 11, 'HIGH', now, now],
    );

    const result = await getHighRiskPatients(db);
    expect(result[0].lastVitalAt).toBeNull();
  });

  it('should use latest CPD score when multiple exist', async () => {
    const hospitals = await db.query<{ id: string }>(
      "SELECT id FROM hospitals WHERE hcode = '10670'",
    );
    const hospitalId = hospitals[0].id;
    const now = new Date().toISOString();

    const patId = uuidv4();
    await db.execute(
      'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [patId, hospitalId, 'HN-1', 'AN-1', 'enc-name', 28, now, 'ACTIVE', now, now, now],
    );

    // Older score: LOW (should be ignored)
    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patId, 2, 'LOW', '2026-03-07T10:00:00.000Z', '2026-03-07T10:00:00.000Z'],
    );
    // Newer score: HIGH (should be used)
    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patId, 12, 'HIGH', '2026-03-08T10:00:00.000Z', '2026-03-08T10:00:00.000Z'],
    );

    const result = await getHighRiskPatients(db);
    expect(result).toHaveLength(1);
    expect(result[0].cpdScore).toBe(12);
    expect(result[0].riskLevel).toBe('HIGH');
  });

  it('should respect the limit parameter', async () => {
    const hospitals = await db.query<{ id: string }>(
      "SELECT id FROM hospitals WHERE hcode = '10670'",
    );
    const hospitalId = hospitals[0].id;
    const now = new Date().toISOString();

    // Insert 5 HIGH-risk patients
    for (let i = 0; i < 5; i++) {
      const patId = uuidv4();
      await db.execute(
        'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [patId, hospitalId, `HN-${i}`, `AN-${i}`, 'enc-name', 28, now, 'ACTIVE', now, now, now],
      );
      await db.execute(
        'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [uuidv4(), patId, 10 + i, 'HIGH', now, now],
      );
    }

    const result = await getHighRiskPatients(db, 3);
    expect(result).toHaveLength(3);
    // Highest scores first
    expect(result[0].cpdScore).toBe(14);
    expect(result[1].cpdScore).toBe(13);
    expect(result[2].cpdScore).toBe(12);
  });

  // The panel's "ALL ACTIVE" tab promises the complete province roster; the
  // old default cap (50) sat above nothing — historical census peaked 34–39
  // and stale-ACTIVE incidents push past 50, silently truncating the roster
  // and every count derived from it.
  it('default cap sits far above any real ward census (no truncation at 60 active)', async () => {
    const hospitals = await db.query<{ id: string }>(
      "SELECT id FROM hospitals WHERE hcode = '10670'",
    );
    const hospitalId = hospitals[0].id;
    const now = new Date().toISOString();

    for (let i = 0; i < 60; i++) {
      const patId = uuidv4();
      await db.execute(
        'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [patId, hospitalId, `HN-C${i}`, `AN-C${i}`, 'enc-name', 28, now, 'ACTIVE', now, now, now],
      );
    }

    const result = await getHighRiskPatients(db);
    expect(result).toHaveLength(60);
  });

  it('should include patients from multiple hospitals', async () => {
    const hospitals = await db.query<{ id: string; hcode: string }>(
      "SELECT id, hcode FROM hospitals WHERE hcode IN ('10670', '11000') ORDER BY hcode",
    );
    const now = new Date().toISOString();

    for (const hosp of hospitals) {
      const patId = uuidv4();
      await db.execute(
        'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          patId,
          hosp.id,
          `HN-${hosp.hcode}`,
          `AN-${hosp.hcode}`,
          'enc-name',
          30,
          now,
          'ACTIVE',
          now,
          now,
          now,
        ],
      );
      await db.execute(
        'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [uuidv4(), patId, 11, 'HIGH', now, now],
      );
    }

    const result = await getHighRiskPatients(db);
    expect(result).toHaveLength(2);
    const hcodes = result.map((r) => r.hcode);
    expect(hcodes).toContain('10670');
    expect(hcodes).toContain('11000');
  });

  it('should return all expected fields with correct types', async () => {
    const hospitals = await db.query<{ id: string }>(
      "SELECT id FROM hospitals WHERE hcode = '10670'",
    );
    const hospitalId = hospitals[0].id;
    const admitDate = '2026-03-08T08:00:00.000Z';
    const now = new Date().toISOString();

    const patId = uuidv4();
    await db.execute(
      'INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, ga_weeks, admit_date, labor_status, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        patId,
        hospitalId,
        'HN-001',
        'AN-001',
        'enc-patient-name',
        28,
        38,
        admitDate,
        'ACTIVE',
        now,
        now,
        now,
      ],
    );
    await db.execute(
      'INSERT INTO cpd_scores (id, patient_id, score, risk_level, calculated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), patId, 11, 'HIGH', now, now],
    );

    const result = await getHighRiskPatients(db);
    expect(result).toHaveLength(1);
    const patient = result[0];

    expect(patient.an).toBe('AN-001');
    expect(patient.hn).toBe('HN-001');
    expect(patient.name).toBe('enc-patient-name');
    expect(patient.age).toBe(28);
    expect(patient.gaWeeks).toBe(38);
    expect(patient.cpdScore).toBe(11);
    expect(patient.riskLevel).toBe('HIGH');
    expect(patient.hcode).toBe('10670');
    expect(typeof patient.hospital).toBe('string');
    expect(patient.admitDate).toBe(admitDate);
    expect(patient.lastVitalAt).toBeNull();
  });
});
