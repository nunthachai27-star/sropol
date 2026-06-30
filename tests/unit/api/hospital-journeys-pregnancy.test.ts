// Regression: GET /api/hospitals/[hcode]/journeys?stage=PREGNANCY 500'd in
// production for EVERY hospital. Two portability bugs in the PREGNANCY
// "freshness" filter:
//   1. countSql is `FROM maternal_journeys` (no alias) but the freshness clause
//      references `mj.ga_weeks` → Postgres "missing FROM-clause entry for mj".
//   2. `mj.edc >= NOW() - INTERVAL '14 days'` compares a TEXT column (prod
//      stores edc as ISO text) to a timestamptz → "operator does not exist:
//      text >= timestamp with time zone". Also non-portable: SQLite has no NOW().
//
// The prior journeys.test.ts ran hand-copied SQL WITHOUT the freshness clause,
// so it never exercised the real route — this test drives the actual handler.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables';
import { createJourney } from '@/services/journey';
import { AncRiskLevel } from '@/types/domain';
import { generateKey } from '@/lib/encryption';

process.env.ENCRYPTION_KEY = generateKey();

let db: SqliteAdapter;
vi.mock('@/lib/ensure-init', () => ({ ensureInit: vi.fn() }));
vi.mock('@/db/connection', () => ({ getDatabase: vi.fn(async () => db) }));

import { GET } from '@/app/api/hospitals/[hcode]/journeys/route';

const HOSPITAL_ID = 'hosp-preg-001';
const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

async function seedPregnancy(hn: string, edc: string, lastAncDate: string, gaWeeks: number) {
  const j = await createJourney(db, {
    hospitalId: HOSPITAL_ID,
    hn,
    personAncId: Math.floor(Math.random() * 1e6),
    name: `นาง ${hn}`,
    cid: `enc_${hn}`,
    cidHash: `hash_${hn}`.padEnd(64, '0'),
    age: 28,
    gravida: 1,
    para: 0,
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
  return j;
}

function req() {
  return new NextRequest('http://localhost/api/hospitals/10670/journeys?stage=PREGNANCY&per_page=50');
}
const params = { params: Promise.resolve({ hcode: '10670' }) };

describe('GET /api/hospitals/[hcode]/journeys?stage=PREGNANCY', () => {
  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await SchemaSync.sync(db, ALL_TABLES, 'sqlite');
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, '10670', 'รพ.ทดสอบ', 'A', 1, 'ONLINE', ?, ?)`,
      [HOSPITAL_ID, now, now],
    );
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns 200 (not 500) for the PREGNANCY freshness query', async () => {
    await seedPregnancy('FRESH-1', iso(30 * 86_400_000), iso(-5 * 86_400_000), 32);
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
  });

  it('includes a fresh pregnancy and excludes a stale one (old EDC)', async () => {
    await seedPregnancy('FRESH-2', iso(30 * 86_400_000), iso(-5 * 86_400_000), 30);
    await seedPregnancy('STALE-1', '2018-01-01T00:00:00.000Z', '2018-01-01T00:00:00.000Z', 40);

    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    const hns = body.journeys.map((j: { hn: string }) => j.hn);
    expect(hns).toContain('FRESH-2');
    expect(hns).not.toContain('STALE-1');
    expect(body.pagination.total).toBe(1);
  });
});
