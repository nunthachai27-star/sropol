import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { upsertNewborn, getNewbornKPIs, getOutcomes } from '@/services/newborn';

describe('Newborn Service', () => {
  let db: DatabaseAdapter;
  const hospitalId = 'hosp-001';
  const journeyId1 = 'journey-001';
  const journeyId2 = 'journey-002';

  beforeEach(async () => {
    db = await createTestDb();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES ('${hospitalId}', '10670', 'รพ.ขอนแก่น', 'A_S', TRUE, 'ONLINE', NOW(), NOW())`,
    );
    await db.execute(
      `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
       VALUES ('${journeyId1}', '${hospitalId}', '${hospitalId}', '12345', 'Test1', 'enc_cid', 'cidhash_test', 28, 1, 0, 'DELIVERED', 'LOW', 5, NOW(), NOW(), NOW(), NOW(), NOW())`,
    );
    await db.execute(
      `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
       VALUES ('${journeyId2}', '${hospitalId}', '${hospitalId}', '12346', 'Test2', 'enc_cid', 'cidhash_test', 30, 2, 1, 'DELIVERED', 'LOW', 4, NOW(), NOW(), NOW(), NOW(), NOW())`,
    );
  });

  afterEach(() => {
    db.close();
  });

  describe('upsertNewborn', () => {
    it('creates newborn record linked to journey', async () => {
      const nb = await upsertNewborn(db, {
        journeyId: journeyId1,
        infantNumber: 1,
        sex: 'M',
        birthWeightG: 3200,
        bodyLengthCm: 50,
        headCircumCm: 34,
        apgar1min: 8,
        apgar5min: 9,
        apgar10min: 10,
        resuscitation: { ppv: false, et_tube: false, chest_pump: false },
        vaccinations: { bcg: true, hepb: true, vitk: true },
        bornAt: '2026-03-08T10:30:00Z',
      });
      expect(nb.id).toBeTruthy();
      expect(nb.birthWeightG).toBe(3200);
      expect(nb.apgar1min).toBe(8);
      expect(nb.sex).toBe('M');
      expect(nb.vaccinations.bcg).toBe(true);
    });

    it('updates existing record on second upsert', async () => {
      await upsertNewborn(db, {
        journeyId: journeyId1,
        infantNumber: 1,
        sex: 'M',
        birthWeightG: 3200,
        apgar1min: 8,
        apgar5min: 9,
        resuscitation: {},
        vaccinations: {},
        bornAt: '2026-03-08T10:30:00Z',
      });
      const updated = await upsertNewborn(db, {
        journeyId: journeyId1,
        infantNumber: 1,
        sex: 'M',
        birthWeightG: 3250,
        apgar1min: 9,
        apgar5min: 10,
        resuscitation: {},
        vaccinations: {},
        bornAt: '2026-03-08T10:30:00Z',
      });
      expect(updated.birthWeightG).toBe(3250);
      expect(updated.apgar1min).toBe(9);

      // Verify only one record exists
      const rows = await db.query<Record<string, unknown>>(
        `SELECT COUNT(*) as cnt FROM cached_newborns WHERE journey_id = ?`,
        [journeyId1],
      );
      expect(Number(rows[0].cnt)).toBe(1);
    });
  });

  describe('getNewbornKPIs', () => {
    it('calculates LBW rate and Apgar stats', async () => {
      await upsertNewborn(db, {
        journeyId: journeyId1,
        infantNumber: 1,
        sex: 'F',
        birthWeightG: 2400,
        apgar1min: 6,
        // 5-min Apgar drives the low-Apgar KPI; keep this baby genuinely low at 5 min.
        apgar5min: 6,
        resuscitation: {},
        vaccinations: {},
        bornAt: '2026-03-08T10:30:00Z',
      });
      await upsertNewborn(db, {
        journeyId: journeyId2,
        infantNumber: 1,
        sex: 'M',
        birthWeightG: 3500,
        apgar1min: 9,
        apgar5min: 10,
        resuscitation: {},
        vaccinations: {},
        bornAt: '2026-03-09T14:00:00Z',
      });

      const kpis = await getNewbornKPIs(db);
      expect(kpis.totalBirths).toBe(2);
      expect(kpis.lbwCount).toBe(1);
      // lbwRate is a percentage (0–100), matching the UI's "% ของทารกทั้งหมด".
      expect(kpis.lbwRate).toBe(50);
      expect(kpis.lowApgarCount).toBe(1);
      expect(kpis.avgBirthWeightG).toBe(2950);
    });

    it('counts low Apgar from the 5-minute score, not the 1-minute score', async () => {
      // The 5-minute Apgar is the standard neonatal predictor. Both babies
      // below have a NORMAL 1-min score (>=7), so the old apgar_1min<7 rule
      // would count zero. Only the first stays depressed at 5 min, so the
      // corrected apgar_5min<7 rule must count exactly one.
      await upsertNewborn(db, {
        journeyId: journeyId1,
        infantNumber: 1,
        sex: 'M',
        birthWeightG: 3200,
        apgar1min: 9,
        apgar5min: 5,
        resuscitation: {},
        vaccinations: {},
        bornAt: '2026-03-08T10:30:00Z',
      });
      await upsertNewborn(db, {
        journeyId: journeyId2,
        infantNumber: 1,
        sex: 'F',
        birthWeightG: 3000,
        apgar1min: 8,
        apgar5min: 9,
        resuscitation: {},
        vaccinations: {},
        bornAt: '2026-03-09T10:30:00Z',
      });

      const kpis = await getNewbornKPIs(db);
      expect(kpis.totalBirths).toBe(2);
      expect(kpis.lowApgarCount).toBe(1);
    });

    it('returns zeros when no newborns', async () => {
      const kpis = await getNewbornKPIs(db);
      expect(kpis.totalBirths).toBe(0);
      expect(kpis.lbwCount).toBe(0);
      expect(kpis.lbwRate).toBe(0);
      expect(kpis.avgBirthWeightG).toBe(0);
    });

    it('filters by hospital when hospitalId provided', async () => {
      const otherHospId = 'hosp-other';
      await db.execute(
        `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
         VALUES ('${otherHospId}', '11004', 'รพ.พล', 'F2', TRUE, 'ONLINE', NOW(), NOW())`,
      );
      const otherJourneyId = 'journey-other';
      await db.execute(
        `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
         VALUES ('${otherJourneyId}', '${otherHospId}', '${otherHospId}', '99999', 'Other', 'enc_cid', 'cidhash_test', 25, 1, 0, 'DELIVERED', 'LOW', 3, NOW(), NOW(), NOW(), NOW(), NOW())`,
      );

      await upsertNewborn(db, {
        journeyId: journeyId1,
        infantNumber: 1,
        birthWeightG: 3000,
        apgar1min: 8,
        apgar5min: 9,
        resuscitation: {},
        vaccinations: {},
        bornAt: '2026-03-08T10:00:00Z',
      });
      await upsertNewborn(db, {
        journeyId: otherJourneyId,
        infantNumber: 1,
        birthWeightG: 2800,
        apgar1min: 7,
        apgar5min: 9,
        resuscitation: {},
        vaccinations: {},
        bornAt: '2026-03-09T10:00:00Z',
      });

      const kpisHosp1 = await getNewbornKPIs(db, { hospitalId });
      expect(kpisHosp1.totalBirths).toBe(1);
      expect(kpisHosp1.avgBirthWeightG).toBe(3000);

      const kpisAll = await getNewbornKPIs(db);
      expect(kpisAll.totalBirths).toBe(2);
    });

    it('applies the range window: Bangkok month-to-date and last 30 days', async () => {
      const NOW = new Date('2026-07-15T18:00:00+07:00');
      const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3600_000).toISOString();

      const base = {
        resuscitation: {},
        vaccinations: {},
        apgar1min: 9,
        apgar5min: 9,
        birthWeightG: 3000,
      };
      // Jul 13 — inside month-to-date.
      await upsertNewborn(db, {
        ...base,
        journeyId: journeyId1,
        infantNumber: 1,
        bornAt: daysAgo(2),
      });
      // Jun 25 — outside MTD, inside 30 days.
      await upsertNewborn(db, {
        ...base,
        journeyId: journeyId2,
        infantNumber: 1,
        bornAt: daysAgo(20),
      });
      // Apr — outside both.
      await upsertNewborn(db, {
        ...base,
        journeyId: journeyId2,
        infantNumber: 2,
        bornAt: daysAgo(100),
      });

      expect((await getNewbornKPIs(db, { range: 'mtd' }, NOW)).totalBirths).toBe(1);
      expect((await getNewbornKPIs(db, { range: '30d' }, NOW)).totalBirths).toBe(2);
      expect((await getNewbornKPIs(db, { range: 'all' }, NOW)).totalBirths).toBe(3);
      // Default keeps the historical all-time semantics.
      expect((await getNewbornKPIs(db, {}, NOW)).totalBirths).toBe(3);
    });
  });

  describe('getOutcomes', () => {
    it('adds multiples + resuscitated counts, 6-month trend, hospital breakdown, recent births', async () => {
      const NOW = new Date('2026-07-15T18:00:00+07:00');
      const base = { resuscitation: {}, vaccinations: {}, apgar1min: 9, apgar5min: 9 };

      // Twin birth this month, second twin resuscitated + LBW.
      await upsertNewborn(db, {
        ...base,
        journeyId: journeyId1,
        infantNumber: 1,
        sex: 'M',
        birthWeightG: 3100,
        bornAt: '2026-07-10T08:00:00Z',
      });
      await upsertNewborn(db, {
        ...base,
        journeyId: journeyId1,
        infantNumber: 2,
        sex: 'F',
        birthWeightG: 2300,
        apgar5min: 6,
        resuscitation: { ppv: true },
        bornAt: '2026-07-10T08:05:00Z',
      });
      // Singleton two months earlier.
      await upsertNewborn(db, {
        ...base,
        journeyId: journeyId2,
        infantNumber: 1,
        sex: 'M',
        birthWeightG: 3400,
        bornAt: '2026-05-20T10:00:00Z',
      });

      const outcomes = await getOutcomes(db, { range: 'all' }, NOW);

      expect(outcomes.totalBirths).toBe(3);
      expect(outcomes.multiples).toBe(1); // one infant_number > 1
      expect(outcomes.resuscitated).toBe(1);

      // Six Bangkok months, oldest first; May has 1 birth, July has 2.
      expect(outcomes.trend).toHaveLength(6);
      expect(outcomes.trend[5]).toEqual({ month: '2026-07', births: 2, lbw: 1 });
      expect(outcomes.trend[3]).toEqual({ month: '2026-05', births: 1, lbw: 0 });

      expect(outcomes.byHospital).toEqual([
        { id: hospitalId, hcode: '10670', name: 'รพ.ขอนแก่น', births: 3, lbw: 1, lowApgar: 1 },
      ]);

      // Recent births, newest first, mother name decrypted at the boundary.
      expect(outcomes.recent).toHaveLength(3);
      expect(outcomes.recent[0]).toMatchObject({
        journeyId: journeyId1,
        infantNumber: 2,
        motherName: 'Test1',
        hospitalName: 'รพ.ขอนแก่น',
        birthWeightG: 2300,
        apgar5min: 6,
        resuscitated: true,
      });
    });
  });
});
