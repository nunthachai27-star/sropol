// One-shot idempotent migration for Release B task B3.
//
// At most one ACTIVE (PREGNANCY/LABOR) journey per (hospital_id, hn).
// Community-ANC journeys (hn = '') carry no HN identity and are exempt.
//
// FAILS SAFE (Release B reconciliation contract): when duplicates already
// exist the index is NOT created and the duplicates are reported for manual
// clinical review — historical rows are never rewritten here. Cannot go via
// the table definition: SchemaSync has no partial-index support and
// syncIndexes swallows errors.
import type { DatabaseAdapter } from '@/db/adapter';
import { logger } from '@/lib/logger';

export async function migrateMaternalJourneysActiveUnique(db: DatabaseAdapter): Promise<void> {
  const dupes = await db.query<{ hospital_id: string; hn: string; n: number }>(
    `SELECT hospital_id, hn, COUNT(*) as n
       FROM maternal_journeys
      WHERE care_stage IN ('PREGNANCY', 'LABOR') AND hn <> ''
      GROUP BY hospital_id, hn
     HAVING COUNT(*) > 1`,
  );
  if (dupes.length > 0) {
    logger.error('mj_active_unique_blocked_by_duplicates', {
      duplicateGroups: dupes.length,
      hospitals: [...new Set(dupes.map((d) => d.hospital_id))].length,
    });
    return;
  }
  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_mj_hospital_hn_active
       ON maternal_journeys (hospital_id, hn)
       WHERE care_stage IN ('PREGNANCY', 'LABOR') AND hn <> ''`,
  );
  logger.info('mj_active_unique_created', {});
}
