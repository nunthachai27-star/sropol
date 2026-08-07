// Shared PGlite test database — the standard harness for unit/service tests.
//
// Replaces the `new SqliteAdapter(':memory:')` pattern so tests exercise the
// real PostgreSQL dialect (TIMESTAMPTZ → Date, NUMERIC → number via the
// createPglite parser parity, JSONB, $N placeholders) that production uses.
//
// PGlite WASM boot + schema sync costs ~2-3s, so this module keeps ONE
// instance for the whole test file (vitest isolates files in separate
// workers, so module state never leaks across files). Each createTestDb()
// call resets state by truncating every table EXCEPT the static thai-geo
// lookups (~10k rows, seeded once, never mutated by tests) — that keeps
// SeedOrchestrator reseeds down to the 26 KK hospitals + admin user.
//
// Usage (typically in beforeEach):
//   db = await createTestDb();
//   await new SeedOrchestrator().run(db);   // if the test needs seed data
//
// `close()` on the returned adapter is a no-op: the instance is shared, and
// legacy afterEach(() => db.close()) blocks must not kill it mid-file.
//
// Tests that MUTATE SCHEMA (ALTER TABLE, DROP CONSTRAINT — e.g. migration
// tests) must use createPgliteDb() instead: truncation does not undo DDL.

import type { PGlite } from '@electric-sql/pglite';
import { PgliteAdapter, createPglite } from '@/db/pglite-adapter';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables/index';

const STATIC_LOOKUP_TABLES = new Set(['provinces', 'districts', 'tambons', 'moph_hospitals']);

class SharedPgliteAdapter extends PgliteAdapter {
  constructor(pg: PGlite) {
    super(pg);
  }

  // No-op: the underlying PGlite is shared across every test in the file.
  // The vitest worker process teardown reclaims the WASM instance.
  async close(): Promise<void> {}
}

let shared: SharedPgliteAdapter | null = null;

export async function createTestDb(): Promise<PgliteAdapter> {
  if (!shared) {
    shared = new SharedPgliteAdapter(createPglite());
    await SchemaSync.sync(shared, ALL_TABLES, 'postgresql');
    return shared;
  }
  // Fresh table list each reset: tests may have synced extra tables lazily
  // (e.g. hospital_consult_doctors) and those need wiping too.
  const tables = (await shared.getTableNames()).filter((t) => !STATIC_LOOKUP_TABLES.has(t));
  if (tables.length > 0) {
    await shared.execute(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} CASCADE`);
  }
  return shared;
}
