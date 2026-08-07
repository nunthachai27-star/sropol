// T023: Connection factory — environment-based routing.
//
// Every adapter speaks the PostgreSQL dialect: PostgresAdapter (pg.Pool)
// in production, embedded pglite (@electric-sql/pglite) for dev mode and
// tests. The SQLite driver was removed — its dialect differences (TEXT
// dates, INTEGER booleans, string NUMERIC) kept masking production-only
// bugs in the test suite.

import type { DatabaseAdapter } from './adapter';
import { logger } from '@/lib/logger';

// HMR- and bundle-safe singleton. In Next.js dev, route handlers are bundled
// separately and modules reload on HMR, so a plain `let instance` can produce
// multiple DB adapters in the same process — e.g. the orchestrator's INSERTs
// go into one PgliteAdapter's WASM VM while the webhook route's SELECT runs
// against a different one. Writes become invisible to reads. Pinning on
// `global` gives one adapter per Node process regardless of bundle or HMR
// (matches the pattern already used for __pgliteLock and __simApiKeyCache).
interface DbSingleton {
  promise: Promise<DatabaseAdapter> | null;
}
const _global = global as unknown as { __dbSingleton?: DbSingleton };
const _singleton: DbSingleton = _global.__dbSingleton ?? { promise: null };
if (!_global.__dbSingleton) _global.__dbSingleton = _singleton;

// In-process Postgres dev mode via @electric-sql/pglite. Useful when you
// want real Postgres dialect without standing up a server. Persists to a
// local directory so data survives restarts.
export function isPgliteEnabled(): boolean {
  return process.env.USE_PGLITE === 'true';
}

// Schema dialect for whichever adapter getDatabase() will pick. Constant
// since the SQLite driver was removed, but kept as a function so schema-sync
// call sites stay explicit about where the dialect comes from.
export function getDriverType(): 'postgresql' {
  return 'postgresql';
}

export async function getDatabase(): Promise<DatabaseAdapter> {
  if (!_singleton.promise) {
    // Memoize the IN-FLIGHT promise (not just the resolved instance) so
    // concurrent cold-start callers await one construction instead of each
    // racing an adapter into existence across the `await import(...)`
    // suspension (last writer wins, losers leak). Clear on rejection so a
    // later call can retry — same pattern as src/lib/ensure-init.ts.
    _singleton.promise = createAdapter().catch((error) => {
      _singleton.promise = null;
      throw error;
    });
  }
  return _singleton.promise;
}

async function createAdapter(): Promise<DatabaseAdapter> {
  if (isPgliteEnabled()) {
    const { PgliteAdapter, createPglite } = await import('./pglite-adapter');
    const path = process.env.PGLITE_PATH ?? './.pglite-data';
    if (process.env.NODE_ENV !== 'test') {
      logger.info('pglite_connected', { path });
    }
    return new PgliteAdapter(createPglite(path));
  }
  if (process.env.NODE_ENV === 'test') {
    // Tests get an in-memory pglite so they never require a running server.
    // Most suites use tests/helpers/testDb.ts directly; this path covers
    // code that reaches getDatabase() itself.
    const { PgliteAdapter, createPglite } = await import('./pglite-adapter');
    return new PgliteAdapter(createPglite());
  }
  const { PostgresAdapter } = await import('./postgres-adapter');
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  return new PostgresAdapter(url);
}

export async function closeDatabase(): Promise<void> {
  const pending = _singleton.promise;
  _singleton.promise = null;
  if (!pending) return;
  try {
    const instance = await pending;
    await instance.close();
  } catch {
    // initialization had failed — nothing to close
  }
}

// For testing: reset the singleton
export function resetDatabaseInstance(): void {
  _singleton.promise = null;
}
