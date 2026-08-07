// TDD for the admin MOPH-alerts ops route (GET list + POST re-drive).
// Mocks db/auth/ensure-init/drain so it stays light (no PGlite boot).
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapter';
import { UserRole } from '@/types/domain';

let db: DatabaseAdapter;
let mockSessionUser: Record<string, unknown> | null = null;
const mockDrain = vi.fn();

vi.mock('@/db/connection', () => ({ getDatabase: async () => db }));
vi.mock('@/lib/ensure-init', () => ({ ensureInit: async () => {} }));
vi.mock('@/lib/auth', () => ({
  auth: async () => (mockSessionUser ? { user: mockSessionUser } : null),
}));
vi.mock('@/services/moph-alert-drain', () => ({
  drainMophAlerts: (...args: unknown[]) => mockDrain(...args),
}));

import { GET, POST } from '@/app/api/admin/moph-alerts/route';

function req(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

const ADMIN = {
  id: 'u-admin',
  name: 'แอดมิน',
  userCid: '1100500090006',
  role: UserRole.ADMIN,
  hospitalCode: '10670',
  hospitalName: 'รพ.ขอนแก่น',
  accessMode: 'readwrite' as const,
  authProvider: 'bms' as const,
  tunnelUrl: '',
  databaseType: '',
};

describe('GET /api/admin/moph-alerts', () => {
  beforeEach(() => {
    mockSessionUser = ADMIN;
    mockDrain.mockReset();
    db = {
      query: vi.fn(async () => [
        {
          id: 'r1',
          case_id: 'ANC-1',
          hospital_id: 'h1',
          recipient_cid: '3320500282121',
          recipient_scope: 'hospital_staff',
          alert_source: 'anc_cpd',
          severity: 'high',
          rule_id: 'cpd_high',
          status: 'sent',
          message_id: 'msg-1',
          attempts: 1,
          last_error: null,
          sent_at: '2026-07-26T01:00:00Z',
          created_at: '2026-07-26T00:59:00Z',
        },
      ]),
      execute: vi.fn(async () => undefined),
    } as unknown as DatabaseAdapter;
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns alerts with recipient CID masked to last 4 (PDPA)', async () => {
    const res = await GET(req('http://test/api/admin/moph-alerts') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.alerts[0].recipient_cid).toBe('********2121');
    expect(body.alerts[0].recipient_cid).not.toContain('3320500');
  });

  it('rejects non-admin (401/403)', async () => {
    mockSessionUser = { ...ADMIN, role: UserRole.NURSE };
    const res = await GET(req('http://test/api/admin/moph-alerts') as never);
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('forwards hospital_id + status filters to the query', async () => {
    const spy = db.query as ReturnType<typeof vi.fn>;
    await GET(req('http://test/api/admin/moph-alerts?hospital_id=h1&status=pending') as never);
    expect(spy).toHaveBeenCalled();
    const sql = spy.mock.calls[0][0] as string;
    expect(sql).toContain('hospital_id = $1');
    expect(sql).toContain('status = $2');
  });

  it('clamps a bad limit to a safe finite integer (no NaN/negative reaching SQL)', async () => {
    const spy = db.query as ReturnType<typeof vi.fn>;
    for (const bad of ['abc', '-5', '0', '', '1e9']) {
      spy.mockClear();
      await GET(req(`http://test/api/admin/moph-alerts?limit=${bad}`) as never);
      expect(spy).toHaveBeenCalled();
      // LIMIT param is the last bind value; must be a finite integer in 1..500.
      const params = spy.mock.calls[0][1] as unknown[];
      const limit = params[params.length - 1];
      expect(Number.isFinite(limit)).toBe(true);
      expect(limit).toBeGreaterThanOrEqual(1);
      expect(limit).toBeLessThanOrEqual(500);
      expect(Number.isInteger(limit)).toBe(true);
    }
  });
});

describe('POST /api/admin/moph-alerts', () => {
  beforeEach(() => {
    mockSessionUser = ADMIN;
    mockDrain.mockReset();
    mockDrain.mockResolvedValue({ sent: 2, retryable: 0, failed: 0, skipped: 0 });
    db = {
      query: vi.fn(async () => []),
      execute: vi.fn(async () => undefined),
    } as unknown as DatabaseAdapter;
  });
  afterEach(() => vi.restoreAllMocks());

  it('re-drives pending alerts for the given hospitalId', async () => {
    const res = await POST(
      req('http://test/api/admin/moph-alerts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hospitalId: 'h1' }),
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(mockDrain).toHaveBeenCalledWith(expect.anything(), 'h1', expect.anything());
    const body = await res.json();
    expect(body.drain.sent).toBe(2);
  });

  it('400 when hospitalId missing', async () => {
    const res = await POST(
      req('http://test/api/admin/moph-alerts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }) as never,
    );
    expect(res.status).toBe(400);
  });
});
