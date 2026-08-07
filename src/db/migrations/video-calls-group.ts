// One-shot idempotent migration for the unified group-call model.
//
// The first video-call release (2026-07-10, commit 0eca295) shaped
// video_calls with caller_*/callee_* columns for 1:1 calls. The group model
// replaces that with a slim header + video_call_participants. SchemaSync can
// only ADD columns, so the old table is renamed aside and SchemaSync creates
// the new tables under the original name. MUST run BEFORE SchemaSync.sync.
//
// The old rows (hours of 1:1 history) stay queryable in video_calls_legacy_v1;
// its idx_vc_* indexes are dropped so the names cannot shadow anything.
import type { DatabaseAdapter } from '@/db/adapter';
import { logger } from '@/lib/logger';

const LEGACY_MARKER_COLUMN = 'callee_user_id';
const LEGACY_INDEXES = [
  'idx_vc_callee_user',
  'idx_vc_caller_user',
  'idx_vc_status',
  'idx_vc_created_at',
];

export async function migrateVideoCallsGroupModel(db: DatabaseAdapter): Promise<void> {
  const tables = await db.getTableNames();
  if (!tables.includes('video_calls')) return; // fresh database — nothing to migrate

  const columns = await db.getColumnInfo('video_calls');
  const isLegacyShape = columns.some((column) => column.name === LEGACY_MARKER_COLUMN);
  if (!isLegacyShape) return; // already the group-model header — no-op

  for (const index of LEGACY_INDEXES) {
    await db.execute(`DROP INDEX IF EXISTS ${index}`);
  }
  await db.execute('ALTER TABLE video_calls RENAME TO video_calls_legacy_v1');
  logger.info('video_calls_group_migrated', { legacyTable: 'video_calls_legacy_v1' });
}
