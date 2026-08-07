// TDD for the MOPH alert tables (moph_alert_log + moph_center_monitors).
// Verifies both tables sync cleanly under PGlite (parity with prod Postgres)
// and that the idempotency unique index enforces dedup (codex #5).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PgliteAdapter, createPglite } from '@/db/pglite-adapter';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables/index';
import { randomUUID } from 'node:crypto';

describe('moph_alert_log + moph_center_monitors tables', () => {
  let db: PgliteAdapter;

  beforeEach(async () => {
    db = new PgliteAdapter(createPglite());
    await SchemaSync.sync(db, ALL_TABLES, 'postgresql');
    // moph_alert_log.hospital_id FKs hospitals — seed one hospital row.
    await db.query(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, created_at, updated_at)
       VALUES ($1, '10682', 'รพ.ขอนแก่น', 'P_PLUS', true, NOW(), NOW())`,
      [randomUUID()],
    );
  });
  afterEach(async () => {
    await db.close();
  });

  it('creates both tables with the expected columns', async () => {
    const logCols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'moph_alert_log' ORDER BY column_name`,
    );
    const logNames = logCols.map((c) => c.column_name);
    for (const col of [
      'id',
      'case_id',
      'hospital_id',
      'origin_hcode',
      'recipient_cid',
      'recipient_scope',
      'alert_source',
      'severity',
      'rule_id',
      'title',
      'status',
      'message_id',
      'api_status',
      'attempts',
      'last_error',
      'confirm_url',
      'local_date',
      'sent_at',
      'created_at',
      'updated_at',
    ]) {
      expect(logNames).toContain(col);
    }

    const monCols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'moph_center_monitors' ORDER BY column_name`,
    );
    const monNames = monCols.map((c) => c.column_name);
    for (const col of [
      'id',
      'province',
      'cid',
      'name',
      'position',
      'is_active',
      'created_at',
      'updated_at',
    ]) {
      expect(monNames).toContain(col);
    }
  });

  it('inserts a pending alert row and reads it back', async () => {
    const hospitalId = (await db.query<{ id: string }>(`SELECT id FROM hospitals LIMIT 1`))[0].id;
    const id = randomUUID();
    await db.query(
      `INSERT INTO moph_alert_log
       (id, case_id, hospital_id, origin_hcode, recipient_cid, recipient_scope,
        alert_source, severity, rule_id, title, status, attempts, local_date,
        created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())`,
      [
        id,
        'case-1',
        hospitalId,
        '10682',
        '3320500282121',
        'hospital_staff',
        'anc_cpd',
        'high',
        'cpd_high',
        'แจ้งเตือน',
        'pending',
        0,
        '2026-07-26',
      ],
    );
    const rows = await db.query<{ status: string; recipient_cid: string }>(
      `SELECT status, recipient_cid FROM moph_alert_log WHERE id = $1`,
      [id],
    );
    expect(rows[0].status).toBe('pending');
    expect(rows[0].recipient_cid).toBe('3320500282121');
  });

  it('enforces the dedup unique index — duplicate key same day is rejected', async () => {
    const hospitalId = (await db.query<{ id: string }>(`SELECT id FROM hospitals LIMIT 1`))[0].id;
    const base = [
      randomUUID(),
      'case-dup',
      hospitalId,
      '10682',
      '3320500282121',
      'hospital_staff',
      'anc_cpd',
      'high',
      'cpd_high',
      'แจ้งเตือน',
      'pending',
      0,
      '2026-07-26',
    ];
    await db.query(
      `INSERT INTO moph_alert_log
       (id, case_id, hospital_id, origin_hcode, recipient_cid, recipient_scope,
        alert_source, severity, rule_id, title, status, attempts, local_date,
        created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())`,
      base,
    );
    // Same dedup key, new id → must violate the unique index.
    await expect(
      db.query(
        `INSERT INTO moph_alert_log
         (id, case_id, hospital_id, origin_hcode, recipient_cid, recipient_scope,
          alert_source, severity, rule_id, title, status, attempts, local_date,
          created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())`,
        [randomUUID(), ...base.slice(1)],
      ),
    ).rejects.toThrow();
  });

  it('allows distinct rule_id on the same case (distinct emergencies co-fire)', async () => {
    const hospitalId = (await db.query<{ id: string }>(`SELECT id FROM hospitals LIMIT 1`))[0].id;
    const common = [
      'case-multi',
      hospitalId,
      '10682',
      '3320500282121',
      'hospital_staff',
      'maternal_triage',
      'emergency',
    ];
    for (const ruleId of ['emerg_hemorrhage', 'emerg_preeclampsia']) {
      await db.query(
        `INSERT INTO moph_alert_log
         (id, case_id, hospital_id, origin_hcode, recipient_cid, recipient_scope,
          alert_source, severity, rule_id, title, status, attempts, local_date,
          created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())`,
        [randomUUID(), ...common, ruleId, 'แจ้งเตือนฉุกเฉิน', 'pending', 0, '2026-07-26'],
      );
    }
    const rows = await db.query<{ rule_id: string }>(
      `SELECT rule_id FROM moph_alert_log WHERE case_id = 'case-multi' ORDER BY rule_id`,
    );
    expect(rows.map((r) => r.rule_id)).toEqual(['emerg_hemorrhage', 'emerg_preeclampsia']);
  });

  it('moph_center_monitors enforces unique (province, cid)', async () => {
    await db.query(
      `INSERT INTO moph_center_monitors (id, province, cid, name, is_active, created_at, updated_at)
       VALUES ($1,'30','3320500282121','ศูนย์กลาง ขก.',true,NOW(),NOW())`,
      [randomUUID()],
    );
    await expect(
      db.query(
        `INSERT INTO moph_center_monitors (id, province, cid, name, is_active, created_at, updated_at)
         VALUES ($1,'30','3320500282121','ซ้ำ',true,NOW(),NOW())`,
        [randomUUID()],
      ),
    ).rejects.toThrow();
  });
});
