// TDD (Red→Green) for the bounded MOPH alert drain — the ONLY LINE I/O site.
// Pins codex #1 (hybrid drain): pop pending rows, send each within a budget,
// never throw to caller. 502→stay pending+attempts++; 400→terminal failed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PgliteAdapter, createPglite } from '@/db/pglite-adapter';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables/index';
import { randomUUID } from 'node:crypto';
import { generateKey, encrypt } from '@/lib/encryption';
import { drainMophAlerts } from '@/services/moph-alert-drain';

// Drain decrypts patient_name_enc (staff scope) — needs an encryption key.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? generateKey();

// Mock the sender: default success, per-test override via mockSend.
const mockSend = vi.fn();
vi.mock('@/services/moph-prompt', () => ({
  sendMophPrompt: (...args: unknown[]) => mockSend(...args),
  MophPromptError: class extends Error {
    code: string;
    statusCode: number;
    constructor(c: string, m: string, s = 0) {
      super(m);
      this.code = c;
      this.statusCode = s;
    }
  },
}));

// Mock the session resolver so no real tunnel is hit.
const mockResolveSession = vi.fn();
vi.mock('@/lib/bms-session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/bms-session')>('@/lib/bms-session');
  return {
    ...actual,
    resolveSessionIdForHospital: (...args: unknown[]) => mockResolveSession(...args),
  };
});

async function seedPendingRow(
  db: PgliteAdapter,
  hospitalId: string,
  overrides: Partial<{
    recipientCid: string;
    severity: string;
    ruleId: string;
    recipientScope: string;
    alertSource: string;
    patientName: string | null;
  }> = {},
): Promise<string> {
  const id = randomUUID();
  const scope = overrides.recipientScope ?? 'hospital_staff';
  // patient_name_enc only for staff scope (mirrors the orchestrator's PDPA rule).
  const patientName = overrides.patientName ?? (scope === 'hospital_staff' ? 'น.ส. A' : null);
  const patientNameEnc =
    patientName && scope === 'hospital_staff'
      ? encrypt(patientName, process.env.ENCRYPTION_KEY!)
      : null;
  await db.query(
    `INSERT INTO moph_alert_log
       (id, case_id, hospital_id, origin_hcode, hospital_name, recipient_cid, recipient_scope,
        alert_source, severity, rule_id, title, patient_name_enc, status, attempts,
        local_date, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',0,$13,NOW(),NOW())`,
    [
      id,
      overrides.severity === 'emergency' ? 'case-em' : 'case-high',
      hospitalId,
      '10682',
      'รพ.ขอนแก่น',
      overrides.recipientCid ?? '3320500282121',
      scope,
      overrides.alertSource ?? 'anc_hr3',
      overrides.severity ?? 'high',
      overrides.ruleId ?? 'hr3',
      'แจ้งเตือน',
      patientNameEnc,
      '2026-07-26',
    ],
  );
  return id;
}

describe('drainMophAlerts', () => {
  let db: PgliteAdapter;
  let hospitalId: string;

  beforeEach(async () => {
    db = new PgliteAdapter(createPglite());
    await SchemaSync.sync(db, ALL_TABLES, 'postgresql');
    hospitalId = randomUUID();
    await db.query(
      `INSERT INTO hospitals (id, hcode, name, level, province_code, is_active, created_at, updated_at)
       VALUES ($1,'10682','รพ.ขอนแก่น','P_PLUS','30',true,NOW(),NOW())`,
      [hospitalId],
    );
    mockResolveSession.mockResolvedValue('SESS-FRESH');
    mockSend.mockResolvedValue({
      messageId: 'msg-ok',
      line: { success: true, status: 'success' },
    });
  });
  afterEach(async () => {
    await db.close();
    vi.clearAllMocks();
  });

  it('pops pending rows, sends each, marks sent + message_id', async () => {
    const id = await seedPendingRow(db, hospitalId);
    const summary = await drainMophAlerts(db, hospitalId, {
      maxAlerts: 5,
      perSendTimeoutMs: 1000,
      budgetMs: 5000,
    });
    expect(summary.sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const rows = await db.query<{ status: string; message_id: string; api_status: string }>(
      `SELECT status, message_id, api_status FROM moph_alert_log WHERE id = $1`,
      [id],
    );
    expect(rows[0].status).toBe('sent');
    expect(rows[0].message_id).toBe('msg-ok');
    expect(rows[0].api_status).toBe('success');
  });

  it('respects maxAlerts cap — extra rows stay pending', async () => {
    await seedPendingRow(db, hospitalId, { recipientCid: '3320500282121' });
    await seedPendingRow(db, hospitalId, { recipientCid: '3320500282122' });
    await seedPendingRow(db, hospitalId, { recipientCid: '3320500282123' });
    const summary = await drainMophAlerts(db, hospitalId, {
      maxAlerts: 2,
      perSendTimeoutMs: 1000,
      budgetMs: 5000,
    });
    expect(summary.sent).toBe(2);
    expect(mockSend).toHaveBeenCalledTimes(2);
    const pending = await db.query<{ c: number }>(
      `SELECT COUNT(*)::int as c FROM moph_alert_log WHERE status='pending'`,
    );
    expect(pending[0].c).toBe(1);
  });

  it('502 → row stays pending, attempts++, last_error set', async () => {
    const id = await seedPendingRow(db, hospitalId);
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error('502'), { code: 'RETRYABLE_EXHAUSTED', statusCode: 502 }),
    );
    const summary = await drainMophAlerts(db, hospitalId, {
      maxAlerts: 5,
      perSendTimeoutMs: 1000,
      budgetMs: 5000,
    });
    expect(summary.sent).toBe(0);
    expect(summary.retryable).toBe(1);
    const rows = await db.query<{ status: string; attempts: number; last_error: string | null }>(
      `SELECT status, attempts, last_error FROM moph_alert_log WHERE id = $1`,
      [id],
    );
    expect(rows[0].status).toBe('pending');
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].last_error).not.toBeNull();
  });

  it('400 → row marked failed (terminal), not retried', async () => {
    const id = await seedPendingRow(db, hospitalId);
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error('bad cid'), { code: 'CLIENT_ERROR', statusCode: 400 }),
    );
    const summary = await drainMophAlerts(db, hospitalId, {
      maxAlerts: 5,
      perSendTimeoutMs: 1000,
      budgetMs: 5000,
    });
    expect(summary.failed).toBe(1);
    const rows = await db.query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM moph_alert_log WHERE id = $1`,
      [id],
    );
    expect(rows[0].status).toBe('failed');
    expect(rows[0].attempts).toBe(1);
  });

  it('drain failure does not throw to caller (returns summary)', async () => {
    await seedPendingRow(db, hospitalId);
    mockSend.mockRejectedValueOnce(new Error('unexpected'));
    await expect(
      drainMophAlerts(db, hospitalId, { maxAlerts: 5, perSendTimeoutMs: 1000, budgetMs: 5000 }),
    ).resolves.toBeDefined();
  });

  it('re-derives a fresh session via resolveSessionIdForHospital before sending', async () => {
    await seedPendingRow(db, hospitalId);
    await drainMophAlerts(db, hospitalId, { maxAlerts: 5, perSendTimeoutMs: 1000, budgetMs: 5000 });
    expect(mockResolveSession).toHaveBeenCalledWith(expect.anything(), hospitalId);
    // the sender received the fresh session as Bearer
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'SESS-FRESH' }));
  });

  it('no pending rows → no sends, empty summary', async () => {
    const summary = await drainMophAlerts(db, hospitalId, {
      maxAlerts: 5,
      perSendTimeoutMs: 1000,
      budgetMs: 5000,
    });
    expect(summary.sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('staff row: drain decrypts patient_name_enc and passes it to the Flex (codex P1 fix)', async () => {
    await seedPendingRow(db, hospitalId, {
      recipientScope: 'hospital_staff',
      patientName: 'นาง บ',
    });
    await drainMophAlerts(db, hospitalId, { maxAlerts: 5, perSendTimeoutMs: 1000, budgetMs: 5000 });
    // The sender received a flex whose JSON contains the decrypted patient name.
    const call = mockSend.mock.calls[0][0] as { flex: Record<string, unknown> };
    const json = JSON.stringify(call.flex);
    expect(json).toContain('นาง บ');
    expect(json).toContain('รพ.ขอนแก่น'); // hospital_name, not origin_hcode
  });

  it('center row: drain never includes the patient name in the Flex (PDPA)', async () => {
    await seedPendingRow(db, hospitalId, { recipientScope: 'province_center', patientName: null });
    await drainMophAlerts(db, hospitalId, { maxAlerts: 5, perSendTimeoutMs: 1000, budgetMs: 5000 });
    const call = mockSend.mock.calls[0][0] as { flex: Record<string, unknown> };
    expect(JSON.stringify(call.flex)).not.toContain('นาง');
  });

  it('row claiming: a concurrent drain does not double-send the same row (codex P1 race fix)', async () => {
    await seedPendingRow(db, hospitalId, { recipientCid: '3320500282121' });
    // Two drains racing on the same hospital — both should not send the same row.
    // (PGlite serializes, but the claim UPDATE...FOR UPDATE SKIP LOCKED means the
    // second drain sees no pending rows and sends nothing.)
    const [a, b] = await Promise.all([
      drainMophAlerts(db, hospitalId, { maxAlerts: 5, perSendTimeoutMs: 1000, budgetMs: 5000 }),
      drainMophAlerts(db, hospitalId, { maxAlerts: 5, perSendTimeoutMs: 1000, budgetMs: 5000 }),
    ]);
    expect(a.sent + b.sent).toBe(1); // exactly one send, not two
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('recovers a stale processing row (crashed mid-send) back to pending on next drain', async () => {
    const id = await seedPendingRow(db, hospitalId);
    // Simulate a crashed drain: row stuck in processing with an old claimed_at.
    await db.query(
      `UPDATE moph_alert_log SET status='processing', claimed_at = NOW() - interval '1 hour' WHERE id = $1`,
      [id],
    );
    const summary = await drainMophAlerts(db, hospitalId, {
      maxAlerts: 5,
      perSendTimeoutMs: 1000,
      budgetMs: 5000,
    });
    expect(summary.sent).toBe(1); // recovered + sent
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('dead-letters a retryable row after maxAttempts (codex gap-sweep: poison-row starvation)', async () => {
    // Seed a row already at attempts = maxAttempts (so the next failure dead-letters it).
    const id = await seedPendingRow(db, hospitalId);
    await db.query(`UPDATE moph_alert_log SET attempts = 4 WHERE id = $1`, [id]); // max502Retries=4
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error('502'), { code: 'RETRYABLE_EXHAUSTED', statusCode: 502 }),
    );
    const summary = await drainMophAlerts(db, hospitalId, {
      maxAlerts: 5,
      perSendTimeoutMs: 1000,
      budgetMs: 5000,
    });
    expect(summary.failed).toBe(1); // dead-lettered, not retryable
    const rows = await db.query<{ status: string }>(
      `SELECT status FROM moph_alert_log WHERE id = $1`,
      [id],
    );
    expect(rows[0].status).toBe('failed');
  });

  it('budget exhaustion releases un-sent claimed rows back to pending (codex gap-sweep P1)', async () => {
    // Seed 3 rows; budget=0 so the loop releases all claimed rows before any send.
    await seedPendingRow(db, hospitalId, { recipientCid: '3320500282121' });
    await seedPendingRow(db, hospitalId, { recipientCid: '3320500282122' });
    await seedPendingRow(db, hospitalId, { recipientCid: '3320500282123' });
    const summary = await drainMophAlerts(db, hospitalId, {
      maxAlerts: 5,
      perSendTimeoutMs: 1000,
      budgetMs: 0,
    });
    expect(summary.sent).toBe(0);
    // The un-sent claimed rows must be back to pending (not stuck in processing).
    const stuck = await db.query<{ c: number }>(
      `SELECT COUNT(*)::int as c FROM moph_alert_log WHERE status = 'processing'`,
    );
    expect(stuck[0].c).toBe(0);
    const pending = await db.query<{ c: number }>(
      `SELECT COUNT(*)::int as c FROM moph_alert_log WHERE status = 'pending'`,
    );
    expect(pending[0].c).toBe(3); // all 3 claimed then released, none sent
  });

  it('purges terminal rows older than retentionDays after a drain (codex gap-sweep: no retention)', async () => {
    process.env.MOPH_ALERT_RETENTION_DAYS = '30';
    try {
      const id = randomUUID();
      await db.query(
        `INSERT INTO moph_alert_log
           (id, case_id, hospital_id, origin_hcode, hospital_name, recipient_cid, recipient_scope,
            alert_source, severity, rule_id, title, status, attempts, local_date, created_at, updated_at)
         VALUES ($1,'old',$2,'10682','รพ.ขอนแก่น','3320500282121','hospital_staff','anc_hr3','high','hr3',
                 't','sent',1,'2026-01-01', NOW() - interval '90 days', NOW() - interval '90 days')`,
        [id, hospitalId],
      );
      await drainMophAlerts(db, hospitalId, {
        maxAlerts: 5,
        perSendTimeoutMs: 1000,
        budgetMs: 5000,
      });
      const rows = await db.query<{ c: number }>(
        `SELECT COUNT(*)::int as c FROM moph_alert_log WHERE id = $1`,
        [id],
      );
      expect(rows[0].c).toBe(0); // purged
    } finally {
      delete process.env.MOPH_ALERT_RETENTION_DAYS;
    }
  });
});
