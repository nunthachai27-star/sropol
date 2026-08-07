// BMS session id on sync-run records — operator observability.
//
// The browser client pulls HOSxP data under a BMS PasteJSON session id. That
// id is the operator's handle for running diagnostic SQL against the
// hospital's HOSxP via the BMS Session API (e.g. checking
// ward.is_maternity_ward / ipt.ipt_admit_type_id when a hospital's labor
// feed is unexpectedly empty — hcode 10998 investigation). The client now
// attaches it to the push body as optional `bms_session_id`; the route
// validates it and stamps it on the SyncProgressRun record. It is stored
// ONLY in the run record (never via logger — SENSITIVE_KEYS redacts session
// ids), and older clients that omit it must keep working (backward compat).
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { generateKey } from '@/lib/encryption';
import { testSessionUser } from '../../helpers/session';
import { getLatestSyncRun } from '@/services/sync/progress-store';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? generateKey();

let db: DatabaseAdapter;
let mockSessionUser: Record<string, unknown> | null = null;

vi.mock('@/db/connection', () => ({ getDatabase: async () => db }));
vi.mock('@/lib/auth', () => ({
  auth: async () => (mockSessionUser ? { user: mockSessionUser } : null),
}));
vi.mock('@/lib/ensure-init', () => ({ ensureInit: async () => {} }));

import { POST } from '@/app/api/sync/browser-push/route';

const HCODE = '10670';

function jsonRequest(body: unknown): Request {
  return new Request('http://test/api/sync/browser-push', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function hospitalId(): Promise<string> {
  const rows = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [HCODE]);
  return rows[0].id;
}

const ancPatient = {
  hn: 'BP-SESSION-1',
  name: 'นาง ทดสอบ เซสชัน',
  cid: '1007000100131',
  birthday: '1994-06-20',
  pregNo: 1,
  riskLevel: 'LOW',
};

describe('POST /api/sync/browser-push — bms_session_id on the sync-run record', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    mockSessionUser = testSessionUser({ hospitalCode: HCODE });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stamps a valid bms_session_id on the run record', async () => {
    const res = await POST(
      jsonRequest({
        bms_session_id: 'SESS-2026-abc123',
        anc: { patients: [ancPatient] },
      }) as never,
    );
    expect(res.status).toBe(200);

    const run = await getLatestSyncRun(await hospitalId());
    expect(run).not.toBeNull();
    expect(run!.bmsSessionId).toBe('SESS-2026-abc123');
    // The push itself still processes normally.
    expect(run!.steps.some((s) => s.name === 'persist_anc' && s.status === 'success')).toBe(true);
  });

  it('records null when the field is absent (older clients — backward compat)', async () => {
    const res = await POST(jsonRequest({ anc: { patients: [ancPatient] } }) as never);
    expect(res.status).toBe(200);

    const run = await getLatestSyncRun(await hospitalId());
    expect(run).not.toBeNull();
    expect(run!.bmsSessionId).toBeNull();
    expect(run!.outcome).toBe('success');
  });

  it('rejects malformed values (non-string, empty, over length cap) to null without failing the push', async () => {
    for (const bad of [12345, '', '   ', 'x'.repeat(101), { nested: 'obj' }]) {
      const res = await POST(
        jsonRequest({ bms_session_id: bad, anc: { patients: [ancPatient] } }) as never,
      );
      expect(res.status).toBe(200);
      const run = await getLatestSyncRun(await hospitalId());
      expect(run!.bmsSessionId).toBeNull();
    }
  });

  it('trims surrounding whitespace from the session id', async () => {
    const res = await POST(
      jsonRequest({ bms_session_id: '  SESS-trim-me  ', anc: { patients: [ancPatient] } }) as never,
    );
    expect(res.status).toBe(200);
    const run = await getLatestSyncRun(await hospitalId());
    expect(run!.bmsSessionId).toBe('SESS-trim-me');
  });
});
