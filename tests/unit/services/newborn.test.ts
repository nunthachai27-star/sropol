import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables';
import { upsertNewborn, getNewbornKPIs } from '@/services/newborn';

describe('Newborn Service', () => {
  let db: SqliteAdapter;
  const hospitalId = 'hosp-001';
  const journeyId1 = 'journey-001';
  const journeyId2 = 'journey-002';

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await SchemaSync.sync(db, ALL_TABLES, 'sqlite');
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES ('${hospitalId}', '10670', 'รพ.ขอนแก่น', 'A_S', 1, 'ONLINE', datetime('now'), datetime('now'))`,
    );
    await db.execute(
      `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
       VALUES ('${journeyId1}', '${hospitalId}', '${hospitalId}', '12345', 'Test1', 'enc_cid', 'cidhash_test', 28, 1, 0, 'DELIVERED', 'LOW', 5, datetime('now'), datetime('now'), datetime('now'), datetime('now'), datetime('now'))`,
    );
    await db.execute(
      `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
       VALUES ('${journeyId2}', '${hospitalId}', '${hospitalId}', '12346', 'Test2', 'enc_cid', 'cidhash_test', 30, 2, 1, 'DELIVERED', 'LOW', 4, datetime('now'), datetime('now'), datetime('now'), datetime('now'), datetime('now'))`,
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
        journeyId: journeyId1, infantNumber: 1, sex: 'M',
        birthWeightG: 3200, apgar1min: 8, apgar5min: 9,
        resuscitation: {}, vaccinations: {},
        bornAt: '2026-03-08T10:30:00Z',
      });
      const updated = await upsertNewborn(db, {
        journeyId: journeyId1, infantNumber: 1, sex: 'M',
        birthWeightG: 3250, apgar1min: 9, apgar5min: 10,
        resuscitation: {}, vaccinations: {},
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
        journeyId: journeyId1, infantNumber: 1, sex: 'F',
        birthWeightG: 2400, apgar1min: 6, apgar5min: 7,
        resuscitation: {}, vaccinations: {},
        bornAt: '2026-03-08T10:30:00Z',
      });
      await upsertNewborn(db, {
        journeyId: journeyId2, infantNumber: 1, sex: 'M',
        birthWeightG: 3500, apgar1min: 9, apgar5min: 10,
        resuscitation: {}, vaccinations: {},
        bornAt: '2026-03-09T14:00:00Z',
      });

      const kpis = await getNewbornKPIs(db);
      expect(kpis.totalBirths).toBe(2);
      expect(kpis.lbwCount).toBe(1);
      expect(kpis.lbwRate).toBe(0.5);
      expect(kpis.lowApgarCount).toBe(1);
      expect(kpis.avgBirthWeightG).toBe(2950);
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
         VALUES ('${otherHospId}', '10679', 'รพ.พล', 'M2', 1, 'ONLINE', datetime('now'), datetime('now'))`,
      );
      const otherJourneyId = 'journey-other';
      await db.execute(
        `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
         VALUES ('${otherJourneyId}', '${otherHospId}', '${otherHospId}', '99999', 'Other', 'enc_cid', 'cidhash_test', 25, 1, 0, 'DELIVERED', 'LOW', 3, datetime('now'), datetime('now'), datetime('now'), datetime('now'), datetime('now'))`,
      );

      await upsertNewborn(db, {
        journeyId: journeyId1, infantNumber: 1, birthWeightG: 3000, apgar1min: 8, apgar5min: 9,
        resuscitation: {}, vaccinations: {}, bornAt: '2026-03-08T10:00:00Z',
      });
      await upsertNewborn(db, {
        journeyId: otherJourneyId, infantNumber: 1, birthWeightG: 2800, apgar1min: 7, apgar5min: 9,
        resuscitation: {}, vaccinations: {}, bornAt: '2026-03-09T10:00:00Z',
      });

      const kpisHosp1 = await getNewbornKPIs(db, hospitalId);
      expect(kpisHosp1.totalBirths).toBe(1);
      expect(kpisHosp1.avgBirthWeightG).toBe(3000);

      const kpisAll = await getNewbornKPIs(db);
      expect(kpisAll.totalBirths).toBe(2);
    });
  });
});
