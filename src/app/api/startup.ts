// T059: Startup sequence — DB init, schema sync, seed, start polling
import { getDatabase, closeDatabase, isPgliteEnabled } from '@/db/connection';
import { SchemaSync } from '@/db/schema-sync';
import { validateStartupConfig } from '@/lib/startup-config';
import { migrateAuditLogsActor } from '@/db/migrations/audit-logs-actor';
import { migrateCachedReferralsActor } from '@/db/migrations/cached-referrals-actor';
import { migrateMaternalJourneysActiveUnique } from '@/db/migrations/maternal-journeys-active-unique';
import { migrateVideoCallParticipantsUnique } from '@/db/migrations/video-call-participants-unique';
import { migrateVideoCallsGroupModel } from '@/db/migrations/video-calls-group';
import { migrateWidenAncResultColumns } from '@/db/migrations/widen-anc-result-columns';
import { ALL_TABLES } from '@/db/tables/index';
import { SeedOrchestrator } from '@/db/seeds/index';
import { SseManager } from '@/lib/sse';
import { stopPolling } from '@/services/sync';
import {
  scheduleAuditLogRetention,
  stopAuditLogRetentionSchedule,
} from '@/services/audit-retention';
import { backfillActiveConsultDoctorPrefs } from '@/services/notification-preference';
import { logger } from '@/lib/logger';

// HMR- and bundle-safe init flag (pair with ensure-init.ts singleton).
interface InitFlag {
  done: boolean;
}
const _global = global as unknown as { __initFlag?: InitFlag };
const _flag: InitFlag = _global.__initFlag ?? { done: false };
if (!_global.__initFlag) _global.__initFlag = _flag;

export async function initializeApp(): Promise<void> {
  if (_flag.done) return;

  try {
    const startTime = Date.now();
    logger.info('initialization_started', {});

    // 0. Config validation — an invalid deployment must fail before any DB
    // connection or clinical ingest (readiness stays 503 via ensureInit).
    validateStartupConfig();

    // 1. Connect to database
    const db = await getDatabase();
    logger.info('database_connected', { driver: 'postgresql' });

    // 1a. Rename the 1:1-era video_calls table aside so SchemaSync can create
    // the group-model header + participants tables under the original name.
    // Must run BEFORE the sync — SchemaSync only ADDs columns and would
    // otherwise bolt group columns onto the old shape.
    await migrateVideoCallsGroupModel(db);

    // 2. Sync schema
    await SchemaSync.sync(db, ALL_TABLES, 'postgresql');
    logger.info('schema_synced', { tableCount: ALL_TABLES.length });

    // 2a. One-shot idempotent migration: drop the legacy audit_logs → users(id)
    // FK + NOT NULL on user_id. SchemaSync only ADD COLUMNs, so this ALTER can't
    // live in the table definition. Without it every audit write for a
    // BMS-session actor keeps failing audit_logs_user_id_fkey.
    await migrateAuditLogsActor(db);

    // 2a-1. One-shot idempotent migration: drop the legacy cached_referrals →
    // users(id) FKs on initiated_by/accepted_by. Same rationale as the
    // audit_logs actor migration above — BMS/ProviderID sessions have no
    // users row, so a hard FK made every referral create/accept fail
    // cached_referrals_initiated_by_fkey / _accepted_by_fkey.
    await migrateCachedReferralsActor(db);

    // 2a-2. One-shot idempotent migration: partial unique index guaranteeing a
    // single active journey per hospital+hn (fails safe on dirty data).
    await migrateMaternalJourneysActiveUnique(db);

    // 2a-3. One-shot idempotent migration: dedupe (keep newest) then unique
    // index on video_call_participants (call_id, user_id) — the old racy
    // SELECT-then-INSERT ring logic could leave duplicate rows. Backs
    // persistRingRows' ON CONFLICT DO UPDATE (fresh DBs get the index
    // directly from the table definition via SchemaSync above).
    await migrateVideoCallParticipantsUnique(db);

    // 2a-4. One-shot idempotent migration: widen ANC lab/urine result columns
    // to fit real HOSxP free text ("Non-reactive" > VARCHAR(10)) — an
    // over-long value aborted a hospital's whole ANC bundle every sync.
    // SchemaSync never ALTERs existing columns; fresh DBs get the new widths
    // from the table definitions directly.
    await migrateWidenAncResultColumns(db);

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

    // 2c. P1-D rollout backfill (notification opt-in): Default-OFF would make
    // every currently-configured consult doctor go silent on deploy. Seed an
    // enabled preference row for each ACTIVE consult doctor now (idempotent —
    // ON CONFLICT DO NOTHING never clobbers a user's later opt-out; re-runs
    // don't duplicate). Center monitors excluded (admin list is authoritative).
    try {
      const optInBackfilled = await backfillActiveConsultDoctorPrefs(db);
      if (optInBackfilled > 0) {
        logger.info('notification_prefs_consult_doctor_backfilled', {
          inserted: optInBackfilled,
        });
      }
    } catch (error) {
      // Fail-safe: a backfill failure must not block app startup.
      logger.warn('notification_prefs_backfill_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 3. Run seeders
    const seedOrchestrator = new SeedOrchestrator();
    await seedOrchestrator.run(db);
    logger.info('seeders_completed', {});

    // 4. Seed demo data in pglite dev mode (opt-in via SEED_DEMO_DATA=true)
    if (
      isPgliteEnabled() &&
      process.env.NODE_ENV !== 'test' &&
      process.env.SEED_DEMO_DATA === 'true'
    ) {
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

    // 6. Audit log retention (operator-requested 2026-07-17): production
    //    audit_logs reached 1.8GB / 4.3M rows with no retention policy.
    //    scheduleAuditLogRetention fires the first batched purge a few
    //    seconds from now (NOT awaited — a 4.3M-row backlog could take
    //    minutes and must not delay this ~700ms startup path) and re-runs
    //    it daily for the life of the process. Window is configurable via
    //    AUDIT_LOG_RETENTION_DAYS (default 30 days); see
    //    src/services/audit-retention.ts. Gated off in tests the same way
    //    HOSxP polling is above — a background timer has no place in a unit
    //    test process.
    if (process.env.NODE_ENV !== 'test') {
      scheduleAuditLogRetention(db);
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
  stopAuditLogRetentionSchedule();
  await closeDatabase();
  SseManager.getInstance().destroy();
  _flag.done = false;
  logger.info('shutdown_completed', {});
}
