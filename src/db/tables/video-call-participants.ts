// One row per person per video call. Identity is snapshotted inline
// (audit_logs actor pattern) so call history survives user changes.
//
// Participant lifecycle:
//   creator:  joined → left
//   invitee:  ringing → joined → left
//             ringing → declined | missed | cancelled
// (cancelled = ring revoked because the call ended before they answered)
import type { TableDefinition } from '../table-definition';

export const videoCallParticipantsTable: TableDefinition = {
  name: 'video_call_participants',
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    {
      name: 'call_id',
      type: 'uuid',
      references: { table: 'video_calls', column: 'id' },
    },
    { name: 'user_id', type: 'string', maxLength: 255 },
    { name: 'name', type: 'string', maxLength: 255 },
    { name: 'hospital_code', type: 'string', maxLength: 9 },
    { name: 'hospital_name', type: 'string', maxLength: 255 },
    { name: 'role', type: 'string', maxLength: 16 },
    { name: 'status', type: 'string', maxLength: 16 },
    { name: 'invited_by_user_id', type: 'string', maxLength: 255 },
    { name: 'invited_at', type: 'datetime' },
    { name: 'joined_at', type: 'datetime', nullable: true },
    // Stamps every terminal transition: left, declined, missed, cancelled.
    { name: 'left_at', type: 'datetime', nullable: true },
    // Room liveness: refreshed by getCall (the room page polls every 15 s).
    // The stale-join sweep releases joined rows whose liveness went quiet —
    // presence alone can't tell "left the room" from "browsing the app".
    { name: 'last_seen_at', type: 'datetime', nullable: true },
  ],
  indexes: [
    { name: 'idx_vcp_call', columns: ['call_id'] },
    { name: 'idx_vcp_user_status', columns: ['user_id', 'status'] },
    // Backs persistRingRows' ON CONFLICT (call_id, user_id) DO UPDATE —
    // one ring row per person per call, race-safe. Existing databases get
    // it (after deduping) from migrateVideoCallParticipantsUnique.
    { name: 'uq_vcp_call_user', columns: ['call_id', 'user_id'], unique: true },
  ],
};
