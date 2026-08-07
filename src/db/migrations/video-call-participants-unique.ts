// One-shot idempotent migration for Release C task C2.
//
// video_call_participants had no unique (call_id, user_id) constraint, so
// the old ringCandidates SELECT-then-INSERT could race two INSERTs for the
// same person on the same call. Participant rows are ephemeral operational
// state, not clinical data — safe to dedupe here, unlike
// maternal-journeys-active-unique which fails safe on dirty data.
import type { DatabaseAdapter } from '@/db/adapter';
import { logger } from '@/lib/logger';

export async function migrateVideoCallParticipantsUnique(db: DatabaseAdapter): Promise<void> {
  const tables = await db.getTableNames();
  if (!tables.includes('video_call_participants')) return;

  await db.execute(
    `DELETE FROM video_call_participants a
      USING video_call_participants b
      WHERE a.call_id = b.call_id AND a.user_id = b.user_id
        AND (a.invited_at < b.invited_at OR (a.invited_at = b.invited_at AND a.id < b.id))`,
  );
  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_vcp_call_user
       ON video_call_participants (call_id, user_id)`,
  );
  logger.info('vcp_unique_index_migrated', {});
}
