// T071: Patient detail API tests — TDD: write tests FIRST
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { v4 as uuidv4 } from 'uuid';

describe('Patient Detail API Logic', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = await createTestDb();

    // Seed a hospital
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'hosp-1',
        '10670',
        'รพ.ขอนแก่น',
        'A_S',
        true,
        'ONLINE',
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    );

    // Seed a patient
    await db.execute(
      `INSERT INTO cached_patients (id, hospital_id, hn, an, name, cid, age, gravida, ga_weeks, anc_count, admit_date, height_cm, weight_kg, weight_diff_kg, fundal_height_cm, us_weight_g, hematocrit_pct, labor_status, synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'pat-1',
        'hosp-1',
        'HN001',
        'AN001',
        'encrypted-name',
        'encrypted-cid',
        28,
        1,
        38,
        5,
        '2024-01-15T08:00:00Z',
        155,
        65,
        12,
        32,
        3000,
        35,
        'ACTIVE',
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    );
  });

  it('returns full patient data with hospital info for valid AN', async () => {
    const patients = await db.query<{
      id: string;
      hn: string;
      an: string;
      name: string;
      age: number;
      gravida: number | null;
      ga_weeks: number | null;
      labor_status: string;
    }>(
      `SELECT cp.id, cp.hn, cp.an, cp.name, cp.age, cp.gravida, cp.ga_weeks, cp.labor_status
       FROM cached_patients cp WHERE cp.an = ?`,
      ['AN001'],
    );

    expect(patients.length).toBe(1);
    expect(patients[0].hn).toBe('HN001');
    expect(patients[0].age).toBe(28);
    expect(patients[0].gravida).toBe(1);
    expect(patients[0].labor_status).toBe('ACTIVE');
  });

  it('returns empty result for unknown AN', async () => {
    const patients = await db.query<{ id: string }>('SELECT id FROM cached_patients WHERE an = ?', [
      'UNKNOWN-AN',
    ]);
    expect(patients.length).toBe(0);
  });

  it('joins hospital info with patient data', async () => {
    const result = await db.query<{
      an: string;
      hcode: string;
      hospital_name: string;
      level: string;
    }>(
      `SELECT cp.an, h.hcode, h.name as hospital_name, h.level
       FROM cached_patients cp
       JOIN hospitals h ON h.id = cp.hospital_id
       WHERE cp.an = ?`,
      ['AN001'],
    );

    expect(result.length).toBe(1);
    expect(result[0].hcode).toBe('10670');
    expect(result[0].hospital_name).toBe('รพ.ขอนแก่น');
    expect(result[0].level).toBe('A_S');
  });

  it('retrieves latest CPD score for patient', async () => {
    const scoreId = uuidv4();
    await db.execute(
      `INSERT INTO cpd_scores (id, patient_id, score, risk_level, recommendation, factor_gravida, factor_anc_count, factor_ga_weeks, factor_height_cm, factor_weight_diff, factor_fundal_ht, factor_us_weight, factor_hematocrit, missing_factors, calculated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scoreId,
        'pat-1',
        6,
        'MEDIUM',
        'เฝ้าระวังใกล้ชิด, เตรียมพร้อมส่งต่อ',
        2,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        '[]',
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    );

    const scores = await db.query<{ score: number; risk_level: string }>(
      'SELECT score, risk_level FROM cpd_scores WHERE patient_id = ? ORDER BY calculated_at DESC LIMIT 1',
      ['pat-1'],
    );

    expect(scores.length).toBe(1);
    expect(scores[0].score).toBe(6);
    expect(scores[0].risk_level).toBe('MEDIUM');
  });
});
