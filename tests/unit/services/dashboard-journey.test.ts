import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables';
import { getStageKPIs, getDashboardAlerts } from '@/services/dashboard';

describe('Dashboard Journey Extensions', () => {
  let db: SqliteAdapter;
  const hospitalId = 'hosp-001';

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await SchemaSync.sync(db, ALL_TABLES, 'sqlite');
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, '10670', 'รพ.ขอนแก่น', 'A_S', 1, 'ONLINE', datetime('now'), datetime('now'))`,
      [hospitalId],
    );
  });

  afterEach(() => { db.close(); });

  describe('getStageKPIs', () => {
    it('returns zero counts when no data', async () => {
      const kpis = await getStageKPIs(db);
      expect(kpis.pregnancy.total).toBe(0);
      expect(kpis.labor.total).toBe(0);
      expect(kpis.delivered.total).toBe(0);
    });

    it('counts pregnancies by ANC risk level', async () => {
      const now = new Date().toISOString();
      // 2 LOW, 1 HR1, 1 HR3
      for (const [hn, risk] of [['001', 'LOW'], ['002', 'LOW'], ['003', 'HR1'], ['004', 'HR3']]) {
        await db.execute(
          `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'Test', 'enc_cid', 'cidhash', 25, 1, 0, 'PREGNANCY', ?, 0, ?, ?, ?, ?, ?)`,
          [`j-${hn}`, hospitalId, hospitalId, hn, risk, now, now, now, now, now],
        );
      }

      const kpis = await getStageKPIs(db);
      expect(kpis.pregnancy.total).toBe(4);
      expect(kpis.pregnancy.low).toBe(2);
      expect(kpis.pregnancy.hr1).toBe(1);
      expect(kpis.pregnancy.hr3).toBe(1);
    });
  });

  describe('getDashboardAlerts', () => {
    it('returns zero alerts when no data', async () => {
      const alerts = await getDashboardAlerts(db);
      expect(alerts.referralAlerts).toBe(0);
      expect(alerts.overdueAnc).toBe(0);
      expect(alerts.inTransitReferrals).toBe(0);
    });

    it('counts pending referrals as alerts', async () => {
      const now = new Date().toISOString();
      const hospBId = 'hosp-002';
      await db.execute(
        `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
         VALUES (?, '10679', 'รพ.พล', 'M2', 1, 'ONLINE', datetime('now'), datetime('now'))`,
        [hospBId],
      );
      const journeyId = 'j-test';
      await db.execute(
        `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, '12345', 'Test', 'enc_cid', 'cidhash', 25, 1, 0, 'PREGNANCY', 'HR3', 0, ?, ?, ?, ?, ?)`,
        [journeyId, hospitalId, hospitalId, now, now, now, now, now],
      );
      // 1 INITIATED + 1 IN_TRANSIT
      await db.execute(
        `INSERT INTO cached_referrals (id, journey_id, from_hospital_id, to_hospital_id, status, reason, urgency_level, initiated_at, created_at, updated_at)
         VALUES ('r1', ?, ?, ?, 'INITIATED', 'test', 'URGENT', ?, ?, ?)`,
        [journeyId, hospitalId, hospBId, now, now, now],
      );
      await db.execute(
        `INSERT INTO cached_referrals (id, journey_id, from_hospital_id, to_hospital_id, status, reason, urgency_level, initiated_at, departed_at, created_at, updated_at)
         VALUES ('r2', ?, ?, ?, 'IN_TRANSIT', 'test', 'EMERGENCY', ?, ?, ?, ?)`,
        [journeyId, hospitalId, hospBId, now, now, now, now],
      );

      const alerts = await getDashboardAlerts(db);
      expect(alerts.referralAlerts).toBe(1); // Only INITIATED + ACCEPTED count
      expect(alerts.inTransitReferrals).toBe(1);
    });
  });
});
