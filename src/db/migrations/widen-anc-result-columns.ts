// One-shot idempotent migration: widen ANC result columns to fit real
// source-EHR data.
//
// Root cause (prod 2026-07-14..16, hospitals 11004/11011/12275): HOSxP lab
// and urine results are FREE TEXT ("Non-reactive" = 12 chars, Thai phrases,
// titer ratios) but these columns were declared for short codes
// (VARCHAR(2..20)). One over-long value threw "value too long for type
// character varying(N)" and aborted the hospital's ENTIRE ANC bundle every
// sync cycle — silently, because browser-push demotes persist errors to a
// warning step.
//
// Widening VARCHAR in PostgreSQL is a catalog-only change (no table rewrite,
// instant) and non-destructive: the previous application image reads/writes
// the widened columns unchanged, so rollback stays safe. Cannot go via the
// table definition alone: SchemaSync creates tables and ADDs columns but
// never ALTERs existing ones.
import type { DatabaseAdapter } from '@/db/adapter';
import { logger } from '@/lib/logger';

/** Target widths — MUST mirror the maxLength values in src/db/tables/. */
export const ANC_RESULT_COLUMN_WIDTHS: ReadonlyArray<{
  table: string;
  column: string;
  width: number;
}> = [
  { table: 'maternal_journeys', column: 'blood_group', width: 10 },
  { table: 'maternal_journeys', column: 'rh_factor', width: 10 },
  { table: 'maternal_journeys', column: 'hbsag_result', width: 50 },
  { table: 'maternal_journeys', column: 'vdrl_result', width: 50 },
  { table: 'maternal_journeys', column: 'hiv_result', width: 50 },
  { table: 'maternal_journeys', column: 'ogtt_result', width: 50 },
  { table: 'cached_anc_visits', column: 'urine_protein', width: 50 },
  { table: 'cached_anc_visits', column: 'urine_glucose', width: 50 },
  { table: 'cached_anc_visits', column: 'urine_ketone', width: 50 },
  { table: 'cached_anc_visits', column: 'urine_culture_result', width: 50 },
];

export async function migrateWidenAncResultColumns(db: DatabaseAdapter): Promise<void> {
  let altered = 0;
  for (const t of ANC_RESULT_COLUMN_WIDTHS) {
    const rows = await db.query<{ character_maximum_length: number | null }>(
      `SELECT character_maximum_length
         FROM information_schema.columns
        WHERE table_name = ? AND column_name = ?`,
      [t.table, t.column],
    );
    const current = rows[0]?.character_maximum_length;
    // Missing column (fresh DB mid-sync) or already wide enough → no-op.
    if (current == null || Number(current) >= t.width) continue;
    await db.execute(`ALTER TABLE ${t.table} ALTER COLUMN ${t.column} TYPE VARCHAR(${t.width})`);
    altered++;
  }
  if (altered > 0) {
    logger.info('anc_result_columns_widened', { altered });
  }
}
