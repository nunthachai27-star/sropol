// Migration: 1:1-era video_calls (caller/callee columns) → renamed to
// video_calls_legacy_v1 so SchemaSync can create the group-model tables under
// the original name. Runs BEFORE SchemaSync.sync in startup.
import { describe, it, expect, beforeEach } from 'vitest';
import { PgliteAdapter, createPglite } from '@/db/pglite-adapter';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables/index';
import { migrateVideoCallsGroupModel } from '@/db/migrations/video-calls-group';

const LEGACY_DDL = `
  CREATE TABLE video_calls (
    id UUID PRIMARY KEY,
    room_id VARCHAR(64) NOT NULL,
    caller_user_id VARCHAR(255) NOT NULL,
    caller_name VARCHAR(255) NOT NULL,
    caller_hospital_code VARCHAR(9) NOT NULL,
    callee_user_id VARCHAR(255) NOT NULL,
    callee_name VARCHAR(255) NOT NULL,
    callee_hospital_code VARCHAR(9) NOT NULL,
    status VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    answered_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ
  )`;

const LEGACY_INDEXES = [
  'CREATE INDEX idx_vc_callee_user ON video_calls (callee_user_id)',
  'CREATE INDEX idx_vc_caller_user ON video_calls (caller_user_id)',
  'CREATE INDEX idx_vc_status ON video_calls (status)',
  'CREATE INDEX idx_vc_created_at ON video_calls (created_at)',
];

describe('migrateVideoCallsGroupModel', () => {
  let db: PgliteAdapter;

  beforeEach(() => {
    // Fresh instance: this suite mutates DDL, so the shared harness is unsafe.
    db = new PgliteAdapter(createPglite());
  });

  it('renames the 1:1-shaped table to video_calls_legacy_v1 and preserves its rows', async () => {
    await db.execute(LEGACY_DDL);
    for (const ddl of LEGACY_INDEXES) await db.execute(ddl);
    await db.execute(
      `INSERT INTO video_calls
         (id, room_id, caller_user_id, caller_name, caller_hospital_code,
          callee_user_id, callee_name, callee_hospital_code, status, created_at)
       VALUES ('3e0e40f1-1111-4222-8333-444455556666', 'kklrms-legacy-room',
               'user-caller', 'พญ.ต้นทาง ทดสอบ', '10670',
               'user-callee', 'นพ.ปลายทาง ทดสอบ', '11004', 'ended', NOW())`,
    );

    await migrateVideoCallsGroupModel(db);

    const tables = await db.getTableNames();
    expect(tables).toContain('video_calls_legacy_v1');
    expect(tables).not.toContain('video_calls');

    const legacyRows = await db.query<{ room_id: string }>(
      'SELECT room_id FROM video_calls_legacy_v1',
    );
    expect(legacyRows).toHaveLength(1);
    expect(legacyRows[0].room_id).toBe('kklrms-legacy-room');
  });

  it('lets SchemaSync create the group-model tables afterwards (index names free)', async () => {
    await db.execute(LEGACY_DDL);
    for (const ddl of LEGACY_INDEXES) await db.execute(ddl);

    await migrateVideoCallsGroupModel(db);
    await SchemaSync.sync(db, ALL_TABLES, 'postgresql');

    const headerCols = new Set((await db.getColumnInfo('video_calls')).map((c) => c.name));
    expect(headerCols.has('created_by_user_id')).toBe(true);
    expect(headerCols.has('callee_user_id')).toBe(false);
    expect(await db.getTableNames()).toContain('video_call_participants');
  });

  it('is idempotent: no-op on the new shape and on a blank database', async () => {
    // Blank database — nothing to migrate.
    await migrateVideoCallsGroupModel(db);
    expect(await db.getTableNames()).not.toContain('video_calls_legacy_v1');

    // New shape — must not rename again.
    await SchemaSync.sync(db, ALL_TABLES, 'postgresql');
    await migrateVideoCallsGroupModel(db);
    const tables = await db.getTableNames();
    expect(tables).toContain('video_calls');
    expect(tables).not.toContain('video_calls_legacy_v1');
  });
});
