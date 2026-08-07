// Release B task B3 — fail-safe active-journey uniqueness migration.
import { describe, it, expect } from 'vitest';
import { createPgliteDb } from '../../helpers/createPgliteDb';
import { migrateMaternalJourneysActiveUnique } from '@/db/migrations/maternal-journeys-active-unique';
import { SeedOrchestrator } from '@/db/seeds/index';
import { createJourney } from '@/services/journey';
import { AncRiskLevel } from '@/types/domain';

async function seededDb() {
  const db = await createPgliteDb();
  await new SeedOrchestrator().run(db);
  const rows = await db.query<{ id: string }>(`SELECT id FROM hospitals LIMIT 1`);
  return { db, hospitalId: rows[0].id };
}

function journeyInput(hospitalId: string, hn: string, cidHash: string) {
  return {
    hospitalId,
    hn,
    personAncId: null,
    name: '',
    cid: '',
    cidHash,
    age: 30,
    gravida: 1,
    para: 0,
    lmp: null,
    edc: null,
    ancRiskLevel: AncRiskLevel.LOW,
  };
}

describe('migrateMaternalJourneysActiveUnique', () => {
  it('creates the partial unique index on a clean database, idempotently', async () => {
    const { db } = await seededDb();
    await migrateMaternalJourneysActiveUnique(db);
    await migrateMaternalJourneysActiveUnique(db); // second run: no-op
    const idx = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'maternal_journeys' AND indexname = 'uq_mj_hospital_hn_active'`,
    );
    expect(idx.length).toBe(1);
    await db.close();
  });

  it('enforces one active journey per hospital+hn once applied; hn="" exempt', async () => {
    const { db, hospitalId } = await seededDb();
    await migrateMaternalJourneysActiveUnique(db);
    await createJourney(db, journeyInput(hospitalId, 'HN-U1', 'h1'));
    await expect(createJourney(db, journeyInput(hospitalId, 'HN-U1', 'h2'))).rejects.toThrow();
    // community-ANC journeys (hn = '') never collide:
    await createJourney(db, journeyInput(hospitalId, '', 'h3'));
    await createJourney(db, journeyInput(hospitalId, '', 'h4'));
    await db.close();
  });

  it('FAILS SAFE with existing duplicates: reports, skips index, rewrites nothing', async () => {
    const { db, hospitalId } = await seededDb();
    await createJourney(db, journeyInput(hospitalId, 'HN-DUP', 'd1'));
    await createJourney(db, journeyInput(hospitalId, 'HN-DUP', 'd2')); // pre-existing dirty data
    await migrateMaternalJourneysActiveUnique(db);
    const idx = await db.query(
      `SELECT indexname FROM pg_indexes WHERE indexname = 'uq_mj_hospital_hn_active'`,
    );
    expect(idx.length).toBe(0); // refused
    const rows = await db.query(`SELECT id FROM maternal_journeys WHERE hn = 'HN-DUP'`);
    expect(rows.length).toBe(2); // untouched
    await db.close();
  });
});
