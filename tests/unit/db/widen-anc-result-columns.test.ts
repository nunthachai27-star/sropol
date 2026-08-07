// Migration tests: widen ANC lab/urine result columns (value-too-long fix).
// Uses a dedicated PGlite instance (DDL-mutating) per testDb.ts guidance.
import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createPgliteDb } from '../../helpers/createPgliteDb';
import type { DatabaseAdapter } from '@/db/adapter';
import {
  migrateWidenAncResultColumns,
  ANC_RESULT_COLUMN_WIDTHS,
} from '@/db/migrations/widen-anc-result-columns';

async function width(db: DatabaseAdapter, table: string, column: string): Promise<number> {
  const rows = await db.query<{ character_maximum_length: number }>(
    `SELECT character_maximum_length FROM information_schema.columns
      WHERE table_name = ? AND column_name = ?`,
    [table, column],
  );
  return Number(rows[0]?.character_maximum_length);
}

/** Simulate a pre-migration production DB: narrow the columns back down. */
async function narrowToLegacyWidths(db: DatabaseAdapter): Promise<void> {
  const legacy: Record<string, number> = {
    blood_group: 2,
    rh_factor: 3,
    hbsag_result: 10,
    vdrl_result: 10,
    hiv_result: 10,
    ogtt_result: 10,
    urine_protein: 10,
    urine_glucose: 10,
    urine_ketone: 10,
    urine_culture_result: 20,
  };
  for (const t of ANC_RESULT_COLUMN_WIDTHS) {
    await db.execute(
      `ALTER TABLE ${t.table} ALTER COLUMN ${t.column} TYPE VARCHAR(${legacy[t.column]})`,
    );
  }
}

describe('migrateWidenAncResultColumns', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = await createPgliteDb();
  });

  it('widens legacy-width columns and preserves existing data', async () => {
    await narrowToLegacyWidths(db);
    // A pre-existing row with legacy-width values must survive the ALTERs.
    const now = new Date().toISOString();
    const hospitalId = uuidv4();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [hospitalId, '99903', 'รพ.ทดสอบ migration', 'M2', true, 'UNKNOWN', now, now],
    );
    await db.execute(
      `INSERT INTO maternal_journeys
         (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida,
          care_stage, vdrl_result, blood_group, registered_at, stage_changed_at,
          synced_at, created_at, updated_at)
       VALUES (?, ?, ?, 'MIG-1', 'x', 'x', 'x', 30, 1, 'PREGNANCY', 'NR', 'AB', ?, ?, ?, ?, ?)`,
      [uuidv4(), hospitalId, hospitalId, now, now, now, now, now],
    );

    await migrateWidenAncResultColumns(db);

    for (const t of ANC_RESULT_COLUMN_WIDTHS) {
      expect(await width(db, t.table, t.column), `${t.table}.${t.column}`).toBe(t.width);
    }
    const rows = await db.query<{ vdrl_result: string; blood_group: string }>(
      `SELECT vdrl_result, blood_group FROM maternal_journeys WHERE hn = 'MIG-1'`,
    );
    expect(rows[0].vdrl_result).toBe('NR');
    expect(rows[0].blood_group).toBe('AB');

    // The widened column now accepts the real-world value that used to throw.
    await db.execute(
      `UPDATE maternal_journeys SET vdrl_result = 'Non-reactive' WHERE hn = 'MIG-1'`,
    );
  });

  it('is idempotent — second run performs no further changes and does not throw', async () => {
    await narrowToLegacyWidths(db);
    await migrateWidenAncResultColumns(db);
    await migrateWidenAncResultColumns(db);
    for (const t of ANC_RESULT_COLUMN_WIDTHS) {
      expect(await width(db, t.table, t.column)).toBe(t.width);
    }
  });

  it('no-ops on a fresh schema already at target widths', async () => {
    // createPgliteDb builds from the current table definitions (already wide).
    await migrateWidenAncResultColumns(db);
    for (const t of ANC_RESULT_COLUMN_WIDTHS) {
      expect(await width(db, t.table, t.column)).toBe(t.width);
    }
  });
});
