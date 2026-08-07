// Journey API route logic tests — tests the SQL queries and data mapping used by journey routes
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { createJourney } from '@/services/journey';
import { getJourneyById } from '@/services/journey';
import { AncRiskLevel } from '@/types/domain';
import { v4 as uuidv4 } from 'uuid';
import type {
  JourneyListItem,
  AncVisitEntry,
  AncRiskEntry,
  ReferralListItem,
  NewbornEntry,
} from '@/types/api';

describe('Journey API Logic', () => {
  let db: DatabaseAdapter;
  const hospitalId = 'hosp-api-001';
  const hospital2Id = 'hosp-api-002';

  beforeEach(async () => {
    db = await createTestDb();
    // Insert two test hospitals
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, '10670', 'รพ.ขอนแก่น', 'A_S', TRUE, 'ONLINE', ?, ?)`,
      [hospitalId, now, now],
    );
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, '11000', 'รพ.น้ำพอง', 'F2', TRUE, 'ONLINE', ?, ?)`,
      [hospital2Id, now, now],
    );
  });

  afterEach(async () => {
    await db.close();
  });

  describe('Journey list query', () => {
    it('returns empty array when no journeys exist', async () => {
      const countRows = await db.query<{ total: number }>(
        `SELECT COUNT(*) as total FROM maternal_journeys mj JOIN hospitals h ON h.id = mj.hospital_id WHERE 1=1`,
      );
      const total = Number(countRows[0]?.total) || 0;
      expect(total).toBe(0);

      const rows = await db.query<Record<string, unknown>>(
        `SELECT mj.*, h.name as hospital_name, h.hcode FROM maternal_journeys mj JOIN hospitals h ON h.id = mj.hospital_id WHERE 1=1 ORDER BY mj.created_at DESC LIMIT ? OFFSET ?`,
        [20, 0],
      );
      expect(rows).toHaveLength(0);
    });

    it('returns journeys with correct field mapping', async () => {
      const journey = await createJourney(db, {
        hospitalId,
        hn: 'HN-001',
        personAncId: 100,
        name: 'นางสมศรี ใจดี',
        cid: 'enc_test_201',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000101',
        age: 28,
        gravida: 2,
        para: 1,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });

      const rows = await db.query<Record<string, unknown>>(
        `SELECT mj.*, h.name as hospital_name, h.hcode FROM maternal_journeys mj JOIN hospitals h ON h.id = mj.hospital_id WHERE 1=1 ORDER BY mj.created_at DESC LIMIT ? OFFSET ?`,
        [20, 0],
      );
      expect(rows).toHaveLength(1);

      const r = rows[0];
      const mapped: JourneyListItem = {
        id: r.id as string,
        hn: r.hn as string,
        name: r.name as string,
        age: r.age as number,
        gravida: r.gravida as number,
        para: r.para as number,
        gaWeeks: r.ga_weeks as number | null,
        lmp: r.lmp as string | null,
        edc: r.edc as string | null,
        careStage: r.care_stage as string,
        ancRiskLevel: r.anc_risk_level as string,
        ancVisitCount: r.anc_visit_count as number,
        lastAncDate: r.last_anc_date as string | null,
        hospitalName: r.hospital_name as string,
        hcode: r.hcode as string,
        registeredAt: r.registered_at as string,
      };

      expect(mapped.id).toBe(journey.id);
      expect(mapped.hn).toBe('HN-001');
      expect(mapped.name).toBe('นางสมศรี ใจดี');
      expect(mapped.age).toBe(28);
      expect(mapped.gravida).toBe(2);
      expect(mapped.para).toBe(1);
      expect(mapped.careStage).toBe('PREGNANCY');
      expect(mapped.ancRiskLevel).toBe('LOW');
      expect(mapped.hospitalName).toBe('รพ.ขอนแก่น');
      expect(mapped.hcode).toBe('10670');
    });

    it('filters by stage', async () => {
      await createJourney(db, {
        hospitalId,
        hn: 'HN-P1',
        personAncId: 1,
        name: 'P1',
        cid: 'enc_test_007',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000007',
        age: 25,
        gravida: 1,
        para: 0,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });
      const j2 = await createJourney(db, {
        hospitalId,
        hn: 'HN-P2',
        personAncId: 2,
        name: 'P2',
        cid: 'enc_test_008',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000008',
        age: 30,
        gravida: 2,
        para: 1,
        lmp: '2025-07-01',
        edc: '2026-04-07',
        ancRiskLevel: AncRiskLevel.HR1,
      });
      // Transition j2 to LABOR
      await db.execute(`UPDATE maternal_journeys SET care_stage = 'LABOR' WHERE id = ?`, [j2.id]);

      const rows = await db.query<Record<string, unknown>>(
        `SELECT mj.*, h.name as hospital_name, h.hcode FROM maternal_journeys mj JOIN hospitals h ON h.id = mj.hospital_id WHERE 1=1 AND mj.care_stage = ? ORDER BY mj.created_at DESC LIMIT ? OFFSET ?`,
        ['PREGNANCY', 20, 0],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].hn).toBe('HN-P1');
    });

    it('filters by risk level', async () => {
      await createJourney(db, {
        hospitalId,
        hn: 'HN-LOW',
        personAncId: 1,
        name: 'Low',
        cid: 'enc_test_009',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000009',
        age: 25,
        gravida: 1,
        para: 0,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });
      await createJourney(db, {
        hospitalId,
        hn: 'HN-HR3',
        personAncId: 2,
        name: 'HR3',
        cid: 'enc_test_010',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000010',
        age: 35,
        gravida: 4,
        para: 3,
        lmp: '2025-07-01',
        edc: '2026-04-07',
        ancRiskLevel: AncRiskLevel.HR3,
      });

      const rows = await db.query<Record<string, unknown>>(
        `SELECT mj.*, h.name as hospital_name, h.hcode FROM maternal_journeys mj JOIN hospitals h ON h.id = mj.hospital_id WHERE 1=1 AND mj.anc_risk_level = ? ORDER BY mj.created_at DESC LIMIT ? OFFSET ?`,
        ['HR3', 20, 0],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].hn).toBe('HN-HR3');
    });

    it('paginates results correctly', async () => {
      // Create 3 journeys
      for (let i = 1; i <= 3; i++) {
        await createJourney(db, {
          hospitalId,
          hn: `HN-PG${i}`,
          personAncId: i,
          name: `Patient ${i}`,
          cid: 'enc_test_011',
          cidHash: 'testhash00000000000000000000000000000000000000000000000000000011',
          age: 25 + i,
          gravida: i,
          para: 0,
          lmp: '2025-06-01',
          edc: '2026-03-08',
          ancRiskLevel: AncRiskLevel.LOW,
        });
      }

      const countRows = await db.query<{ total: number }>(
        `SELECT COUNT(*) as total FROM maternal_journeys mj JOIN hospitals h ON h.id = mj.hospital_id WHERE 1=1`,
      );
      expect(Number(countRows[0]?.total)).toBe(3);

      // Page 1, perPage 2
      const page1 = await db.query<Record<string, unknown>>(
        `SELECT mj.*, h.name as hospital_name, h.hcode FROM maternal_journeys mj JOIN hospitals h ON h.id = mj.hospital_id WHERE 1=1 ORDER BY mj.created_at DESC LIMIT ? OFFSET ?`,
        [2, 0],
      );
      expect(page1).toHaveLength(2);

      // Page 2, perPage 2
      const page2 = await db.query<Record<string, unknown>>(
        `SELECT mj.*, h.name as hospital_name, h.hcode FROM maternal_journeys mj JOIN hospitals h ON h.id = mj.hospital_id WHERE 1=1 ORDER BY mj.created_at DESC LIMIT ? OFFSET ?`,
        [2, 2],
      );
      expect(page2).toHaveLength(1);
    });
  });

  describe('Journey detail query', () => {
    it('returns 404-equivalent when journey does not exist', async () => {
      const journeyRows = await db.query<Record<string, unknown>>(
        `SELECT mj.*, h.name as hospital_name, h.hcode,
                ch.name as current_hospital_name, ch.hcode as current_hcode
         FROM maternal_journeys mj
         JOIN hospitals h ON h.id = mj.hospital_id
         JOIN hospitals ch ON ch.id = mj.current_hospital_id
         WHERE mj.id = ?`,
        ['non-existent-id'],
      );
      expect(journeyRows).toHaveLength(0);
    });

    it('returns journey with hospital info', async () => {
      const journey = await createJourney(db, {
        hospitalId,
        hn: 'HN-DTL',
        personAncId: 200,
        name: 'Detail Patient',
        cid: 'enc_test_202',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000102',
        age: 30,
        gravida: 2,
        para: 1,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.HR1,
      });

      const journeyRows = await db.query<Record<string, unknown>>(
        `SELECT mj.*, h.name as hospital_name, h.hcode,
                ch.name as current_hospital_name, ch.hcode as current_hcode
         FROM maternal_journeys mj
         JOIN hospitals h ON h.id = mj.hospital_id
         JOIN hospitals ch ON ch.id = mj.current_hospital_id
         WHERE mj.id = ?`,
        [journey.id],
      );

      expect(journeyRows).toHaveLength(1);
      const r = journeyRows[0];
      expect(r.hospital_name).toBe('รพ.ขอนแก่น');
      expect(r.hcode).toBe('10670');
      expect(r.current_hospital_name).toBe('รพ.ขอนแก่น');
      expect(r.current_hcode).toBe('10670');
    });

    it('returns ANC visits for a journey', async () => {
      const journey = await createJourney(db, {
        hospitalId,
        hn: 'HN-ANC',
        personAncId: 300,
        name: 'ANC Patient',
        cid: 'enc_test_012',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000012',
        age: 26,
        gravida: 1,
        para: 0,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });

      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO cached_anc_visits (id, journey_id, visit_date, visit_number, ga_weeks, fundal_height_cm, weight_kg, bp_systolic, bp_diastolic, fetal_hr, synced_at, created_at)
         VALUES (?, ?, ?, 1, 12, 10.5, 55.0, 120, 80, 140, ?, ?)`,
        [uuidv4(), journey.id, '2025-09-01', now, now],
      );
      await db.execute(
        `INSERT INTO cached_anc_visits (id, journey_id, visit_date, visit_number, ga_weeks, fundal_height_cm, weight_kg, bp_systolic, bp_diastolic, fetal_hr, synced_at, created_at)
         VALUES (?, ?, ?, 2, 16, 14.0, 57.0, 118, 78, 142, ?, ?)`,
        [uuidv4(), journey.id, '2025-10-01', now, now],
      );

      const visitRows = await db.query<Record<string, unknown>>(
        `SELECT * FROM cached_anc_visits WHERE journey_id = ? ORDER BY visit_date`,
        [journey.id],
      );
      expect(visitRows).toHaveLength(2);

      const visits: AncVisitEntry[] = visitRows.map((v) => ({
        visitDate: v.visit_date as string,
        visitNumber: v.visit_number as number,
        hospitalName: null,
        hcode: null,
        gaWeeks: v.ga_weeks as number | null,
        fundalHeightCm: v.fundal_height_cm as number | null,
        weightKg: v.weight_kg as number | null,
        bpSystolic: v.bp_systolic as number | null,
        bpDiastolic: v.bp_diastolic as number | null,
        fetalHr: v.fetal_hr as number | null,
        presentation: (v.presentation as string | null) ?? null,
        engagement: (v.engagement as string | null) ?? null,
        passQuality: v.pass_quality == null ? null : !!v.pass_quality,
        urineProtein: (v.urine_protein as string | null) ?? null,
        urineGlucose: (v.urine_glucose as string | null) ?? null,
        hbGDl: v.hb_g_dl == null ? null : Number(v.hb_g_dl),
        hctPct: v.hct_pct == null ? null : Number(v.hct_pct),
        ttDoseNo: v.tt_dose_no as number | null,
        ironFolicGiven: v.iron_folic_given == null ? null : !!v.iron_folic_given,
        calciumGiven: v.calcium_given == null ? null : !!v.calcium_given,
        dangerSigns: null,
        fetalMovementOk: v.fetal_movement_ok == null ? null : !!v.fetal_movement_ok,
        // RTCOG OB 66-029 (2566) additions — not populated by this fixture,
        // default to null so the shape matches AncVisitEntry.
        vaccinesGiven: null,
        urineKetone: null,
        urineCultureResult: null,
        iodineGiven: null,
        multivitaminGiven: null,
        vitaminDIu: null,
        nstResult: null,
        bppScore: null,
        umbilicalDopplerResult: null,
        psychosocialScreen: null,
      }));

      expect(visits[0].visitNumber).toBe(1);
      expect(visits[0].gaWeeks).toBe(12);
      expect(visits[0].bpSystolic).toBe(120);
      expect(visits[1].visitNumber).toBe(2);
      expect(visits[1].gaWeeks).toBe(16);
    });

    it('returns latest risk for a journey', async () => {
      const journey = await createJourney(db, {
        hospitalId,
        hn: 'HN-RSK',
        personAncId: 400,
        name: 'Risk Patient',
        cid: 'enc_test_013',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000013',
        age: 35,
        gravida: 3,
        para: 2,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.HR2,
      });

      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO cached_anc_risks (id, journey_id, risk_level, triggered_rules, risk_factors, recommended_facility, screened_at, created_at)
         VALUES (?, ?, 'HR2', '["age_over_35","multigravida"]', '{}', 'รพ.ขอนแก่น', ?, ?)`,
        [uuidv4(), journey.id, now, now],
      );

      const riskRows = await db.query<Record<string, unknown>>(
        `SELECT * FROM cached_anc_risks WHERE journey_id = ? ORDER BY screened_at DESC LIMIT 1`,
        [journey.id],
      );
      expect(riskRows).toHaveLength(1);

      const latestRisk: AncRiskEntry = {
        riskLevel: riskRows[0].risk_level as string,
        triggeredRules: (riskRows[0].triggered_rules as string[] | null) ?? [],
        screenedAt: riskRows[0].screened_at as string,
        recommendedFacility: riskRows[0].recommended_facility as string | null,
      };

      expect(latestRisk.riskLevel).toBe('HR2');
      expect(latestRisk.triggeredRules).toEqual(['age_over_35', 'multigravida']);
      expect(latestRisk.recommendedFacility).toBe('รพ.ขอนแก่น');
    });

    it('returns referrals with hospital names', async () => {
      const journey = await createJourney(db, {
        hospitalId,
        hn: 'HN-REF',
        personAncId: 500,
        name: 'Referral Patient',
        cid: 'enc_test_014',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000014',
        age: 28,
        gravida: 1,
        para: 0,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.HR3,
      });

      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO cached_referrals (id, journey_id, from_hospital_id, to_hospital_id, status, reason, urgency_level, initiated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'INITIATED', 'ครรภ์เสี่ยงสูง', 'URGENT', ?, ?, ?)`,
        [uuidv4(), journey.id, hospitalId, hospital2Id, now, now, now],
      );

      const refRows = await db.query<Record<string, unknown>>(
        `SELECT cr.*, fh.name as from_name, th.name as to_name
         FROM cached_referrals cr
         JOIN hospitals fh ON fh.id = cr.from_hospital_id
         JOIN hospitals th ON th.id = cr.to_hospital_id
         WHERE cr.journey_id = ?
         ORDER BY cr.initiated_at DESC`,
        [journey.id],
      );
      expect(refRows).toHaveLength(1);

      const referral: ReferralListItem = {
        id: refRows[0].id as string,
        journeyId: refRows[0].journey_id as string,
        referNumber: (refRows[0].refer_number as string | null) ?? null,
        fromHospital: refRows[0].from_name as string,
        toHospital: refRows[0].to_name as string,
        status: refRows[0].status as string,
        reason: refRows[0].reason as string,
        diagnosisCode: (refRows[0].diagnosis_code as string | null) ?? null,
        urgencyLevel: refRows[0].urgency_level as string,
        initiatedAt: refRows[0].initiated_at as string,
        arrivedAt: refRows[0].arrived_at as string | null,
      };

      expect(referral.fromHospital).toBe('รพ.ขอนแก่น');
      expect(referral.toHospital).toBe('รพ.น้ำพอง');
      expect(referral.status).toBe('INITIATED');
      expect(referral.urgencyLevel).toBe('URGENT');
    });

    it('returns newborns for a journey', async () => {
      const journey = await createJourney(db, {
        hospitalId,
        hn: 'HN-NB',
        personAncId: 600,
        name: 'Newborn Patient',
        cid: 'enc_test_015',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000015',
        age: 30,
        gravida: 2,
        para: 1,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });

      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO cached_newborns (id, journey_id, infant_number, sex, birth_weight_g, apgar_1min, apgar_5min, born_at, synced_at, created_at)
         VALUES (?, ?, 1, 'M', 3200, 8, 9, ?, ?, ?)`,
        [uuidv4(), journey.id, now, now, now],
      );

      const nbRows = await db.query<Record<string, unknown>>(
        `SELECT * FROM cached_newborns WHERE journey_id = ? ORDER BY infant_number`,
        [journey.id],
      );
      expect(nbRows).toHaveLength(1);

      const newborn: NewbornEntry = {
        infantNumber: nbRows[0].infant_number as number,
        sex: nbRows[0].sex as string | null,
        birthWeightG: nbRows[0].birth_weight_g as number | null,
        apgar1min: nbRows[0].apgar_1min as number | null,
        apgar5min: nbRows[0].apgar_5min as number | null,
        bornAt: nbRows[0].born_at as string,
      };

      expect(newborn.infantNumber).toBe(1);
      expect(newborn.sex).toBe('M');
      expect(newborn.birthWeightG).toBe(3200);
      expect(newborn.apgar1min).toBe(8);
      expect(newborn.apgar5min).toBe(9);
    });
  });

  describe('getJourneyById', () => {
    it('returns null for non-existent journey', async () => {
      const result = await getJourneyById(db, 'non-existent-id');
      expect(result).toBeNull();
    });

    it('returns journey by id', async () => {
      const created = await createJourney(db, {
        hospitalId,
        hn: 'HN-BY-ID',
        personAncId: 700,
        name: 'ById Patient',
        cid: 'enc_test_016',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000016',
        age: 27,
        gravida: 1,
        para: 0,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.HR1,
      });

      const found = await getJourneyById(db, created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.hn).toBe('HN-BY-ID');
      expect(found!.ancRiskLevel).toBe('HR1');
    });
  });

  describe('Hospital journeys query', () => {
    it('returns journeys filtered by hospital hcode', async () => {
      await createJourney(db, {
        hospitalId,
        hn: 'HN-H1',
        personAncId: 800,
        name: 'Hosp1 Patient',
        cid: 'enc_test_017',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000017',
        age: 25,
        gravida: 1,
        para: 0,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });
      await createJourney(db, {
        hospitalId: hospital2Id,
        hn: 'HN-H2',
        personAncId: 801,
        name: 'Hosp2 Patient',
        cid: 'enc_test_018',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000018',
        age: 28,
        gravida: 2,
        para: 1,
        lmp: '2025-07-01',
        edc: '2026-04-07',
        ancRiskLevel: AncRiskLevel.HR2,
      });

      // Look up hospital by hcode
      const hospitals = await db.query<{ id: string }>(`SELECT id FROM hospitals WHERE hcode = ?`, [
        '10670',
      ]);
      expect(hospitals).toHaveLength(1);

      const rows = await db.query<Record<string, unknown>>(
        `SELECT mj.*, h.name as hospital_name, h.hcode FROM maternal_journeys mj JOIN hospitals h ON h.id = mj.hospital_id WHERE mj.current_hospital_id = ? ORDER BY mj.created_at DESC LIMIT ? OFFSET ?`,
        [hospitals[0].id, 20, 0],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].hn).toBe('HN-H1');
    });

    it('returns empty for non-existent hospital hcode', async () => {
      const hospitals = await db.query<{ id: string }>(`SELECT id FROM hospitals WHERE hcode = ?`, [
        '99999',
      ]);
      expect(hospitals).toHaveLength(0);
    });
  });
});
