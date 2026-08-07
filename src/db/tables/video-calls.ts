// Video-call header (unified group model): one row per call. Who is in the
// call — and each person's own ring/join/leave lifecycle — lives in
// video_call_participants; a 1:1 call is simply a call with one invitee.
// room_id is an unguessable UUID — the only access control on the
// anonymous-join Jitsi server — so rows must never leak to non-participants.
// The 1:1-era shape of this table is preserved as video_calls_legacy_v1 by
// src/db/migrations/video-calls-group.ts.
import type { TableDefinition } from '../table-definition';

export const videoCallsTable: TableDefinition = {
  name: 'video_calls',
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'room_id', type: 'string', maxLength: 64 },
    { name: 'created_by_user_id', type: 'string', maxLength: 255 },
    { name: 'created_by_name', type: 'string', maxLength: 255 },
    { name: 'created_by_hospital_code', type: 'string', maxLength: 9 },
    // active → ended (a call ends when the last joined participant leaves)
    { name: 'status', type: 'string', maxLength: 16 },
    { name: 'created_at', type: 'datetime' },
    { name: 'ended_at', type: 'datetime', nullable: true },
  ],
  indexes: [
    { name: 'idx_vch_status', columns: ['status'] },
    { name: 'idx_vch_created_at', columns: ['created_at'] },
  ],
};
