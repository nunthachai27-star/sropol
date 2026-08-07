// Fixed-window rate limiter on the shared cache layer (Redis in prod,
// in-memory in tests). Best-effort: the read-increment-write is not atomic;
// adequate for abuse containment + telemetry, not for billing-grade quotas.
import { cacheGetJson, cacheSetJson } from '@/lib/cache';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const windowId = Math.floor(Date.now() / (windowSeconds * 1000));
  const bucket = `ratelimit:${key}:${windowId}`;
  const current = (await cacheGetJson<number>(bucket)) ?? 0;
  if (current >= limit) {
    return { allowed: false, remaining: 0 };
  }
  await cacheSetJson(bucket, current + 1, windowSeconds);
  return { allowed: true, remaining: limit - current - 1 };
}
