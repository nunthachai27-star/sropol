import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { getStageKPIs, getDashboardAlerts } from '@/services/dashboard';

describe('Dashboard Journey Extensions', () => {
  let db: DatabaseAdapter;
  const hospitalId = 'hosp-001';

  beforeEach(async () => {
    db = await createTestDb();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, '10670', 'รพ.ขอนแก่น', 'A_S', TRUE, 'ONLINE', NOW(), NOW())`,
      [hospitalId],
    );
  });

  afterEach(() => {
    db.close();
  });

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
      for (const [hn, risk] of [
        ['001', 'LOW'],
        ['002', 'LOW'],
        ['003', 'HR1'],
        ['004', 'HR3'],
      ]) {
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

    it('pregnancy counts use the same freshness gate as the /pregnancies board', async () => {
      const now = new Date().toISOString();
      const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
      const daysAhead = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
      const insert = (id: string, lastAnc: string | null, edc: string | null) =>
        db.execute(
          `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, last_anc_date, edc, registered_at, stage_changed_at, synced_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'Test', 'enc_cid', 'cidhash', 25, 1, 0, 'PREGNANCY', 'LOW', 3, ?, ?, ?, ?, ?, ?, ?)`,
          [id, hospitalId, hospitalId, `HN-${id}`, lastAnc, edc, now, now, now, now, now],
        );
      await insert('g-fresh', daysAgo(5), daysAhead(30)); // inside the gate
      await insert('g-ltfu', daysAgo(90), daysAhead(30)); // lost to follow-up
      await insert('g-delivered-edc', daysAgo(5), daysAgo(40)); // EDC long past

      const kpis = await getStageKPIs(db);
      expect(kpis.pregnancy.total).toBe(1);
    });

    it('delivered total counts journeys this month even before newborn records arrive', async () => {
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
         VALUES ('j-delivered-1', ?, ?, 'HN-D1', 'Test', 'enc_cid', 'cidhash', 25, 1, 0, 'DELIVERED', 'LOW', 5, ?, ?, ?, ?, ?)`,
        [hospitalId, hospitalId, now, now, now, now, now],
      );

      const kpis = await getStageKPIs(db);
      expect(kpis.delivered.total).toBe(1);
      expect(kpis.delivered.normal).toBe(1);
      expect(kpis.delivered.lowApgar).toBe(0);
    });
  });

  describe('getDashboardAlerts', () => {
    const hoursAgoIso = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
    const daysAgoIso = (d: number) => hoursAgoIso(d * 24);
    const daysAheadIso = (d: number) => new Date(Date.now() + d * 24 * 3600_000).toISOString();

    async function seedJourney(
      id: string,
      opts: { lastAnc?: string | null; edc?: string | null; gaWeeks?: number | null } = {},
    ) {
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, last_anc_date, edc, ga_weeks, registered_at, stage_changed_at, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Test', 'enc_cid', 'cidhash', 25, 1, 0, 'PREGNANCY', 'LOW', 3, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          hospitalId,
          hospitalId,
          `HN-${id}`,
          opts.lastAnc ?? null,
          opts.edc ?? null,
          opts.gaWeeks ?? 30,
          now,
          now,
          now,
          now,
          now,
        ],
      );
    }

    async function seedReferral(
      id: string,
      opts: { status?: string; urgency?: string; ageHours?: number } = {},
    ) {
      const initiated = hoursAgoIso(opts.ageHours ?? 1);
      await db.execute(
        `INSERT INTO cached_referrals (id, journey_id, from_hospital_id, to_hospital_id, status, reason, urgency_level, initiated_at, created_at, updated_at)
         VALUES (?, 'j-ref', ?, ?, ?, 'test', ?, ?, ?, ?)`,
        [
          id,
          hospitalId,
          hospitalId,
          opts.status ?? 'INITIATED',
          opts.urgency ?? 'ROUTINE',
          initiated,
          initiated,
          initiated,
        ],
      );
    }

    it('returns zero alerts when no data', async () => {
      const alerts = await getDashboardAlerts(db);
      expect(alerts.referralAlerts).toBe(0);
      expect(alerts.overdueAnc).toBe(0);
      expect(alerts.dueSoon).toBe(0);
    });

    it('counts only actionable referrals: overdue INITIATED plus active emergencies', async () => {
      await seedJourney('j-ref');
      // Fresh routine INITIATED — pending but not actionable yet.
      await seedReferral('r-fresh', { ageHours: 1 });
      // Past the SLA — actionable.
      await seedReferral('r-overdue', { ageHours: 30 });
      // Active emergency — actionable regardless of age.
      await seedReferral('r-emergency', { urgency: 'EMERGENCY', ageHours: 1 });
      // Emergency already arrived — resolved, not actionable.
      await seedReferral('r-em-done', { urgency: 'EMERGENCY', status: 'ARRIVED', ageHours: 50 });

      const alerts = await getDashboardAlerts(db);
      expect(alerts.referralAlerts).toBe(2);
    });

    it('overdueAnc uses the gated registry and the anc-ops threshold, matching the boards', async () => {
      // 40 days since ANC — inside the 60-day gate, past the 35-day warn: counted.
      await seedJourney('j-stale', { lastAnc: daysAgoIso(40), edc: daysAheadIso(30) });
      // 70 days — beyond the gate (lost to follow-up), so NOT part of the registry.
      await seedJourney('j-ltfu', { lastAnc: daysAgoIso(70), edc: daysAheadIso(30) });
      // Fresh visit — not overdue.
      await seedJourney('j-fresh', { lastAnc: daysAgoIso(5), edc: daysAheadIso(30) });
      // Stale AND EDC long past — treated as delivered by the gate, not counted.
      await seedJourney('j-delivered', { lastAnc: daysAgoIso(40), edc: daysAgoIso(30) });

      const alerts = await getDashboardAlerts(db);
      expect(alerts.overdueAnc).toBe(1);
    });

    it('dueSoon counts gated pregnancies with EDC inside the window (replaces dead in-transit)', async () => {
      await seedJourney('j-due', { lastAnc: daysAgoIso(5), edc: daysAheadIso(5) });
      await seedJourney('j-past-edc', { lastAnc: daysAgoIso(5), edc: daysAgoIso(3) }); // grace window
      await seedJourney('j-far', { lastAnc: daysAgoIso(5), edc: daysAheadIso(60) });

      const alerts = await getDashboardAlerts(db);
      expect(alerts.dueSoon).toBe(2);
    });
  });
});
