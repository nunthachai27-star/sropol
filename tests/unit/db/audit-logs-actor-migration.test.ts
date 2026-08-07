// TDD for migrateAuditLogsActor: the production audit_logs table was created
// with `user_id VARCHAR(36) NOT NULL REFERENCES users(id)`. BMS-session actors
// have no users row, so every audit INSERT failed audit_logs_user_id_fkey.
// schema-sync only ADD COLUMNs, so this one-shot idempotent migration must
// drop the FK and the NOT NULL on the EXISTING table. Verified against PGlite
// (a real Postgres engine).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PgliteAdapter } from '@/db/pglite-adapter';
import { migrateAuditLogsActor } from '@/db/migrations/audit-logs-actor';

describe('migrateAuditLogsActor', () => {
  let db: PgliteAdapter;
  let seq = 0;

  beforeEach(async () => {
    db = new PgliteAdapter(new PGlite());
    seq = 0;
    // Recreate the PRE-migration production shape: user_id NOT NULL + FK.
    await db.execute(`CREATE TABLE users (id VARCHAR(36) PRIMARY KEY, bms_user_name VARCHAR(255))`);
    await db.execute(
      `CREATE TABLE audit_logs (
         id VARCHAR(36) PRIMARY KEY,
         user_id VARCHAR(36) NOT NULL REFERENCES users(id),
         action VARCHAR(50) NOT NULL,
         resource_type VARCHAR(50) NOT NULL,
         created_at TIMESTAMPTZ NOT NULL
       )`,
    );
  });

  afterEach(async () => {
    await db.close();
  });

  function insertAudit(userId: string | null) {
    seq += 1;
    return db.execute(
      `INSERT INTO audit_logs (id, user_id, action, resource_type, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [`log-${seq}`, userId, 'VIEW_PATIENT', 'PATIENT', new Date().toISOString()],
    );
  }

  it('a BMS-session user_id violates the FK BEFORE the migration', async () => {
    await expect(insertAudit('bms-session-with-no-users-row')).rejects.toThrow();
  });

  it('lets a BMS-session actor be audited AFTER the migration (FK dropped)', async () => {
    await migrateAuditLogsActor(db);
    await insertAudit('bms-session-with-no-users-row');
    const rows = await db.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM audit_logs`);
    expect(Number(rows[0].c)).toBe(1);
  });

  it('allows a NULL user_id after the migration (NOT NULL dropped)', async () => {
    await migrateAuditLogsActor(db);
    await insertAudit(null);
    const rows = await db.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM audit_logs`);
    expect(Number(rows[0].c)).toBe(1);
  });

  it('is idempotent — safe to run on every boot', async () => {
    await migrateAuditLogsActor(db);
    await migrateAuditLogsActor(db);
    // The second run neither throws nor re-adds the constraint: an insert still
    // succeeds afterwards.
    await insertAudit('again');
    const rows = await db.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM audit_logs`);
    expect(Number(rows[0].c)).toBe(1);
  });
});
