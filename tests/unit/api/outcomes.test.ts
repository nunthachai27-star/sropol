import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { getNewbornKPIs } from '@/services/newborn';
import { upsertNewborn } from '@/services/newborn';

describe('Outcomes API', () => {
  let db: DatabaseAdapter;
  const hospitalId = 'hosp-001';
  const journeyId = 'journey-001';

  beforeEach(async () => {
    db = await createTestDb();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES ('${hospitalId}', '10670', 'รพ.ขอนแก่น', 'A_S', TRUE, 'ONLINE', NOW(), NOW())`,
    );
    await db.execute(
      `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
       VALUES ('${journeyId}', '${hospitalId}', '${hospitalId}', '12345', 'Test', 'enc_cid', 'cidhash_out', 28, 1, 0, 'DELIVERED', 'LOW', 5, NOW(), NOW(), NOW(), NOW(), NOW())`,
    );
  });

  afterEach(() => {
    db.close();
  });

  describe('newborn list by journey', () => {
    it('returns empty array when no newborns', async () => {
      const rows = await db.query<Record<string, unknown>>(
        `SELECT * FROM cached_newborns WHERE journey_id = ?`,
        [journeyId],
      );
      expect(rows.length).toBe(0);
    });

    it('returns newborns ordered by infant_number', async () => {
      await upsertNewborn(db, {
        journeyId,
        infantNumber: 2,
        sex: 'F',
        birthWeightG: 2800,
        apgar1min: 8,
        apgar5min: 9,
        resuscitation: {},
        vaccinations: {},
        bornAt: '2026-03-08T10:35:00Z',
      });
      await upsertNewborn(db, {
        journeyId,
        infantNumber: 1,
        sex: 'M',
        birthWeightG: 3000,
        apgar1min: 9,
        apgar5min: 10,
        resuscitation: {},
        vaccinations: {},
        bornAt: '2026-03-08T10:30:00Z',
      });

      const rows = await db.query<Record<string, unknown>>(
        `SELECT * FROM cached_newborns WHERE journey_id = ? ORDER BY infant_number`,
        [journeyId],
      );
      expect(rows.length).toBe(2);
      expect(rows[0].infant_number).toBe(1);
      expect(rows[1].infant_number).toBe(2);
    });
  });

  describe('neonatal KPIs', () => {
    it('returns correct KPIs with mixed data', async () => {
      await upsertNewborn(db, {
        journeyId,
        infantNumber: 1,
        sex: 'M',
        birthWeightG: 2400,
        apgar1min: 5,
        apgar5min: 6,
        resuscitation: {},
        vaccinations: {},
        bornAt: '2026-03-08T10:30:00Z',
      });

      const kpis = await getNewbornKPIs(db);
      expect(kpis.totalBirths).toBe(1);
      expect(kpis.lbwCount).toBe(1);
      expect(kpis.lowApgarCount).toBe(1);
    });

    it('returns zero KPIs when no data', async () => {
      const kpis = await getNewbornKPIs(db);
      expect(kpis.totalBirths).toBe(0);
      expect(kpis.lbwRate).toBe(0);
    });
  });
});
