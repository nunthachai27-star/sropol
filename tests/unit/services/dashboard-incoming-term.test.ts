// Regression: getIncomingTermPregnancies built its PREGNANCY freshness filter
// with `mj.edc >= NOW() - INTERVAL '14 days'`. edc / last_anc_date are stored
// as ISO-8601 TEXT in existing deployments, so that comparison threw on
// Postgres ("operator does not exist: text >= timestamp with time zone") — the
// refer-in "GA ≥ 34W" panel was broken. This had ZERO test coverage. The query
// must execute against rows whose edc/last_anc_date are ISO text and return a
// well-formed result (no throw).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables';
import { createJourney } from '@/services/journey';
import { getIncomingTermPregnancies } from '@/services/dashboard';
import { AncRiskLevel } from '@/types/domain';
import { generateKey } from '@/lib/encryption';

process.env.ENCRYPTION_KEY = generateKey();

describe('getIncomingTermPregnancies — PREGNANCY freshness query', () => {
  let db: SqliteAdapter;
  const hubId = 'hub-001';
  const spokeId = 'spoke-001';
  const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await SchemaSync.sync(db, ALL_TABLES, 'sqlite');
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, '10670', 'รพ.ฮับ', 'A', 1, 'ONLINE', ?, ?)`,
      [hubId, now, now],
    );
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, '11000', 'รพ.spoke', 'F2', 1, 'ONLINE', ?, ?)`,
      [spokeId, now, now],
    );
  });

  afterEach(async () => {
    await db.close();
  });

  async function seedPregnancy(hn: string, edc: string, lastAncDate: string, gaWeeks: number) {
    const j = await createJourney(db, {
      hospitalId: spokeId,
      hn,
      personAncId: Math.floor(Math.random() * 1e6),
      name: `นาง ${hn}`,
      cid: `enc_${hn}`,
      cidHash: `hash_${hn}`.padEnd(64, '0'),
      age: 30,
      gravida: 2,
      para: 1,
      lmp: '2025-06-01',
      edc,
      ancRiskLevel: AncRiskLevel.LOW,
    });
    await db.execute(`UPDATE maternal_journeys SET edc = ?, last_anc_date = ?, ga_weeks = ? WHERE id = ?`, [
      edc,
      lastAncDate,
      gaWeeks,
      j.id,
    ]);
  }

  it('executes against ISO-text edc/last_anc_date rows without throwing', async () => {
    await seedPregnancy('FRESH-TERM', iso(7 * 86_400_000), iso(-3 * 86_400_000), 38);
    await seedPregnancy('STALE-TERM', '2018-01-01T00:00:00.000Z', '2018-01-01T00:00:00.000Z', 40);

    const result = await getIncomingTermPregnancies(db, '10670');

    expect(result.hubHcode).toBe('10670');
    expect(typeof result.count).toBe('number');
    expect(Array.isArray(result.items)).toBe(true);
    // The stale pregnancy is filtered out by the SQL freshness clause before
    // routing, so it can never surface in items.
    expect(result.items.some((i) => i.hn === 'STALE-TERM')).toBe(false);
  });
});
