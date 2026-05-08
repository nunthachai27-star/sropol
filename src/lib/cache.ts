import { createClient } from 'redis';
import { logger } from '@/lib/logger';

type RedisClient = ReturnType<typeof createClient>;

interface MemoryEntry {
  value: string;
  expiresAt: number | null;
}

declare global {
  var __kkLrmsRedisClient: RedisClient | undefined;
  var __kkLrmsRedisDisabled: boolean | undefined;
  var __kkLrmsMemoryCache: Map<string, MemoryEntry> | undefined;
}

const DEFAULT_PREFIX = 'kk-lrms';

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

async function getRedisClient(): Promise<RedisClient | null> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl || redisUrl === 'memory' || globalThis.__kkLrmsRedisDisabled) {
    return null;
  }

  if (globalThis.__kkLrmsRedisClient?.isOpen) {
    return globalThis.__kkLrmsRedisClient;
  }

  const client = globalThis.__kkLrmsRedisClient ?? createClient({ url: redisUrl });
  globalThis.__kkLrmsRedisClient = client;
  client.on('error', (error) => {
    logger.warn('redis_client_error', { error });
  });

  try {
    if (!client.isOpen) {
      await client.connect();
    }
    return client;
  } catch (error) {
    globalThis.__kkLrmsRedisDisabled = true;
    logger.warn('redis_unavailable_using_memory_cache', { error });
    return null;
  }
}

async function getRaw(key: string): Promise<string | null> {
  const fullKey = namespaced(key);
  const redis = await getRedisClient();
  if (redis) {
    return redis.get(fullKey);
  }

  cleanupExpiredMemory();
  const entry = memoryStore().get(fullKey);
  return entry?.value ?? null;
}

async function setRaw(key: string, value: string, ttlSeconds: number): Promise<void> {
  const fullKey = namespaced(key);
  const redis = await getRedisClient();
  if (redis) {
    await redis.set(fullKey, value, { EX: ttlSeconds });
    return;
  }

  memoryStore().set(fullKey, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
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

export async function cacheKeys(pattern: string): Promise<string[]> {
  const fullPattern = namespaced(pattern);
  const prefix = namespaced('');
  const redis = await getRedisClient();
  if (redis) {
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
    return redis.del(keys.map(namespaced));
  }

  const store = memoryStore();
  let deleted = 0;
  for (const key of keys) {
    if (store.delete(namespaced(key))) deleted += 1;
  }
  return deleted;
}

export async function cacheStatus(): Promise<{ backend: 'redis' | 'memory'; available: boolean }> {
  const redis = await getRedisClient();
  return redis
    ? { backend: 'redis', available: true }
    : { backend: 'memory', available: true };
}
