// TDD for migrateCachedReferralsActor: the production cached_referrals table
// was created with `initiated_by`/`accepted_by VARCHAR(36) REFERENCES
// users(id)`. BMS-session actors have no users row, so every referral
// create/accept INSERT failed cached_referrals_initiated_by_fkey /
// cached_referrals_accepted_by_fkey. Separately, VARCHAR(36) is sized for a
// uuid but the actor value is a Thai display name that routinely exceeds 36
// chars, so inserts kept failing ("value too long for type character
// varying(36)") even after the FK was dropped. schema-sync only ADD
// COLUMNs, so this one-shot idempotent migration must drop the FKs AND
// widen the columns on the EXISTING table. Verified against PGlite (a real
// Postgres engine).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PgliteAdapter } from '@/db/pglite-adapter';
import { migrateCachedReferralsActor } from '@/db/migrations/cached-referrals-actor';

describe('migrateCachedReferralsActor', () => {
  let db: PgliteAdapter;
  let seq = 0;

  beforeEach(async () => {
    db = new PgliteAdapter(new PGlite());
    seq = 0;
    // Recreate the PRE-migration production shape: initiated_by/accepted_by FK'd to users.
    await db.execute(`CREATE TABLE users (id VARCHAR(36) PRIMARY KEY, bms_user_name VARCHAR(255))`);
    await db.execute(
      `CREATE TABLE cached_referrals (
         id VARCHAR(36) PRIMARY KEY,
         status VARCHAR(20) NOT NULL DEFAULT 'INITIATED',
         reason TEXT NOT NULL,
         initiated_by VARCHAR(36) REFERENCES users(id),
         accepted_by VARCHAR(36) REFERENCES users(id),
         created_at TIMESTAMPTZ NOT NULL
       )`,
    );
  });

  afterEach(async () => {
    await db.close();
  });

  function insertReferral(initiatedBy: string | null, acceptedBy: string | null) {
    seq += 1;
    return db.execute(
      `INSERT INTO cached_referrals (id, reason, initiated_by, accepted_by, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [`referral-${seq}`, 'test', initiatedBy, acceptedBy, new Date().toISOString()],
    );
  }

  it('a BMS-session initiated_by violates the FK BEFORE the migration', async () => {
    await expect(insertReferral('bms-session-with-no-users-row', null)).rejects.toThrow();
  });

  it('a BMS-session accepted_by violates the FK BEFORE the migration', async () => {
    await expect(insertReferral(null, 'bms-session-with-no-users-row')).rejects.toThrow();
  });

  it('lets a BMS-session actor initiate/accept AFTER the migration (FKs dropped)', async () => {
    await migrateCachedReferralsActor(db);
    await insertReferral('bms-session-with-no-users-row', 'another-bms-session');
    const rows = await db.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM cached_referrals`);
    expect(Number(rows[0].c)).toBe(1);
  });

  it('is idempotent — safe to run on every boot', async () => {
    await migrateCachedReferralsActor(db);
    await migrateCachedReferralsActor(db);
    // The second run neither throws nor re-adds the constraints: an insert
    // still succeeds afterwards.
    await insertReferral('again', 'again-too');
    const rows = await db.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM cached_referrals`);
    expect(Number(rows[0].c)).toBe(1);
  });

  it('a >36-char Thai display name violates the width BEFORE the migration', async () => {
    const LONG_NAME = 'นางสาวสมหญิง ทองดีมีสุขสวัสดิ์วงศ์ ณ อยุธยา'; // 43 chars
    await expect(insertReferral(LONG_NAME, null)).rejects.toThrow();
  });

  it('lets a >36-char Thai display name round-trip AFTER the migration (column widened)', async () => {
    const LONG_NAME = 'นางสาวสมหญิง ทองดีมีสุขสวัสดิ์วงศ์ ณ อยุธยา'; // 43 chars
    await migrateCachedReferralsActor(db);
    await insertReferral(LONG_NAME, LONG_NAME);
    const rows = await db.query<{ initiated_by: string; accepted_by: string }>(
      `SELECT initiated_by, accepted_by FROM cached_referrals`,
    );
    expect(rows[0].initiated_by).toBe(LONG_NAME);
    expect(rows[0].accepted_by).toBe(LONG_NAME);
  });
});
