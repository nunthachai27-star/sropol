import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit } from '@/lib/rate-limit';
import { cacheDelPattern } from '@/lib/cache';

describe('checkRateLimit', () => {
  beforeEach(async () => {
    await cacheDelPattern('ratelimit:*');
  });

  it('allows up to the limit then rejects within the window', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await checkRateLimit('test-key', 3, 60);
      expect(r.allowed).toBe(true);
    }
    const rejected = await checkRateLimit('test-key', 3, 60);
    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);
  });

  it('isolates keys', async () => {
    await checkRateLimit('key-a', 1, 60);
    const other = await checkRateLimit('key-b', 1, 60);
    expect(other.allowed).toBe(true);
  });
});
