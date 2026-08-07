// Integration tests: full data flows through the service layer using realistic Thai hospital data
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { createTestDb } from '../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { encrypt, generateKey } from '@/lib/encryption';
import { calculateCpdScore } from '@/services/cpd-score';
import { generatePartogramEntries } from '@/services/partogram';
import { logAccess } from '@/services/audit';
import { getProvinceDashboard, getHospitalPatientList } from '@/services/dashboard';
import { getHealthStatus } from '@/services/health';
import { RiskLevel } from '@/types/domain';

// Shared test encryption key (64-char hex = 32 bytes)
const TEST_ENCRYPTION_KEY = generateKey();

// ---------------------------------------------------------------------------
// Helper: seed realistic patient, vital sign, and CPD data
// ---------------------------------------------------------------------------
interface SeededData {
  hospitalIds: Record<string, string>; // hcode -> id
  patientIds: string[];
  userId: string;
}

async function seedRealisticData(db: DatabaseAdapter): Promise<SeededData> {
  const now = new Date().toISOString();

  // Get 3 hospitals seeded by the orchestrator
  const hospitals = await db.query<{ id: string; hcode: string }>(
    "SELECT id, hcode FROM hospitals WHERE hcode IN ('10670','11000','11002') ORDER BY hcode",
  );
  const hospitalIds: Record<string, string> = {};
  for (const h of hospitals) hospitalIds[h.hcode] = h.id;

  const patientIds: string[] = [];
  const cidRaw1 = '0000000000011';
  const cidHash1 = createHash('sha256').update(cidRaw1).digest('hex');
  const cidRaw2 = '0000000000012';
  const cidHash2 = createHash('sha256').update(cidRaw2).digest('hex');
  const cidRaw3 = '0000000000013';
  const cidHash3 = createHash('sha256').update(cidRaw3).digest('hex');

  // Patient 1: HIGH risk at hospital 10670 -- gravida 1, short height, high US weight, low HCT
  const p1Id = uuidv4();
  patientIds.push(p1Id);
  await db.execute(
    `INSERT INTO cached_patients
       (id, hospital_id, hn, an, name, cid, cid_hash, age, gravida, ga_weeks, anc_count,
        admit_date, height_cm, weight_kg, weight_diff_kg, fundal_height_cm, us_weight_g,
        hematocrit_pct, labor_status, synced_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      p1Id,
      hospitalIds['10670'],
      'HN-0001',
      'AN-0001',
      encrypt('นาง สมหญิง ชุมแพ', TEST_ENCRYPTION_KEY),
      encrypt(cidRaw1, TEST_ENCRYPTION_KEY),
      cidHash1,
      32,
      1,
      42,
      2,
      '2026-03-01T08:00:00.000Z',
      148,
      78,
      21,
      38,
      4200,
      28,
      'ACTIVE',
      now,
      now,
      now,
    ],
  );

  // Patient 2: MEDIUM risk at hospital 10671
  const p2Id = uuidv4();
  patientIds.push(p2Id);
  await db.execute(
    `INSERT INTO cached_patients
       (id, hospital_id, hn, an, name, cid, cid_hash, age, gravida, ga_weeks, anc_count,
        admit_date, height_cm, weight_kg, weight_diff_kg, fundal_height_cm, us_weight_g,
        hematocrit_pct, labor_status, synced_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      p2Id,
      hospitalIds['11000'],
      'HN-0002',
      'AN-0002',
      encrypt('นาง วิภา น้ำพอง', TEST_ENCRYPTION_KEY),
      encrypt(cidRaw2, TEST_ENCRYPTION_KEY),
      cidHash2,
      26,
      2,
      40,
      3,
      '2026-03-02T10:00:00.000Z',
      153,
      68,
      16,
      35,
      3200,
      33,
      'ACTIVE',
      now,
      now,
      now,
    ],
  );

  // Patient 3: LOW risk at hospital 10672
  const p3Id = uuidv4();
  patientIds.push(p3Id);
  await db.execute(
    `INSERT INTO cached_patients
       (id, hospital_id, hn, an, name, cid, cid_hash, age, gravida, ga_weeks, anc_count,
        admit_date, height_cm, weight_kg, weight_diff_kg, fundal_height_cm, us_weight_g,
        hematocrit_pct, labor_status, synced_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      p3Id,
      hospitalIds['11002'],
      'HN-0003',
      'AN-0003',
      encrypt('น.ส. สุดา บ้านไผ่', TEST_ENCRYPTION_KEY),
      encrypt(cidRaw3, TEST_ENCRYPTION_KEY),
      cidHash3,
      22,
      2,
      38,
      6,
      '2026-03-03T14:00:00.000Z',
      162,
      60,
      12,
      32,
      2800,
      36,
      'ACTIVE',
      now,
      now,
      now,
    ],
  );

  // Patient 4: Same CID as Patient 1 — transferred to hospital 10671
  const p4Id = uuidv4();
  patientIds.push(p4Id);
  await db.execute(
    `INSERT INTO cached_patients
       (id, hospital_id, hn, an, name, cid, cid_hash, age, gravida, ga_weeks, anc_count,
        admit_date, height_cm, weight_kg, weight_diff_kg, fundal_height_cm, us_weight_g,
        hematocrit_pct, labor_status, synced_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      p4Id,
      hospitalIds['11000'],
      'HN-0004',
      'AN-0004',
      encrypt('นาง สมหญิง ชุมแพ', TEST_ENCRYPTION_KEY),
      encrypt(cidRaw1, TEST_ENCRYPTION_KEY),
      cidHash1,
      32,
      1,
      42,
      2,
      '2026-03-05T06:00:00.000Z',
      148,
      78,
      21,
      38,
      4200,
      28,
      'ACTIVE',
      now,
      now,
      now,
    ],
  );

  // Patient 5: Delivered at hospital 10670
  const p5Id = uuidv4();
  patientIds.push(p5Id);
  await db.execute(
    `INSERT INTO cached_patients
       (id, hospital_id, hn, an, name, cid, cid_hash, age, gravida, ga_weeks, anc_count,
        admit_date, height_cm, weight_kg, weight_diff_kg, fundal_height_cm, us_weight_g,
        hematocrit_pct, labor_status, delivered_at, synced_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      p5Id,
      hospitalIds['10670'],
      'HN-0005',
      'AN-0005',
      encrypt('นาง มาลี ชุมแพ', TEST_ENCRYPTION_KEY),
      null,
      null,
      29,
      3,
      39,
      10,
      '2026-02-25T08:00:00.000Z',
      160,
      65,
      14,
      33,
      3000,
      35,
      'DELIVERED',
      '2026-02-28T12:00:00.000Z',
      now,
      now,
      now,
    ],
  );

  // --- Insert CPD scores for active patients ---
  // Patient 1 — HIGH
  const cpdP1 = calculateCpdScore({
    gravida: 1,
    ancCount: 2,
    gaWeeks: 42,
    heightCm: 148,
    weightDiffKg: 21,
    fundalHeightCm: 38,
    usWeightG: 4200,
    hematocritPct: 28,
  });
  await db.execute(
    `INSERT INTO cpd_scores
       (id, patient_id, score, risk_level, recommendation, factor_gravida, factor_anc_count,
        factor_ga_weeks, factor_height_cm, factor_weight_diff, factor_fundal_ht,
        factor_us_weight, factor_hematocrit, missing_factors, calculated_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      uuidv4(),
      p1Id,
      cpdP1.score,
      cpdP1.riskLevel,
      cpdP1.recommendation,
      cpdP1.factorScores.gravida ?? null,
      cpdP1.factorScores.ancCount ?? null,
      cpdP1.factorScores.gaWeeks ?? null,
      cpdP1.factorScores.heightCm ?? null,
      cpdP1.factorScores.weightDiffKg ?? null,
      cpdP1.factorScores.fundalHeightCm ?? null,
      cpdP1.factorScores.usWeightG ?? null,
      cpdP1.factorScores.hematocritPct ?? null,
      JSON.stringify(cpdP1.missingFactors),
      now,
      now,
    ],
  );

  // Patient 2 — MEDIUM
  const cpdP2 = calculateCpdScore({
    gravida: 2,
    ancCount: 3,
    gaWeeks: 40,
    heightCm: 153,
    weightDiffKg: 16,
    fundalHeightCm: 35,
    usWeightG: 3200,
    hematocritPct: 33,
  });
  await db.execute(
    `INSERT INTO cpd_scores
       (id, patient_id, score, risk_level, recommendation, factor_gravida, factor_anc_count,
        factor_ga_weeks, factor_height_cm, factor_weight_diff, factor_fundal_ht,
        factor_us_weight, factor_hematocrit, missing_factors, calculated_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      uuidv4(),
      p2Id,
      cpdP2.score,
      cpdP2.riskLevel,
      cpdP2.recommendation,
      cpdP2.factorScores.gravida ?? null,
      cpdP2.factorScores.ancCount ?? null,
      cpdP2.factorScores.gaWeeks ?? null,
      cpdP2.factorScores.heightCm ?? null,
      cpdP2.factorScores.weightDiffKg ?? null,
      cpdP2.factorScores.fundalHeightCm ?? null,
      cpdP2.factorScores.usWeightG ?? null,
      cpdP2.factorScores.hematocritPct ?? null,
      JSON.stringify(cpdP2.missingFactors),
      now,
      now,
    ],
  );

  // Patient 3 — LOW
  const cpdP3 = calculateCpdScore({
    gravida: 2,
    ancCount: 6,
    gaWeeks: 38,
    heightCm: 162,
    weightDiffKg: 12,
    fundalHeightCm: 32,
    usWeightG: 2800,
    hematocritPct: 36,
  });
  await db.execute(
    `INSERT INTO cpd_scores
       (id, patient_id, score, risk_level, recommendation, factor_gravida, factor_anc_count,
        factor_ga_weeks, factor_height_cm, factor_weight_diff, factor_fundal_ht,
        factor_us_weight, factor_hematocrit, missing_factors, calculated_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      uuidv4(),
      p3Id,
      cpdP3.score,
      cpdP3.riskLevel,
      cpdP3.recommendation,
      cpdP3.factorScores.gravida ?? null,
      cpdP3.factorScores.ancCount ?? null,
      cpdP3.factorScores.gaWeeks ?? null,
      cpdP3.factorScores.heightCm ?? null,
      cpdP3.factorScores.weightDiffKg ?? null,
      cpdP3.factorScores.fundalHeightCm ?? null,
      cpdP3.factorScores.usWeightG ?? null,
      cpdP3.factorScores.hematocritPct ?? null,
      JSON.stringify(cpdP3.missingFactors),
      now,
      now,
    ],
  );

  // Patient 4 — same factors as Patient 1, HIGH
  await db.execute(
    `INSERT INTO cpd_scores
       (id, patient_id, score, risk_level, recommendation, factor_gravida, factor_anc_count,
        factor_ga_weeks, factor_height_cm, factor_weight_diff, factor_fundal_ht,
        factor_us_weight, factor_hematocrit, missing_factors, calculated_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      uuidv4(),
      p4Id,
      cpdP1.score,
      cpdP1.riskLevel,
      cpdP1.recommendation,
      cpdP1.factorScores.gravida ?? null,
      cpdP1.factorScores.ancCount ?? null,
      cpdP1.factorScores.gaWeeks ?? null,
      cpdP1.factorScores.heightCm ?? null,
      cpdP1.factorScores.weightDiffKg ?? null,
      cpdP1.factorScores.fundalHeightCm ?? null,
      cpdP1.factorScores.usWeightG ?? null,
      cpdP1.factorScores.hematocritPct ?? null,
      JSON.stringify(cpdP1.missingFactors),
      now,
      now,
    ],
  );

  // --- Seed vital signs for Patient 1 (6 readings over 12 hours) ---
  const baseTime = new Date('2026-03-01T08:00:00.000Z');
  const vitalReadings = [
    {
      hoursOffset: 0,
      maternalHr: 82,
      fetalHr: '140',
      sbp: 120,
      dbp: 78,
      cervixCm: 3,
      effPct: 40,
      station: '-3',
    },
    {
      hoursOffset: 2,
      maternalHr: 85,
      fetalHr: '142',
      sbp: 122,
      dbp: 80,
      cervixCm: 4,
      effPct: 50,
      station: '-2',
    },
    {
      hoursOffset: 4,
      maternalHr: 88,
      fetalHr: '138',
      sbp: 125,
      dbp: 82,
      cervixCm: 5,
      effPct: 60,
      station: '-1',
    },
    {
      hoursOffset: 6,
      maternalHr: 90,
      fetalHr: '144',
      sbp: 128,
      dbp: 84,
      cervixCm: 6,
      effPct: 70,
      station: '0',
    },
    {
      hoursOffset: 8,
      maternalHr: 92,
      fetalHr: '146',
      sbp: 130,
      dbp: 85,
      cervixCm: 7,
      effPct: 80,
      station: '+1',
    },
    {
      hoursOffset: 10,
      maternalHr: 95,
      fetalHr: '148',
      sbp: 132,
      dbp: 86,
      cervixCm: 8,
      effPct: 90,
      station: '+2',
    },
  ];
  for (const v of vitalReadings) {
    const measuredAt = new Date(baseTime.getTime() + v.hoursOffset * 3600000).toISOString();
    await db.execute(
      `INSERT INTO cached_vital_signs
         (id, patient_id, measured_at, maternal_hr, fetal_hr, sbp, dbp, cervix_cm,
          effacement_pct, station, synced_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uuidv4(),
        p1Id,
        measuredAt,
        v.maternalHr,
        v.fetalHr,
        v.sbp,
        v.dbp,
        v.cervixCm,
        v.effPct,
        v.station,
        now,
        now,
      ],
    );
  }

  // --- Seed a test user ---
  const userId = uuidv4();
  await db.execute(
    `INSERT INTO users (id, bms_user_name, bms_hospital_code, bms_position, role, is_active, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [userId, 'nurse_somying', '10670', 'Nurse', 'NURSE', true, now, now],
  );

  return { hospitalIds, patientIds, userId };
}

// ===========================================================================
// Tests
// ===========================================================================
describe('Full Flow Integration Tests', () => {
  let db: DatabaseAdapter;
  let seeded: SeededData;

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    seeded = await seedRealisticData(db);
  });

  afterEach(async () => {
    await db.close();
  });

  // -----------------------------------------------------------------------
  // Scenario 1: Dashboard data aggregation
  // -----------------------------------------------------------------------
  describe('Scenario 1: Dashboard data aggregation', () => {
    it('dashboard shows correct risk counts across hospitals', async () => {
      const result = await getProvinceDashboard(db);

      // Hospital 10670: 1 ACTIVE patient (P1=HIGH), P5 is DELIVERED so not counted
      const h10670 = result.hospitals.find((h) => h.hcode === '10670');
      expect(h10670).toBeDefined();
      expect(h10670!.counts.high).toBe(1);
      expect(h10670!.counts.medium).toBe(0);
      expect(h10670!.counts.low).toBe(0);
      expect(h10670!.counts.total).toBe(1);

      // Hospital 10671: 2 ACTIVE patients (P2=MEDIUM, P4=HIGH)
      const h11000 = result.hospitals.find((h) => h.hcode === '11000');
      expect(h11000).toBeDefined();
      expect(h11000!.counts.high).toBe(1);
      expect(h11000!.counts.medium).toBe(1);
      expect(h11000!.counts.total).toBe(2);

      // Hospital 10672: 1 ACTIVE patient (P3=LOW)
      const h11002 = result.hospitals.find((h) => h.hcode === '11002');
      expect(h11002).toBeDefined();
      expect(h11002!.counts.low).toBe(1);
      expect(h11002!.counts.total).toBe(1);

      // Summary totals
      expect(result.summary.totalHigh).toBe(2);
      expect(result.summary.totalMedium).toBe(1);
      expect(result.summary.totalLow).toBe(1);
      expect(result.summary.totalActive).toBe(4);
    });

    it('summary aggregates correctly even with hospitals having zero patients', async () => {
      const result = await getProvinceDashboard(db);

      // Total hospitals should be 26 (all KK community hospitals per MOPH)
      expect(result.hospitals).toHaveLength(26);

      // Most hospitals should have zero patients
      const emptyHospitals = result.hospitals.filter((h) => h.counts.total === 0);
      expect(emptyHospitals.length).toBe(23); // 26 - 3 with patients
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 2: CPD score calculation with real clinical data
  // -----------------------------------------------------------------------
  describe('Scenario 2: CPD score calculation with real clinical data', () => {
    it('calculates correct CPD score from realistic high-risk clinical factors', () => {
      // Patient with high-risk factors:
      // gravida=1 -> 2 (first pregnancy)
      // ancCount=2 -> 1.5 (< 4 visits)
      // gaWeeks=42 -> 1.5 (>= 40)
      // heightCm=148 -> 2 (< 150)
      // weightDiffKg=21 -> 2 (> 20)
      // fundalHeightCm=38 -> 2 (> 36)
      // usWeightG=4200 -> 2 (> 3500)
      // hematocritPct=28 -> 1.5 (< 30)
      // Total expected: 2 + 1.5 + 1.5 + 2 + 2 + 2 + 2 + 1.5 = 14.5
      const result = calculateCpdScore({
        gravida: 1,
        ancCount: 2,
        gaWeeks: 42,
        heightCm: 148,
        weightDiffKg: 21,
        fundalHeightCm: 38,
        usWeightG: 4200,
        hematocritPct: 28,
      });

      expect(result.score).toBe(14.5);
      expect(result.riskLevel).toBe(RiskLevel.HIGH);
      expect(result.missingFactors).toHaveLength(0);

      // Verify individual factor scores
      expect(result.factorScores.gravida).toBe(2);
      expect(result.factorScores.ancCount).toBe(1.5);
      expect(result.factorScores.gaWeeks).toBe(1.5);
      expect(result.factorScores.heightCm).toBe(2);
      expect(result.factorScores.weightDiffKg).toBe(2);
      expect(result.factorScores.fundalHeightCm).toBe(2);
      expect(result.factorScores.usWeightG).toBe(2);
      expect(result.factorScores.hematocritPct).toBe(1.5);
    });

    it('calculates correct CPD score for medium-risk factors', () => {
      // gravida=2 -> 0 (not first pregnancy)
      // ancCount=3 -> 1.5 (< 4)
      // gaWeeks=40 -> 1.5 (>= 40)
      // heightCm=153 -> 1 (150-154)
      // weightDiffKg=16 -> 1 (15-20)
      // fundalHeightCm=35 -> 1 (34-36)
      // usWeightG=3200 -> 1 (3001-3500)
      // hematocritPct=33 -> 0 (>= 30)
      // Total: 0 + 1.5 + 1.5 + 1 + 1 + 1 + 1 + 0 = 7
      const result = calculateCpdScore({
        gravida: 2,
        ancCount: 3,
        gaWeeks: 40,
        heightCm: 153,
        weightDiffKg: 16,
        fundalHeightCm: 35,
        usWeightG: 3200,
        hematocritPct: 33,
      });

      expect(result.score).toBe(7);
      expect(result.riskLevel).toBe(RiskLevel.MEDIUM);
    });

    it('calculates correct CPD score for low-risk factors', () => {
      // gravida=2 -> 0, ancCount=6 -> 0, gaWeeks=38 -> 0, heightCm=162 -> 0,
      // weightDiffKg=12 -> 0, fundalHeightCm=32 -> 0, usWeightG=2800 -> 0, hematocritPct=36 -> 0
      // Total: 0
      const result = calculateCpdScore({
        gravida: 2,
        ancCount: 6,
        gaWeeks: 38,
        heightCm: 162,
        weightDiffKg: 12,
        fundalHeightCm: 32,
        usWeightG: 2800,
        hematocritPct: 36,
      });

      expect(result.score).toBe(0);
      expect(result.riskLevel).toBe(RiskLevel.LOW);
    });

    it('CPD scores stored in DB match service calculation', async () => {
      // Read P1's stored CPD score and verify it matches calculateCpdScore output
      const stored = await db.query<{ score: number; risk_level: string }>(
        'SELECT score, risk_level FROM cpd_scores WHERE patient_id = ? ORDER BY calculated_at DESC LIMIT 1',
        [seeded.patientIds[0]],
      );
      expect(stored).toHaveLength(1);

      const recalculated = calculateCpdScore({
        gravida: 1,
        ancCount: 2,
        gaWeeks: 42,
        heightCm: 148,
        weightDiffKg: 21,
        fundalHeightCm: 38,
        usWeightG: 4200,
        hematocritPct: 28,
      });
      expect(stored[0].score).toBe(recalculated.score);
      expect(stored[0].risk_level).toBe(recalculated.riskLevel);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 3: Partogram with labor progression
  // -----------------------------------------------------------------------
  describe('Scenario 3: Partogram with labor progression', () => {
    it('generates correct partogram with alert and action lines', () => {
      // Cervix measurements over 8 hours:
      // 0h: 3cm (latent), 2h: 4cm (active starts), 4h: 5cm, 6h: 6cm, 8h: 7cm
      const baseTime = new Date('2026-03-01T08:00:00.000Z');
      const vitalSigns = [
        { measuredAt: new Date(baseTime.getTime() + 0 * 3600000).toISOString(), cervixCm: 3 },
        { measuredAt: new Date(baseTime.getTime() + 2 * 3600000).toISOString(), cervixCm: 4 },
        { measuredAt: new Date(baseTime.getTime() + 4 * 3600000).toISOString(), cervixCm: 5 },
        { measuredAt: new Date(baseTime.getTime() + 6 * 3600000).toISOString(), cervixCm: 6 },
        { measuredAt: new Date(baseTime.getTime() + 8 * 3600000).toISOString(), cervixCm: 7 },
      ];

      const entries = generatePartogramEntries(vitalSigns);

      expect(entries).toHaveLength(5);

      // Entry 0: 3cm — before active phase, alert/action lines should be null
      expect(entries[0].dilationCm).toBe(3);
      expect(entries[0].alertLineCm).toBeNull();
      expect(entries[0].actionLineCm).toBeNull();

      // Entry 1: 4cm — active phase starts, alert line starts at 4cm
      // At the exact start, alert line = 4cm
      expect(entries[1].dilationCm).toBe(4);
      expect(entries[1].alertLineCm).toBe(4);
      // Action line is 4 hours to the right, so at time T+2h the action line time hasn't started
      // Action line starts at T+2h+4h = T+6h with dilationCm=4
      // At T+2h (which is before the action line's start of T+6h), action line returns first value = 4
      expect(entries[1].actionLineCm).toBe(4);

      // Entry 2: 5cm at T+4h -> alert line at T+4h: started at T+2h with 4cm, rate 1cm/hr => 4 + 2 = 6
      expect(entries[2].dilationCm).toBe(5);
      expect(entries[2].alertLineCm).toBe(6);
      // Action line at T+4h: action line at T+6h is 4cm, T+4h is before that => 4
      expect(entries[2].actionLineCm).toBe(4);

      // Entry 3: 6cm at T+6h -> alert line: 4 + 4 = 8
      expect(entries[3].dilationCm).toBe(6);
      expect(entries[3].alertLineCm).toBe(8);
      // Action line at T+6h: action line starts at T+6h with 4cm => 4
      expect(entries[3].actionLineCm).toBe(4);

      // Entry 4: 7cm at T+8h -> alert line: 4 + 6 = 10
      expect(entries[4].dilationCm).toBe(7);
      expect(entries[4].alertLineCm).toBe(10);
      // Action line at T+8h: action started at T+6h (4cm), T+7h (5cm), T+8h (6cm) => 6
      expect(entries[4].actionLineCm).toBe(6);
    });

    it('returns empty entries for no vital signs', () => {
      const entries = generatePartogramEntries([]);
      expect(entries).toHaveLength(0);
    });

    it('handles all measurements below active phase threshold', () => {
      const vitalSigns = [
        { measuredAt: new Date('2026-03-01T08:00:00Z').toISOString(), cervixCm: 1 },
        { measuredAt: new Date('2026-03-01T10:00:00Z').toISOString(), cervixCm: 2 },
        { measuredAt: new Date('2026-03-01T12:00:00Z').toISOString(), cervixCm: 3 },
      ];

      const entries = generatePartogramEntries(vitalSigns);
      expect(entries).toHaveLength(3);
      for (const e of entries) {
        expect(e.alertLineCm).toBeNull();
        expect(e.actionLineCm).toBeNull();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 4: Patient vital sign trends
  // -----------------------------------------------------------------------
  describe('Scenario 4: Patient vital sign trends', () => {
    it('returns vital signs time series in correct chronological order', async () => {
      const vitals = await db.query<{
        measured_at: string;
        maternal_hr: number;
        fetal_hr: string;
        sbp: number;
        dbp: number;
        cervix_cm: number;
      }>(
        'SELECT measured_at, maternal_hr, fetal_hr, sbp, dbp, cervix_cm FROM cached_vital_signs WHERE patient_id = ? ORDER BY measured_at ASC',
        [seeded.patientIds[0]],
      );

      expect(vitals).toHaveLength(6);

      // Verify chronological order
      for (let i = 1; i < vitals.length; i++) {
        const prev = new Date(vitals[i - 1].measured_at).getTime();
        const curr = new Date(vitals[i].measured_at).getTime();
        expect(curr).toBeGreaterThan(prev);
      }

      // Verify each reading has all expected fields
      for (const v of vitals) {
        expect(v.maternal_hr).toBeGreaterThan(0);
        expect(v.fetal_hr).toBeTruthy();
        expect(v.sbp).toBeGreaterThan(0);
        expect(v.dbp).toBeGreaterThan(0);
        expect(v.cervix_cm).toBeGreaterThan(0);
      }

      // Verify progression — cervix should increase over time
      expect(vitals[0].cervix_cm).toBe(3);
      expect(vitals[5].cervix_cm).toBe(8);
    });

    it('vital signs are correctly linked to their patient', async () => {
      // Patient 1 has vitals
      const p1Vitals = await db.query<{ id: string }>(
        'SELECT id FROM cached_vital_signs WHERE patient_id = ?',
        [seeded.patientIds[0]],
      );
      expect(p1Vitals).toHaveLength(6);

      // Other patients have no vitals
      const p2Vitals = await db.query<{ id: string }>(
        'SELECT id FROM cached_vital_signs WHERE patient_id = ?',
        [seeded.patientIds[1]],
      );
      expect(p2Vitals).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 5: Hospital patient list with filters
  // -----------------------------------------------------------------------
  describe('Scenario 5: Hospital patient list with filters', () => {
    it('filters patients by status=active — only active patients returned', async () => {
      // Hospital 10670 has 1 ACTIVE (P1) and 1 DELIVERED (P5)
      const result = await getHospitalPatientList(db, '10670', { status: 'active' });
      expect(result.patients).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('filters patients by status=all — includes delivered', async () => {
      const result = await getHospitalPatientList(db, '10670', { status: 'all' });
      expect(result.patients).toHaveLength(2); // P1 active + P5 delivered
      expect(result.pagination.total).toBe(2);
    });

    it('filters patients by date range', async () => {
      // Hospital 10671: P2 admitted 2026-03-02, P4 admitted 2026-03-05
      const result = await getHospitalPatientList(db, '11000', {
        status: 'active',
        dateFrom: '2026-03-04',
        dateTo: '2026-03-06',
      });
      expect(result.patients).toHaveLength(1); // Only P4
    });

    it('pagination works correctly', async () => {
      // Hospital 10671 has 2 active patients
      const page1 = await getHospitalPatientList(db, '11000', {
        status: 'active',
        perPage: 1,
        page: 1,
      });
      expect(page1.patients).toHaveLength(1);
      expect(page1.pagination.total).toBe(2);
      expect(page1.pagination.totalPages).toBe(2);

      const page2 = await getHospitalPatientList(db, '11000', {
        status: 'active',
        perPage: 1,
        page: 2,
      });
      expect(page2.patients).toHaveLength(1);

      // The two pages should have different patients
      const an1 = (page1.patients[0] as Record<string, unknown>).an;
      const an2 = (page2.patients[0] as Record<string, unknown>).an;
      expect(an1).not.toBe(an2);
    });

    it('returns empty result for non-existent hospital code', async () => {
      const result = await getHospitalPatientList(db, '99999');
      expect(result.patients).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });

    it('patient list includes CPD score data', async () => {
      const result = await getHospitalPatientList(db, '10670', { status: 'active' });
      expect(result.patients).toHaveLength(1);

      const patient = result.patients[0] as Record<string, unknown>;
      expect(patient.cpd_score).toBeDefined();
      expect(patient.cpd_risk_level).toBe('HIGH');
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 6: Audit trail completeness
  // -----------------------------------------------------------------------
  describe('Scenario 6: Audit trail completeness', () => {
    it('creates audit log for patient data access', async () => {
      const userId = seeded.userId;

      // Log multiple access types
      await logAccess(db, {
        userId,
        action: 'VIEW_PATIENT',
        resourceType: 'patient',
        resourceId: seeded.patientIds[0],
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 Test',
      });

      await logAccess(db, {
        userId,
        action: 'VIEW_DASHBOARD',
        resourceType: 'dashboard',
        ipAddress: '192.168.1.100',
      });

      await logAccess(db, {
        userId,
        action: 'PRINT',
        resourceType: 'patient',
        resourceId: seeded.patientIds[0],
        metadata: { format: 'PDF', includeVitals: true },
      });

      // Verify all 3 entries recorded
      const logs = await db.query<{
        user_id: string;
        action: string;
        resource_type: string;
        resource_id: string | null;
        ip_address: string | null;
        user_agent: string | null;
        metadata: Record<string, unknown> | null;
        created_at: string;
      }>(
        'SELECT user_id, action, resource_type, resource_id, ip_address, user_agent, metadata, created_at FROM audit_logs WHERE user_id = ? ORDER BY created_at ASC',
        [userId],
      );

      expect(logs).toHaveLength(3);

      // Verify VIEW_PATIENT entry
      expect(logs[0].action).toBe('VIEW_PATIENT');
      expect(logs[0].resource_type).toBe('patient');
      expect(logs[0].resource_id).toBe(seeded.patientIds[0]);
      expect(logs[0].ip_address).toBe('192.168.1.100');
      expect(logs[0].user_agent).toBe('Mozilla/5.0 Test');

      // Verify VIEW_DASHBOARD entry
      expect(logs[1].action).toBe('VIEW_DASHBOARD');
      expect(logs[1].resource_type).toBe('dashboard');
      expect(logs[1].resource_id).toBeNull();

      // Verify PRINT entry with metadata
      expect(logs[2].action).toBe('PRINT');
      expect(logs[2].metadata).toBeTruthy();
      const meta = logs[2].metadata!;
      expect(meta.format).toBe('PDF');
      expect(meta.includeVitals).toBe(true);
    });

    it('rejects audit log entries with missing required fields', async () => {
      await expect(
        logAccess(db, { userId: '', action: 'VIEW', resourceType: 'patient' }),
      ).rejects.toThrow('Missing required audit log fields');

      await expect(
        logAccess(db, { userId: seeded.userId, action: '', resourceType: 'patient' }),
      ).rejects.toThrow('Missing required audit log fields');
    });

    it('audit logs are append-only — new entries never update existing rows', async () => {
      const userId = seeded.userId;

      await logAccess(db, {
        userId,
        action: 'VIEW_PATIENT',
        resourceType: 'patient',
        resourceId: seeded.patientIds[0],
      });

      const before = await db.query<{ id: string; created_at: string }>(
        'SELECT id, created_at FROM audit_logs WHERE user_id = ?',
        [userId],
      );
      expect(before).toHaveLength(1);
      const originalId = before[0].id;

      // Log another entry — should create a new record, not modify the existing one
      await logAccess(db, {
        userId,
        action: 'VIEW_PATIENT',
        resourceType: 'patient',
        resourceId: seeded.patientIds[1],
      });

      const after = await db.query<{ id: string; created_at: string }>(
        'SELECT id, created_at FROM audit_logs WHERE user_id = ? ORDER BY created_at ASC',
        [userId],
      );
      expect(after).toHaveLength(2);
      expect(after[0].id).toBe(originalId); // Original entry untouched
      expect(after[1].id).not.toBe(originalId); // New entry has new ID
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 7: Offline handling
  // -----------------------------------------------------------------------
  describe('Scenario 7: Offline handling', () => {
    it('dashboard shows cached data when hospital goes offline', async () => {
      const syncTime = '2026-03-08T12:00:00.000Z';

      // Mark hospital 10670 as ONLINE with last_sync_at
      await db.execute(
        "UPDATE hospitals SET connection_status = 'ONLINE', last_sync_at = ? WHERE hcode = '10670'",
        [syncTime],
      );

      // Now change to OFFLINE
      await db.execute("UPDATE hospitals SET connection_status = 'OFFLINE' WHERE hcode = '10670'");

      const result = await getProvinceDashboard(db);
      const h10670 = result.hospitals.find((h) => h.hcode === '10670');

      expect(h10670).toBeDefined();
      expect(h10670!.connectionStatus).toBe('OFFLINE');
      // last_sync_at should be preserved
      expect(h10670!.lastSyncAt).toBe(syncTime);
      // Patient data should still be returned (cached)
      expect(h10670!.counts.total).toBe(1); // P1 active
      expect(h10670!.counts.high).toBe(1);
    });

    it('multiple hospitals can have different connection statuses simultaneously', async () => {
      await db.execute(
        "UPDATE hospitals SET connection_status = 'ONLINE', last_sync_at = ? WHERE hcode = '10670'",
        [new Date().toISOString()],
      );
      await db.execute("UPDATE hospitals SET connection_status = 'OFFLINE' WHERE hcode = '11000'");

      const result = await getProvinceDashboard(db);
      const h10670 = result.hospitals.find((h) => h.hcode === '10670');
      const h11000 = result.hospitals.find((h) => h.hcode === '11000');

      expect(h10670!.connectionStatus).toBe('ONLINE');
      expect(h11000!.connectionStatus).toBe('OFFLINE');
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 8: Health check reflects system state
  // -----------------------------------------------------------------------
  describe('Scenario 8: Health check reflects system state', () => {
    it('health endpoint shows correct connection summary', async () => {
      // Mark 2 hospitals ONLINE, 1 OFFLINE
      await db.execute(
        "UPDATE hospitals SET connection_status = 'ONLINE' WHERE hcode IN ('10670','11000')",
      );
      await db.execute("UPDATE hospitals SET connection_status = 'OFFLINE' WHERE hcode = '11002'");
      // Rest remain UNKNOWN

      const health = await getHealthStatus(db);

      expect(health.database).toBe('connected');
      expect(health.hospitalConnections.total).toBe(26);
      expect(health.hospitalConnections.online).toBe(2);
      expect(health.hospitalConnections.offline).toBe(1);
      expect(health.hospitalConnections.unknown).toBe(23);
    });

    it('status is degraded when any hospital is offline', async () => {
      await db.execute("UPDATE hospitals SET connection_status = 'ONLINE' WHERE hcode = '10670'");
      await db.execute("UPDATE hospitals SET connection_status = 'OFFLINE' WHERE hcode = '11000'");

      const health = await getHealthStatus(db);
      expect(health.status).toBe('degraded');
    });

    it('status is healthy when no hospital is offline', async () => {
      // Note: UNKNOWN does NOT cause degraded -- only OFFLINE does
      await db.execute(
        "UPDATE hospitals SET connection_status = 'ONLINE' WHERE hcode IN ('10670','11000')",
      );
      // Rest are UNKNOWN

      const health = await getHealthStatus(db);
      expect(health.status).toBe('healthy');
    });

    it('health check includes uptime and timestamp', async () => {
      const health = await getHealthStatus(db);
      expect(health.uptime).toBeGreaterThanOrEqual(0);
      expect(health.timestamp).toBeTruthy();
      // Timestamp should be a valid ISO string
      expect(() => new Date(health.timestamp)).not.toThrow();
    });
  });
});
