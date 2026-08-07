// Release C task C2 — unique (call_id, user_id) migration for
// video_call_participants. Dedupes pre-existing race artifacts from the old
// SELECT-then-INSERT ringCandidates before creating the index that
// persistRingRows' ON CONFLICT now relies on.
import { describe, it, expect } from 'vitest';
import { createPgliteDb } from '../../helpers/createPgliteDb';
import { migrateVideoCallParticipantsUnique } from '@/db/migrations/video-call-participants-unique';

const CALL_ID = '11111111-1111-4111-8111-111111111111';
const P_OLD = '22222222-2222-4222-8222-222222222222';
const P_NEW = '33333333-3333-4333-8333-333333333333';

describe('migrateVideoCallParticipantsUnique', () => {
  it('dedupes (keeping the newest) then creates the unique index, idempotently', async () => {
    const db = await createPgliteDb();
    // The table definition also ships uq_vcp_call_user so fresh databases
    // (createTestDb's ON CONFLICT-dependent service tests) have it from
    // SchemaSync — createPgliteDb() picks that up too. Drop it here to
    // reproduce the actual pre-migration production shape, where duplicate
    // (call_id, user_id) rows can still exist from the old racy
    // SELECT-then-INSERT ringCandidates.
    await db.execute(`DROP INDEX IF EXISTS uq_vcp_call_user`);

    await db.execute(
      `INSERT INTO video_calls (id, room_id, created_by_user_id, created_by_name, created_by_hospital_code, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', NOW())`,
      [CALL_ID, 'room-1', 'u-creator', 'ผู้สร้าง', '10670'],
    );
    // two rows for the same (call, user) — the pre-index race artifact
    await db.execute(
      `INSERT INTO video_call_participants (id, call_id, user_id, name, hospital_code, hospital_name, role, status, invited_by_user_id, invited_at)
       VALUES (?, ?, 'u-dup', 'ซ้ำ', '10670', 'รพ.', 'invitee', 'ringing', 'u-creator', ?)`,
      [P_OLD, CALL_ID, '2026-07-13T00:00:00Z'],
    );
    await db.execute(
      `INSERT INTO video_call_participants (id, call_id, user_id, name, hospital_code, hospital_name, role, status, invited_by_user_id, invited_at)
       VALUES (?, ?, 'u-dup', 'ซ้ำ', '10670', 'รพ.', 'invitee', 'ringing', 'u-creator', ?)`,
      [P_NEW, CALL_ID, '2026-07-13T01:00:00Z'],
    );

    await migrateVideoCallParticipantsUnique(db);
    await migrateVideoCallParticipantsUnique(db); // idempotent

    const rows = await db.query<{ id: string }>(
      `SELECT id FROM video_call_participants WHERE call_id = ? AND user_id = 'u-dup'`,
      [CALL_ID],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(P_NEW);
    const idx = await db.query(
      `SELECT indexname FROM pg_indexes WHERE indexname = 'uq_vcp_call_user'`,
    );
    expect(idx.length).toBe(1);
    await db.close();
  });
});
