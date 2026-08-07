import { createClient } from 'redis';
import { logger } from '@/lib/logger';

type RedisClient = ReturnType<typeof createClient>;

interface MemoryEntry {
  value: string;
  expiresAt: number | null;
}

interface RedisRetryState {
  attempt: number;
  disabledUntil: number;
  degradedSince: number | null;
  connecting: Promise<RedisClient | null> | null;
}

declare global {
  var __kkLrmsRedisClient: RedisClient | undefined;
  var __kkLrmsRedisRetry: RedisRetryState | undefined;
  var __kkLrmsMemoryCache: Map<string, MemoryEntry> | undefined;
}

const DEFAULT_PREFIX = 'kk-lrms';
const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 300_000;

function memoryStore(): Map<string, MemoryEntry> {
  globalThis.__kkLrmsMemoryCache ??= new Map<string, MemoryEntry>();
  return globalThis.__kkLrmsMemoryCache;
}

function cleanupExpiredMemory(now = Date.now()): void {
  for (const [key, entry] of memoryStore()) {
    if (entry.expiresAt !== null && entry.expiresAt <= now) {
      memoryStore().delete(key);
    }
  }
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function namespaced(key: string): string {
  const prefix = process.env.REDIS_KEY_PREFIX || DEFAULT_PREFIX;
  return `${prefix}:${key}`;
}

function retryState(): RedisRetryState {
  if (!globalThis.__kkLrmsRedisRetry) {
    globalThis.__kkLrmsRedisRetry = {
      attempt: 0,
      disabledUntil: 0,
      degradedSince: null,
      connecting: null,
    };
  }
  return globalThis.__kkLrmsRedisRetry;
}

function newRedisClient(url: string): RedisClient {
  const client = createClient({ url });
  // attach ONCE at creation (re-attaching per call leaked listeners before)
  client.on('error', (error) => {
    logger.warn('redis_client_error', { error });
  });
  globalThis.__kkLrmsRedisClient = client;
  return client;
}

async function getRedisClient(): Promise<RedisClient | null> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl || redisUrl === 'memory') return null;

  const existing = globalThis.__kkLrmsRedisClient;
  if (existing?.isOpen) return existing;

  const state = retryState();
  if (Date.now() < state.disabledUntil) return null; // inside backoff window
  if (state.connecting) return state.connecting; // single-flight

  state.connecting = (async () => {
    const client = globalThis.__kkLrmsRedisClient ?? newRedisClient(redisUrl);
    try {
      if (!client.isOpen) await client.connect();
      if (state.attempt > 0) {
        logger.info('redis_recovered', {
          attempts: state.attempt,
          downMs: state.degradedSince ? Date.now() - state.degradedSince : null,
        });
      }
      state.attempt = 0;
      state.disabledUntil = 0;
      state.degradedSince = null;
      return client;
    } catch (error) {
      state.attempt += 1;
      const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (state.attempt - 1));
      const jittered = backoff * (0.5 + Math.random() * 0.5);
      state.disabledUntil = Date.now() + jittered;
      state.degradedSince = state.degradedSince ?? Date.now();
      logger.warn('redis_unavailable_using_memory_cache', {
        attempt: state.attempt,
        retryInMs: Math.round(jittered),
        error,
      });
      return null;
    } finally {
      state.connecting = null;
    }
  })();
  return state.connecting;
}

async function getRaw(key: string): Promise<string | null> {
  const fullKey = namespaced(key);
  const redis = await getRedisClient();
  if (redis) {
    try {
      return await redis.get(fullKey);
    } catch (error) {
      logger.warn('redis_command_failed_using_memory', { op: 'get', error });
    }
  }
  cleanupExpiredMemory();
  return memoryStore().get(fullKey)?.value ?? null;
}

async function setRaw(key: string, value: string, ttlSeconds: number): Promise<void> {
  const fullKey = namespaced(key);
  const redis = await getRedisClient();
  if (redis) {
    try {
      await redis.set(fullKey, value, { EX: ttlSeconds });
      return;
    } catch (error) {
      logger.warn('redis_command_failed_using_memory', { op: 'set', error });
    }
  }
  memoryStore().set(fullKey, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  const value = await getRaw(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    logger.warn('cache_json_parse_failed', { key, error });
    return null;
  }
}

export async function cacheSetJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  await setRaw(key, JSON.stringify(value), ttlSeconds);
}

/**
 * Atomic set-if-absent with TTL. Returns true when THIS caller claimed the
 * key (it did not exist), false when someone else holds it. Used for
 * single-flight recompute locks and once-per-window sampling (e.g. audit
 * sampling on polled read routes — 2026-07-17 dashboard incident: 79 req/s
 * each paying an audit INSERT). Falls back to the in-memory store when Redis
 * is down — per-process-correct, which is acceptable for locks/sampling
 * (worst case: one extra recompute or audit row per process).
 */
export async function cacheSetNx(key: string, ttlSeconds: number): Promise<boolean> {
  const fullKey = namespaced(key);
  const redis = await getRedisClient();
  if (redis) {
    try {
      const res = await redis.set(fullKey, '1', { EX: ttlSeconds, NX: true });
      return res !== null;
    } catch (error) {
      logger.warn('redis_command_failed_using_memory', { op: 'setnx', error });
    }
  }
  cleanupExpiredMemory();
  const store = memoryStore();
  if (store.get(fullKey)) return false;
  store.set(fullKey, { value: '1', expiresAt: Date.now() + ttlSeconds * 1000 });
  return true;
}

export async function cacheKeys(pattern: string): Promise<string[]> {
  const fullPattern = namespaced(pattern);
  const prefix = namespaced('');
  const redis = await getRedisClient();
  if (redis) {
    try {
      const keys: string[] = [];
      // redis v5+ scanIterator yields ARRAYS of keys (one batch per iteration),
      // not individual keys like v4 did. Without this flatten, the loop wraps
      // a whole batch in String(...) → CSV blob → slice → garbage → every
      // downstream cacheGetJson lookup misses. That's why /admin "Online
      // Users" was empty despite Redis having live presence rows, and why
      // the Sync Log tab couldn't list its own runs.
      for await (const batch of redis.scanIterator({ MATCH: fullPattern, COUNT: 100 })) {
        const items = Array.isArray(batch) ? batch : [batch];
        for (const key of items) {
          keys.push(String(key).slice(prefix.length));
        }
      }
      return keys;
    } catch (error) {
      logger.warn('redis_command_failed_using_memory', { op: 'scan', error });
    }
  }

  cleanupExpiredMemory();
  const matcher = globToRegex(fullPattern);
  return Array.from(memoryStore().keys())
    .filter((key) => matcher.test(key))
    .map((key) => key.slice(prefix.length));
}

export async function cacheDelPattern(pattern: string): Promise<number> {
  const keys = await cacheKeys(pattern);
  if (keys.length === 0) return 0;

  const redis = await getRedisClient();
  if (redis) {
    try {
      return await redis.del(keys.map(namespaced));
    } catch (error) {
      logger.warn('redis_command_failed_using_memory', { op: 'del', error });
    }
  }

  const store = memoryStore();
  let deleted = 0;
  for (const key of keys) {
    if (store.delete(namespaced(key))) deleted += 1;
  }
  return deleted;
}

export async function cacheStatus(): Promise<{
  backend: 'redis' | 'memory';
  available: boolean;
  degraded: boolean;
  degradedSince: string | null;
}> {
  const redisUrl = process.env.REDIS_URL?.trim();
  const configured = Boolean(redisUrl && redisUrl !== 'memory');
  const redis = configured ? await getRedisClient() : null;
  if (redis) {
    return { backend: 'redis', available: true, degraded: false, degradedSince: null };
  }
  const since = retryState().degradedSince;
  return {
    backend: 'memory',
    available: true,
    degraded: configured,
    degradedSince: configured && since ? new Date(since).toISOString() : null,
  };
}

/** Tear down client + retry state + memory store so tests start clean. */
export function resetCacheForTests(): void {
  globalThis.__kkLrmsRedisClient = undefined;
  globalThis.__kkLrmsRedisRetry = undefined;
  globalThis.__kkLrmsMemoryCache = undefined;
}
