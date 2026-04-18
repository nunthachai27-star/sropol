// T059: Startup sequence — DB init, schema sync, seed, start polling
import { getDatabase, closeDatabase, isSqliteEnabled } from '@/db/connection';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables/index';
import { SeedOrchestrator } from '@/db/seeds/index';
import { SseManager } from '@/lib/sse';
import { startPolling, stopPolling } from '@/services/sync';
import { logger } from '@/lib/logger';

let initialized = false;

export async function initializeApp(): Promise<void> {
  if (initialized) return;

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

    // 3. Run seeders
    const seedOrchestrator = new SeedOrchestrator();
    await seedOrchestrator.run(db);
    logger.info('seeders_completed', {});

    // 4. Seed demo data in dev mode with SQLite (opt-in via SEED_DEMO_DATA=true)
    if (isSqliteEnabled() && process.env.NODE_ENV !== 'test' && process.env.SEED_DEMO_DATA === 'true') {
      const { seedDemoData } = await import('@/db/seeds/demo-seeder');
      await seedDemoData(db);
    }

    // 5. Start polling (if not in test mode — works with both SQLite and PostgreSQL)
    if (process.env.NODE_ENV !== 'test') {
      const sseManager = SseManager.getInstance();
      await startPolling(db, sseManager);
      logger.info('hosxp_polling_started', {});
    }

    initialized = true;
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
  initialized = false;
  logger.info('shutdown_completed', {});
}
