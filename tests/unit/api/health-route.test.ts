// C4 fix: /api/health outage fallback must match the success-path HealthStatus
// shape (cache + degradedReasons), not the pre-C4 subset — a monitoring
// client reading data.cache.degraded would throw on undefined otherwise.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/ensure-init', () => ({
  ensureInit: async () => {
    throw new Error('initialization_failed_for_test');
  },
}));
vi.mock('@/db/connection', () => ({
  getDatabase: async () => {
    throw new Error('getDatabase should not be reached once ensureInit throws');
  },
}));

import { GET } from '@/app/api/health/route';

describe('GET /api/health outage fallback', () => {
  it('returns 503 with a body shape matching the success path', async () => {
    const res = await GET();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe('unhealthy');
    expect(body.database).toBe('disconnected');
    expect(body.cache).toEqual({ backend: 'memory', degraded: false, degradedSince: null });
    expect(Array.isArray(body.degradedReasons)).toBe(true);
    expect(body.degradedReasons.length).toBeGreaterThan(0);
  });
});
