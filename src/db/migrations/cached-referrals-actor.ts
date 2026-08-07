// One-shot, idempotent migration for the cached_referrals actor fix.
//
// cached_referrals.initiated_by / accepted_by were created as
// `VARCHAR(36) REFERENCES users(id)`. BMS-session actors never get a users
// row, so every referral create/accept INSERT failed the
// cached_referrals_initiated_by_fkey / cached_referrals_accepted_by_fkey
// constraint. Separately, VARCHAR(36) is sized for a uuid, but the actor
// value is actually a Thai display name (session.user.name), which routinely
// exceeds 36 chars once title/honorific prefixes are included — every such
// insert then failed "value too long for type character varying(36)" even
// after the FK was gone. The table definition now models these columns as
// nullable, non-FK, string/255 identity snapshots (see
// src/db/tables/cached-referrals.ts), but SchemaSync only ever CREATEs
// tables or ADDs columns — it never ALTERs an existing column's type or
// drops a constraint. So on an already-provisioned database the old FKs and
// the 36-char width persist and must be fixed explicitly here.
//
// Runs on every boot (right after schema sync) and is fully idempotent:
// `DROP CONSTRAINT IF EXISTS` is a no-op when the FK is already gone, and
// widening an already-VARCHAR(255) column is a no-op too. Widening never
// truncates existing data (every existing value is NULL or <= 36 chars).
//
// Same rationale as src/db/migrations/audit-logs-actor.ts (bc31704).
import type { DatabaseAdapter } from '@/db/adapter';
import { logger } from '@/lib/logger';

/**
 * Drop the legacy `cached_referrals_initiated_by_fkey` and
 * `cached_referrals_accepted_by_fkey` FKs to users(id), and widen
 * initiated_by/accepted_by from VARCHAR(36) to VARCHAR(255) so a full Thai
 * display name round-trips. Fresh databases (including pglite) already
 * create the table in the corrected shape, so on them every statement here
 * is a no-op.
 */
export async function migrateCachedReferralsActor(db: DatabaseAdapter): Promise<void> {
  // `ALTER TABLE IF EXISTS` guards the case where the table isn't present yet
  // (it always is post-schema-sync, but this keeps the migration order-safe).
  await db.execute(
    `ALTER TABLE IF EXISTS cached_referrals DROP CONSTRAINT IF EXISTS cached_referrals_initiated_by_fkey`,
  );
  await db.execute(
    `ALTER TABLE IF EXISTS cached_referrals DROP CONSTRAINT IF EXISTS cached_referrals_accepted_by_fkey`,
  );
  await db.execute(
    `ALTER TABLE IF EXISTS cached_referrals ALTER COLUMN initiated_by TYPE VARCHAR(255)`,
  );
  await db.execute(
    `ALTER TABLE IF EXISTS cached_referrals ALTER COLUMN accepted_by TYPE VARCHAR(255)`,
  );
  logger.info('cached_referrals_actor_migrated', {});
}
