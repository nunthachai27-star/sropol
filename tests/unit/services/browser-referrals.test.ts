// persistBrowserReferrals — the browser-poll referral loop. Validates CID,
// dispatches each item through processReferralCreate(skipIfUntracked), and
// returns per-outcome counts. Untracked patients are skipped (no phantom
// journey); bad CIDs are skipped; a missing destination hospital fails that
// one item without aborting the batch.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables/index';
import { SeedOrchestrator } from '@/db/seeds/index';
import { generateKey } from '@/lib/encryption';
import type { SseManager } from '@/lib/sse';
import {
  persistBrowserReferrals,
  processAncWebhook,
  type BrowserReferral,
  type WebhookAncPayload,
} from '@/services/webhook';

process.env.ENCRYPTION_KEY = generateKey();

class MockSse {
  events: Array<{ event: string; data: unknown }> = [];
  broadcast(event: string, data: unknown) { this.events.push({ event, data }); }
}
const asSse = (m: MockSse): SseManager => m as unknown as SseManager;

describe('persistBrowserReferrals', () => {
  let db: SqliteAdapter;
  let sse: MockSse;
  let senderId: string;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await SchemaSync.sync(db, ALL_TABLES, 'sqlite');
    await new SeedOrchestrator().run(db);
    sse = new MockSse();
    const now = new Date().toISOString();
    senderId = uuidv4();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, '99902', 'รพ.ต้นทาง', 'M2', 1, 'UNKNOWN', ?, ?)`,
      [senderId, now, now],
    );
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, '99903', 'รพ.ปลายทาง', 'A', 1, 'UNKNOWN', ?, ?)`,
      [uuidv4(), now, now],
    );
  });

  afterEach(async () => { await db.close(); });

  it('processes a tracked patient, skips untracked, skips bad CID', async () => {
    // Track one pregnancy via ANC (valid checksum CID)
    const anc: WebhookAncPayload = {
      type: 'anc_data', hospitalCode: '99902',
      patients: [{ hn: 'T-001', name: 'นาง ติดตาม', cid: '1409901066411',
        birthday: '1996-01-01', pregNo: 1, lmp: '2025-08-01', riskLevel: 'LOW' }],
    };
    await processAncWebhook(db, senderId, anc, asSse(sse));

    const referrals: BrowserReferral[] = [
      { referralId: 'R-TRACKED', hn: 'T-001', cid: '1409901066411', name: 'นาง ติดตาม',
        toHospitalCode: '99903', reason: 'ส่งต่อ tracked' },
      { referralId: 'R-UNTRACKED', hn: 'U-002', cid: '1409901066420', name: 'นาง ไม่ติดตาม',
        toHospitalCode: '99903', reason: 'ส่งต่อ untracked' },
      { referralId: 'R-BADCID', hn: 'B-003', cid: '1234567890123', name: 'นาง ซีไอดีเสีย',
        toHospitalCode: '99903', reason: 'ส่งต่อ bad cid' },
    ];

    const result = await persistBrowserReferrals(db, senderId, '99902', referrals, asSse(sse));

    expect(result).toEqual({ processed: 1, skippedUntracked: 1, skippedBadCid: 1, failed: 0 });

    const refs = await db.query('SELECT refer_number FROM cached_referrals');
    expect(refs).toHaveLength(1);

    const { createHash: h } = await import('crypto');
    const untrackedHash = h('sha256').update('1409901066420').digest('hex');
    const phantom = await db.query('SELECT id FROM maternal_journeys WHERE cid_hash = ?', [untrackedHash]);
    expect(phantom).toHaveLength(0);
  });

  it('counts a missing destination hospital as failed, not a thrown batch', async () => {
    const anc: WebhookAncPayload = {
      type: 'anc_data', hospitalCode: '99902',
      patients: [{ hn: 'T-010', name: 'นาง ปลายทางหาย', cid: '1409901066411',
        birthday: '1995-01-01', pregNo: 1, lmp: '2025-08-01', riskLevel: 'LOW' }],
    };
    await processAncWebhook(db, senderId, anc, asSse(sse));

    const referrals: BrowserReferral[] = [
      { referralId: 'R-NODEST', hn: 'T-010', cid: '1409901066411', name: 'นาง ปลายทางหาย',
        toHospitalCode: '00000', reason: 'ปลายทางไม่อยู่ในระบบ' },
    ];

    const result = await persistBrowserReferrals(db, senderId, '99902', referrals, asSse(sse));
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(0);
  });
});
