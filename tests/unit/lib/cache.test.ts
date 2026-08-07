import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockClient = {
  isOpen: false,
  on: vi.fn(),
  connect: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  scanIterator: vi.fn(),
  del: vi.fn(),
};
vi.mock('redis', () => ({ createClient: vi.fn(() => mockClient) }));

import { cacheGetJson, cacheSetJson, cacheStatus, resetCacheForTests } from '@/lib/cache';

describe('cache Redis recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetCacheForTests();
    vi.clearAllMocks();
    mockClient.isOpen = false;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('memory fallback works with TTL when REDIS_URL is unset', async () => {
    await cacheSetJson('k', { a: 1 }, 60);
    expect(await cacheGetJson('k')).toEqual({ a: 1 });
    vi.advanceTimersByTime(61_000);
    expect(await cacheGetJson('k')).toBeNull();
  });

  it('backs off after a failed connect instead of retrying every call — and instead of disabling forever', async () => {
    vi.stubEnv('REDIS_URL', 'redis://test:6379');
    mockClient.connect.mockRejectedValue(new Error('ECONNREFUSED'));

    await cacheSetJson('k', 1, 60); // attempt #1 fails -> memory
    await cacheSetJson('k', 2, 60); // inside backoff window: NO new attempt
    expect(mockClient.connect).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(6 * 60_000); // past max backoff
    mockClient.connect.mockImplementation(async () => {
      mockClient.isOpen = true;
    });
    mockClient.set.mockResolvedValue('OK');
    await cacheSetJson('k', 3, 60); // attempt #2 succeeds -> redis again
    expect(mockClient.connect).toHaveBeenCalledTimes(2);
    const status = await cacheStatus();
    expect(status.backend).toBe('redis');
    expect(status.degraded).toBe(false);
  });

  it('reports degraded=true while configured Redis is unavailable', async () => {
    vi.stubEnv('REDIS_URL', 'redis://test:6379');
    mockClient.connect.mockRejectedValue(new Error('ECONNREFUSED'));
    await cacheSetJson('k', 1, 60);
    const status = await cacheStatus();
    expect(status.backend).toBe('memory');
    expect(status.degraded).toBe(true);
    expect(status.degradedSince).not.toBeNull();
  });

  it('single-flight: concurrent calls during connect trigger one attempt', async () => {
    vi.stubEnv('REDIS_URL', 'redis://test:6379');
    mockClient.connect.mockRejectedValue(new Error('ECONNREFUSED'));
    await Promise.all([cacheGetJson('a'), cacheGetJson('b'), cacheGetJson('c')]);
    expect(mockClient.connect).toHaveBeenCalledTimes(1);
  });

  it('a post-connect command failure falls back to memory instead of throwing', async () => {
    vi.stubEnv('REDIS_URL', 'redis://test:6379');
    mockClient.isOpen = true;
    mockClient.get.mockRejectedValue(new Error('socket closed'));
    mockClient.set.mockRejectedValue(new Error('socket closed'));
    await expect(cacheSetJson('k', { a: 1 }, 60)).resolves.toBeUndefined();
    await expect(cacheGetJson('k')).resolves.toEqual({ a: 1 }); // served from memory
  });
});
