// /api/dashboard/high-risk is polled by every open client every 30s but, unlike
// /api/dashboard, recomputed the cross-hospital high-risk aggregation on EVERY
// request and wrote an audit row every time — the main next-server CPU driver
// under load. It must serve from a short-lived cache and only audit the actual
// recompute, not each auto-refresh poll.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ensure-init', () => ({ ensureInit: vi.fn() }));
vi.mock('@/db/connection', () => ({ getDatabase: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1' } })) }));
vi.mock('@/services/audit', () => ({ tryLogAccess: vi.fn() }));
vi.mock('@/lib/cache', () => ({ cacheGetJson: vi.fn(), cacheSetJson: vi.fn() }));
vi.mock('@/services/dashboard', () => ({ getHighRiskPatients: vi.fn() }));

import { GET } from '@/app/api/dashboard/high-risk/route';
import { getHighRiskPatients } from '@/services/dashboard';
import { cacheGetJson, cacheSetJson } from '@/lib/cache';
import { tryLogAccess } from '@/services/audit';

const compute = getHighRiskPatients as unknown as ReturnType<typeof vi.fn>;
const cacheGet = cacheGetJson as unknown as ReturnType<typeof vi.fn>;
const cacheSet = cacheSetJson as unknown as ReturnType<typeof vi.fn>;
const audit = tryLogAccess as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe('GET /api/dashboard/high-risk caching', () => {
  it('serves the cached payload without recomputing on a warm cache', async () => {
    cacheGet.mockResolvedValue({ patients: [{ an: 'A1' }] });
    const res = await GET();
    expect((await res.json()).patients).toEqual([{ an: 'A1' }]);
    expect(compute).not.toHaveBeenCalled();
  });

  it('computes and stores the result on a cold cache', async () => {
    cacheGet.mockResolvedValue(null);
    compute.mockResolvedValue([{ an: 'A2' }]);
    const res = await GET();
    expect((await res.json()).patients).toEqual([{ an: 'A2' }]);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(cacheSet).toHaveBeenCalledTimes(1);
  });

  it('does NOT write an audit row on a warm-cache poll', async () => {
    cacheGet.mockResolvedValue({ patients: [] });
    await GET();
    expect(audit).not.toHaveBeenCalled();
  });

  it('audits the actual recompute (cache miss) once', async () => {
    cacheGet.mockResolvedValue(null);
    compute.mockResolvedValue([]);
    await GET();
    expect(audit).toHaveBeenCalledTimes(1);
  });
});
