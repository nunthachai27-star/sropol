import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables';
import {
  createJourney,
  getJourneyByHn,
  transitionToLabor,
  transitionToDelivered,
  getActiveJourneys,
} from '@/services/journey';
import { CareStage, AncRiskLevel } from '@/types/domain';

describe('Journey Lifecycle Service', () => {
  let db: SqliteAdapter;
  const hospitalId = 'hosp-001';

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await SchemaSync.sync(db, ALL_TABLES, 'sqlite');
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES ('${hospitalId}', '10670', 'รพ.ขอนแก่น', 'A_S', 1, 'ONLINE', datetime('now'), datetime('now'))`,
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
        hospitalId, hn: '12345', personAncId: 100,
        name: 'Test', cid: 'enc_test_019', cidHash: 'testhash00000000000000000000000000000000000000000000000000000019',
        age: 25, gravida: 1, para: 0,
        lmp: '2025-06-01', edc: '2026-03-08',
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
        hospitalId, hn: '12345', personAncId: 100,
        name: 'Test', cid: 'enc_test_020', cidHash: 'testhash00000000000000000000000000000000000000000000000000000020',
        age: 25, gravida: 1, para: 0,
        lmp: '2025-06-01', edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.HR1,
      });

      await transitionToLabor(db, journey.id);

      const updated = await getJourneyByHn(db, '12345', hospitalId);
      expect(updated!.careStage).toBe(CareStage.LABOR);
    });
  });

  describe('transitionToDelivered', () => {
    it('updates care_stage to DELIVERED', async () => {
      const journey = await createJourney(db, {
        hospitalId, hn: '12345', personAncId: 100,
        name: 'Test', cid: 'enc_test_021', cidHash: 'testhash00000000000000000000000000000000000000000000000000000021',
        age: 25, gravida: 1, para: 0,
        lmp: '2025-06-01', edc: '2026-03-08',
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
  });

  describe('getActiveJourneys', () => {
    it('returns journeys filtered by stage', async () => {
      await createJourney(db, {
        hospitalId, hn: '001', personAncId: 1,
        name: 'P1', cid: 'enc_test_022', cidHash: 'testhash00000000000000000000000000000000000000000000000000000022',
        age: 25, gravida: 1, para: 0,
        lmp: '2025-06-01', edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });
      const j2 = await createJourney(db, {
        hospitalId, hn: '002', personAncId: 2,
        name: 'P2', cid: 'enc_test_023', cidHash: 'testhash00000000000000000000000000000000000000000000000000000023',
        age: 30, gravida: 2, para: 1,
        lmp: '2025-07-01', edc: '2026-04-07',
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
        hospitalId, hn: '001', personAncId: 1,
        name: 'P1', cid: 'enc_test_024', cidHash: 'testhash00000000000000000000000000000000000000000000000000000024',
        age: 25, gravida: 1, para: 0,
        lmp: '2025-06-01', edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });
      await createJourney(db, {
        hospitalId, hn: '002', personAncId: 2,
        name: 'P2', cid: 'enc_test_025', cidHash: 'testhash00000000000000000000000000000000000000000000000000000025',
        age: 30, gravida: 2, para: 1,
        lmp: '2025-07-01', edc: '2026-04-07',
        ancRiskLevel: AncRiskLevel.HR3,
      });

      const hr3 = await getActiveJourneys(db, hospitalId, { riskLevel: AncRiskLevel.HR3 });
      expect(hr3.length).toBe(1);
      expect(hr3[0].hn).toBe('002');
    });
  });
});
