import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';

// Unified group-call model: video_calls is a slim call header and
// video_call_participants tracks each person's own lifecycle. A 1:1 call is
// just a group call with one invitee. Room ids stay unguessable UUIDs — the
// only access control on the anonymous-join Jitsi server.
describe('video_calls header table', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('is created by schema sync together with video_call_participants', async () => {
    const tables = await db.getTableNames();
    expect(tables).toContain('video_calls');
    expect(tables).toContain('video_call_participants');
  });

  it('has creator snapshot, room id, active/ended lifecycle', async () => {
    const columns = await db.getColumnInfo('video_calls');
    const byName = new Map(columns.map((c) => [c.name, c]));

    for (const required of [
      'id',
      'room_id',
      'created_by_user_id',
      'created_by_name',
      'created_by_hospital_code',
      'status',
      'created_at',
      'ended_at',
    ]) {
      expect(byName.has(required), `missing header column ${required}`).toBe(true);
    }
    expect(byName.get('ended_at')?.nullable).toBe(true);
    expect(byName.get('status')?.nullable).toBe(false);
    // The 1:1-era per-callee columns live on the header no more.
    expect(byName.has('callee_user_id')).toBe(false);
    expect(byName.has('caller_user_id')).toBe(false);
  });

  it('participants carry identity snapshot, role, per-person lifecycle timestamps', async () => {
    const columns = await db.getColumnInfo('video_call_participants');
    const byName = new Map(columns.map((c) => [c.name, c]));

    for (const required of [
      'id',
      'call_id',
      'user_id',
      'name',
      'hospital_code',
      'hospital_name',
      'role',
      'status',
      'invited_by_user_id',
      'invited_at',
      'joined_at',
      'left_at',
      'last_seen_at',
    ]) {
      expect(byName.has(required), `missing participant column ${required}`).toBe(true);
    }
    expect(byName.get('joined_at')?.nullable).toBe(true);
    expect(byName.get('left_at')?.nullable).toBe(true);
    expect(byName.get('status')?.nullable).toBe(false);
  });

  it('stores a header + creator/invitee participants round-trip', async () => {
    await db.execute(
      `INSERT INTO video_calls
         (id, room_id, created_by_user_id, created_by_name, created_by_hospital_code, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', NOW())`,
      [
        '3e0e40f1-1111-4222-8333-444455556666',
        'kklrms-9f8e7d6c-aaaa-4bbb-8ccc-ddddeeee0000',
        'user-caller',
        'พญ.ต้นทาง ทดสอบ',
        '10670',
      ],
    );
    await db.execute(
      `INSERT INTO video_call_participants
         (id, call_id, user_id, name, hospital_code, hospital_name, role, status,
          invited_by_user_id, invited_at, joined_at)
       VALUES
         (?, ?, 'user-caller', 'พญ.ต้นทาง ทดสอบ', '10670', 'รพ.ขอนแก่น', 'creator', 'joined',
          'user-caller', NOW(), NOW()),
         (?, ?, 'user-callee', 'นพ.ปลายทาง ทดสอบ', '11004', 'รพ.น้ำพอง', 'invitee', 'ringing',
          'user-caller', NOW(), NULL)`,
      [
        'aaaaaaaa-0000-4000-8000-000000000001',
        '3e0e40f1-1111-4222-8333-444455556666',
        'aaaaaaaa-0000-4000-8000-000000000002',
        '3e0e40f1-1111-4222-8333-444455556666',
      ],
    );

    const participants = await db.query<{ role: string; status: string; joined_at: Date | null }>(
      'SELECT role, status, joined_at FROM video_call_participants WHERE call_id = ? ORDER BY role',
      ['3e0e40f1-1111-4222-8333-444455556666'],
    );
    expect(participants).toHaveLength(2);
    expect(participants[0].role).toBe('creator');
    expect(participants[0].status).toBe('joined');
    expect(participants[1].role).toBe('invitee');
    expect(participants[1].status).toBe('ringing');
    expect(participants[1].joined_at).toBeNull();
  });
});
