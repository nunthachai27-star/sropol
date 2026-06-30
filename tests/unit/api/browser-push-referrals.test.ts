// /api/sync/browser-push must dispatch body.referrals to persistBrowserReferrals
// and record a persist_referrals sync step. Heavy referral logic is tested in
// tests/unit/services/browser-referrals.test.ts — here we only assert wiring.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ensure-init', () => ({ ensureInit: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  auth: vi.fn(async () => ({ user: { hospitalCode: '99902', accessMode: 'full' } })),
}));
vi.mock('@/db/connection', () => ({
  getDatabase: vi.fn(async () => ({
    query: vi.fn(async () => [{ id: 'hosp-1', is_active: true }]),
    execute: vi.fn(async () => {}),
  })),
}));
vi.mock('@/lib/sse', () => ({ SseManager: { getInstance: vi.fn(() => ({ broadcast: vi.fn() })) } }));
vi.mock('@/services/sync/progress-store', () => ({
  startSyncRun: vi.fn(async () => 'run-1'),
  appendSyncStep: vi.fn(async () => {}),
  finalizeSyncRun: vi.fn(() => {}),
}));
vi.mock('@/services/webhook', () => ({
  processWebhookPayload: vi.fn(),
  processAncWebhook: vi.fn(),
  processPartographWebhook: vi.fn(),
  validatePayload: vi.fn(() => ({ valid: false, payload: null })),
  validateAncPayload: vi.fn(() => ({ valid: false, payload: null })),
  validatePartographPayload: vi.fn(() => ({ valid: false, payload: null })),
  persistBrowserReferrals: vi.fn(async () => ({ processed: 2, skippedUntracked: 1, skippedBadCid: 0, failed: 0 })),
}));

import { POST } from '@/app/api/sync/browser-push/route';
import { persistBrowserReferrals } from '@/services/webhook';
import { appendSyncStep } from '@/services/sync/progress-store';

const persist = persistBrowserReferrals as unknown as ReturnType<typeof vi.fn>;
const step = appendSyncStep as unknown as ReturnType<typeof vi.fn>;

function req(body: unknown): Request {
  return new Request('http://localhost/api/sync/browser-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/sync/browser-push — referrals', () => {
  it('dispatches body.referrals to persistBrowserReferrals and records the step', async () => {
    const referrals = [
      { referralId: 'R1', hn: 'H1', cid: '1409901066411', name: 'n', toHospitalCode: '99903', reason: 'r' },
    ];
    const res = await POST(req({ referrals }) as never);
    const json = await res.json();

    expect(persist).toHaveBeenCalledTimes(1);
    // (db, hospitalId, hcode, referrals, sse)
    expect(persist.mock.calls[0][2]).toBe('99902');
    expect(persist.mock.calls[0][3]).toEqual(referrals);

    expect(json.referrals).toEqual({ processed: 2, skippedUntracked: 1, skippedBadCid: 0, failed: 0 });
    const stepNames = step.mock.calls.map((c) => c[2]?.name);
    expect(stepNames).toContain('persist_referrals');
  });

  it('does not call persistBrowserReferrals when no referrals are present', async () => {
    await POST(req({}) as never);
    expect(persist).not.toHaveBeenCalled();
  });
});
