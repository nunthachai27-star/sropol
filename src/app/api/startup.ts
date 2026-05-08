// T059: Startup sequence — DB init, schema sync, seed, start polling
import { getDatabase, closeDatabase, isSqliteEnabled } from '@/db/connection';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables/index';
import { SeedOrchestrator } from '@/db/seeds/index';
import { SseManager } from '@/lib/sse';
import { stopPolling } from '@/services/sync';
import { logger } from '@/lib/logger';

// HMR- and bundle-safe init flag (pair with ensure-init.ts singleton).
interface InitFlag { done: boolean }
const _global = global as unknown as { __initFlag?: InitFlag };
const _flag: InitFlag = _global.__initFlag ?? { done: false };
if (!_global.__initFlag) _global.__initFlag = _flag;

export async function initializeApp(): Promise<void> {
  if (_flag.done) return;

  try {
    const startTime = Date.now();
    logger.info('initialization_started', {});

    // 1. Connect to database
    const db = await getDatabase();
    const driver = isSqliteEnabled() ? 'sqlite' : 'postgresql';
    logger.info('database_connected', { driver });

    // 2. Sync schema
    await SchemaSync.sync(db, ALL_TABLES, driver as 'sqlite' | 'postgresql');
    logger.info('schema_synced', { tableCount: ALL_TABLES.length });

    // 2b. One-shot idempotent backfill for cached_anc_visits.hospital_id —
    // the column was added after data already existed; populate from the
    // parent journey's current_hospital_id (best available proxy). Subquery
    // syntax works on both SQLite and PostgreSQL.
    const beforeBackfill = await db.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM cached_anc_visits WHERE hospital_id IS NULL`,
    );
    await db.execute(
      `UPDATE cached_anc_visits
          SET hospital_id = (
            SELECT mj.current_hospital_id FROM maternal_journeys mj
             WHERE mj.id = cached_anc_visits.journey_id
          )
        WHERE hospital_id IS NULL`,
    );
    logger.info('cached_anc_visits_hospital_backfilled', {
      pendingBefore: Number(beforeBackfill[0]?.count ?? 0),
    });

    // 3. Run seeders
    const seedOrchestrator = new SeedOrchestrator();
    await seedOrchestrator.run(db);
    logger.info('seeders_completed', {});

    // 4. Seed demo data in dev mode with SQLite (opt-in via SEED_DEMO_DATA=true)
    if (isSqliteEnabled() && process.env.NODE_ENV !== 'test' && process.env.SEED_DEMO_DATA === 'true') {
      const { seedDemoData } = await import('@/db/seeds/demo-seeder');
      await seedDemoData(db);
    }

    // 5. Server-side scheduled polling is DISABLED. Pulls now happen in the
    //    user's browser via the local 127.0.0.1:45011 HOSxP gateway and are
    //    POSTed to /api/sync/browser-push. The webhook receiver
    //    (/api/webhooks/patient-data) still handles HOSxP-pushed data.
    //    See useBrowserPoll + browser-poll.ts.
    if (process.env.NODE_ENV !== 'test') {
      logger.info('hosxp_polling_disabled_browser_only_mode', {});
    }

    _flag.done = true;
    const elapsed = Date.now() - startTime;
    logger.info('initialization_completed', { elapsedMs: elapsed });
  } catch (error) {
    logger.error('initialization_failed', { error });
    throw error;
  }
}

export async function shutdownApp(): Promise<void> {
  logger.info('shutdown_started', {});
  stopPolling();
  await closeDatabase();
  SseManager.getInstance().destroy();
  _flag.done = false;
  logger.info('shutdown_completed', {});
}
