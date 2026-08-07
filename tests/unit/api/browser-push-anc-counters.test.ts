// WHO containment T6 — ingestion observability. The T4 (downgradesBlocked)
// and T5 (visitConflicts) anomaly counters already exist on
// processAncWebhook's result (see services/webhook.ts WebhookAncResult) but
// were silently dropped by /api/sync/browser-push: result.anc only kept
// `processed`, the persist_anc sync step never recorded them, and nothing
// logged when an anomaly actually happened. This test drives the same T4
// "declared-only downgrade blocked" scenario through the real route handler
// and asserts the counters reach: (1) the response JSON, (2) the persisted
// sync step (visible in the admin Sync Log), (3) a logger.warn call so it's
// greppable in docker/journald logs.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { generateKey } from '@/lib/encryption';
import { testSessionUser } from '../../helpers/session';
import { logger } from '@/lib/logger';
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

const patient = (cid: string, riskLevel: string) => ({
  hn: 'BP-DOWNGRADE-1',
  name: 'นาง ทดสอบ เบราว์เซอร์',
  cid,
  birthday: '1994-06-20',
  pregNo: 1,
  riskLevel,
});

describe('POST /api/sync/browser-push — ANC ingestion anomaly counters (WHO containment T6)', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    mockSessionUser = testSessionUser({ hospitalCode: HCODE });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('surfaces downgradesBlocked/visitConflicts in the response and the persist_anc sync step, and warns when > 0', async () => {
    // First push establishes HR2 (declared-only, no riskItemIds).
    const first = await POST(
      jsonRequest({ anc: { patients: [patient('1007000100131', 'HR2')] } }) as never,
    );
    expect(first.status).toBe(200);

    const warnSpy = vi.spyOn(logger, 'warn');

    // Second push: declared-only LOW re-send. Missing evidence never
    // downgrades a known level (WHO T4) — this must be counted.
    const second = await POST(
      jsonRequest({ anc: { patients: [patient('1007000100140', 'LOW')] } }) as never,
    );
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.anc.downgradesBlocked).toBe(1);
    expect(body.anc.visitConflicts).toBe(0);

    const hid = await hospitalId();
    const run = await getLatestSyncRun(hid);
    const ancStep = run!.steps.find((s) => s.name === 'persist_anc' && s.status === 'success');
    expect(ancStep).toBeDefined();
    expect(ancStep!.counts).toMatchObject({ downgradesBlocked: 1, visitConflicts: 0 });

    expect(warnSpy).toHaveBeenCalledWith(
      'anc_ingest_anomalies',
      expect.objectContaining({ hospitalId: hid, downgradesBlocked: 1, visitConflicts: 0 }),
    );
  });

  it('does not log anc_ingest_anomalies when both counters are zero', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const res = await POST(
      jsonRequest({
        anc: { patients: [patient('1007000100034', 'LOW')] },
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.anc.downgradesBlocked).toBe(0);
    expect(body.anc.visitConflicts).toBe(0);
    expect(warnSpy).not.toHaveBeenCalledWith('anc_ingest_anomalies', expect.anything());
  });
});
