import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import {
  createJourney,
  getJourneyByHn,
  transitionToLabor,
  transitionToDelivered,
  getActiveJourneys,
} from '@/services/journey';
import { CareStage, AncRiskLevel } from '@/types/domain';

describe('Journey Lifecycle Service', () => {
  let db: DatabaseAdapter;
  const hospitalId = 'hosp-001';

  beforeEach(async () => {
    db = await createTestDb();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES ('${hospitalId}', '10670', 'รพ.ขอนแก่น', 'A_S', TRUE, 'ONLINE', NOW(), NOW())`,
    );
  });

  afterEach(() => {
    db.close();
  });

  describe('createJourney', () => {
    it('creates a journey with PREGNANCY stage', async () => {
      const journey = await createJourney(db, {
        hospitalId,
        hn: '12345',
        personAncId: 100,
        name: 'Test Patient',
        cid: 'enc_test_206',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000107',
        age: 25,
        gravida: 1,
        para: 0,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });

      expect(journey.id).toBeTruthy();
      expect(journey.careStage).toBe(CareStage.PREGNANCY);
      expect(journey.hn).toBe('12345');
      expect(journey.gravida).toBe(1);
      expect(journey.ancRiskLevel).toBe(AncRiskLevel.LOW);
    });
  });

  describe('getJourneyByHn', () => {
    it('finds existing journey by HN and hospital', async () => {
      await createJourney(db, {
        hospitalId,
        hn: '12345',
        personAncId: 100,
        name: 'Test',
        cid: 'enc_test_019',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000019',
        age: 25,
        gravida: 1,
        para: 0,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });

      const found = await getJourneyByHn(db, '12345', hospitalId);
      expect(found).not.toBeNull();
      expect(found!.hn).toBe('12345');
    });

    it('returns null when no journey exists', async () => {
      const found = await getJourneyByHn(db, '99999', hospitalId);
      expect(found).toBeNull();
    });
  });

  describe('transitionToLabor', () => {
    it('updates care_stage to LABOR', async () => {
      const journey = await createJourney(db, {
        hospitalId,
        hn: '12345',
        personAncId: 100,
        name: 'Test',
        cid: 'enc_test_020',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000020',
        age: 25,
        gravida: 1,
        para: 0,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.HR1,
      });

      await transitionToLabor(db, journey.id);

      const updated = await getJourneyByHn(db, '12345', hospitalId);
      expect(updated!.careStage).toBe(CareStage.LABOR);
    });

    it('does not re-stamp stage_changed_at when already in LABOR', async () => {
      const journey = await createJourney(db, {
        hospitalId,
        hn: '12345',
        personAncId: 100,
        name: 'Test',
        cid: 'enc_test_130',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000130',
        age: 25,
        gravida: 1,
        para: 0,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });
      const journeyId = journey.id;

      await transitionToLabor(db, journeyId);
      const first = await db.query<{ stage_changed_at: unknown }>(
        'SELECT stage_changed_at FROM maternal_journeys WHERE id = ?',
        [journeyId],
      );
      await transitionToLabor(db, journeyId);
      const second = await db.query<{ stage_changed_at: unknown }>(
        'SELECT stage_changed_at FROM maternal_journeys WHERE id = ?',
        [journeyId],
      );
      expect(String(second[0].stage_changed_at)).toBe(String(first[0].stage_changed_at));
    });
  });

  describe('transitionToDelivered', () => {
    it('updates care_stage to DELIVERED', async () => {
      const journey = await createJourney(db, {
        hospitalId,
        hn: '12345',
        personAncId: 100,
        name: 'Test',
        cid: 'enc_test_021',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000021',
        age: 25,
        gravida: 1,
        para: 0,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });
      await transitionToLabor(db, journey.id);
      await transitionToDelivered(db, journey.id);

      // getJourneyByHn only finds PREGNANCY/LABOR, so query directly
      const rows = await db.query<Record<string, unknown>>(
        `SELECT care_stage FROM maternal_journeys WHERE id = ?`,
        [journey.id],
      );
      expect(rows[0].care_stage).toBe(CareStage.DELIVERED);
    });

    it('is idempotent — re-transitioning does not re-stamp stage_changed_at', async () => {
      // The newborn sync calls transitionToDelivered on every birth attach,
      // including backfilled historical births. Re-stamping stage_changed_at
      // pushed months-old deliveries into "delivered this month" (dashboard
      // KPI inflation: 1,072 shown vs 28 real July births, 2026-07-10).
      const journey = await createJourney(db, {
        hospitalId,
        hn: '12346',
        personAncId: 101,
        name: 'Test2',
        cid: 'enc_test_121',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000121',
        age: 25,
        gravida: 1,
        para: 0,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });
      await transitionToDelivered(db, journey.id);
      const first = await db.query<{ stage_changed_at: string }>(
        `SELECT stage_changed_at FROM maternal_journeys WHERE id = ?`,
        [journey.id],
      );

      // Backdate the stamp, then re-transition — the stamp must survive.
      const past = new Date(Date.now() - 90 * 86_400_000).toISOString();
      await db.execute(`UPDATE maternal_journeys SET stage_changed_at = ? WHERE id = ?`, [
        past,
        journey.id,
      ]);
      await transitionToDelivered(db, journey.id);

      const rows = await db.query<{ care_stage: string; stage_changed_at: string }>(
        `SELECT care_stage, stage_changed_at FROM maternal_journeys WHERE id = ?`,
        [journey.id],
      );
      expect(rows[0].care_stage).toBe(CareStage.DELIVERED);
      expect(new Date(rows[0].stage_changed_at).getTime()).toBe(new Date(past).getTime());
      expect(first).toBeDefined();
    });
  });

  describe('getActiveJourneys', () => {
    it('returns journeys filtered by stage', async () => {
      await createJourney(db, {
        hospitalId,
        hn: '001',
        personAncId: 1,
        name: 'P1',
        cid: 'enc_test_022',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000022',
        age: 25,
        gravida: 1,
        para: 0,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });
      const j2 = await createJourney(db, {
        hospitalId,
        hn: '002',
        personAncId: 2,
        name: 'P2',
        cid: 'enc_test_023',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000023',
        age: 30,
        gravida: 2,
        para: 1,
        lmp: '2025-07-01',
        edc: '2026-04-07',
        ancRiskLevel: AncRiskLevel.HR2,
      });
      await transitionToLabor(db, j2.id);

      const pregnancies = await getActiveJourneys(db, hospitalId, { stage: CareStage.PREGNANCY });
      expect(pregnancies.length).toBe(1);
      expect(pregnancies[0].hn).toBe('001');

      const labors = await getActiveJourneys(db, hospitalId, { stage: CareStage.LABOR });
      expect(labors.length).toBe(1);
      expect(labors[0].hn).toBe('002');
    });

    it('returns journeys filtered by risk level', async () => {
      await createJourney(db, {
        hospitalId,
        hn: '001',
        personAncId: 1,
        name: 'P1',
        cid: 'enc_test_024',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000024',
        age: 25,
        gravida: 1,
        para: 0,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });
      await createJourney(db, {
        hospitalId,
        hn: '002',
        personAncId: 2,
        name: 'P2',
        cid: 'enc_test_025',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000025',
        age: 30,
        gravida: 2,
        para: 1,
        lmp: '2025-07-01',
        edc: '2026-04-07',
        ancRiskLevel: AncRiskLevel.HR3,
      });

      const hr3 = await getActiveJourneys(db, hospitalId, { riskLevel: AncRiskLevel.HR3 });
      expect(hr3.length).toBe(1);
      expect(hr3[0].hn).toBe('002');
    });
  });
});
