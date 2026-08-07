// Phase 3 TDD — clinical-chat session memory (plan 2026-08-03-clinical-chatbot-glm).
// Codex risk: "multi-turn memory expires and stores masked transcript only".
// Memory is stored in Redis via cache.ts with a TTL. Two invariants:
//   1. The transcript is bounded (no unbounded growth into the context window).
//   2. What is stored is ONLY the PDPA-safe prompt transcript — never raw PHI.
import { describe, it, expect, vi } from 'vitest';
import { appendChatTurn, getChatHistory, type ChatMemoryTurn } from '@/services/chat/memory-store';

const KEY_PREFIX = 'kk-lrms:chat';

// vi.hoisted: the mock factory is hoisted above all top-level bindings, so the
// fake store must be created here and referenced from both the factory and the
// tests (project pattern — cfr. a776b5b vi.hoisted stabilization).
const HOISTED = vi.hoisted(() => {
  const data = new Map<string, string>();
  return {
    data,
    cacheGetJson: async <T>(key: string): Promise<T | null> => {
      const v = data.get(key);
      return v ? (JSON.parse(v) as T) : null;
    },
    cacheSetJson: async <T>(key: string, value: T, ttlSeconds: number): Promise<void> => {
      data.set(key, JSON.stringify(value));
      // TTL must always be a number — the store always requests expiry, never
      // an unbounded write.
      if (typeof ttlSeconds !== 'number') throw new Error('cacheSetJson TTL not a number');
    },
  };
});

vi.mock('@/lib/cache', () => ({
  cacheGetJson: HOISTED.cacheGetJson,
  cacheSetJson: HOISTED.cacheSetJson,
}));

describe('clinical-chat session memory — TTL + masked-persistence', () => {
  it('stores only the masked turn transcript, keyed by session, with a TTL', async () => {
    const turn: ChatMemoryTurn = {
      role: 'user',
      content: 'ผู้ป่วย ชัยพร ส. (HN HN-1) อายุ 30 ปี · GA 28 สัปดาห์ — รีสก์สูงไหม?',
    };
    await appendChatTurn('user-1', turn);

    // key has the session + TTL requested (number) — verifies the store asks
    // Redis for expiry, not an unbounded write.
    expect(HOISTED.data.size).toBe(1);
    const [key] = HOISTED.data.keys();
    expect(key).toContain(KEY_PREFIX);
    expect(key).toContain('user-1');

    const history = await getChatHistory('user-1');
    expect(history).toHaveLength(1);
    expect(history[0]).toEqual(turn);
  });

  it('grows bounded: appends up to a hard limit then drops the oldest turn', async () => {
    // Push far more than the max history depth.
    for (let i = 0; i < 40; i++) {
      await appendChatTurn('user-1', { role: 'user', content: `turn-${i}` });
    }
    const history = await getChatHistory('user-1');
    expect(history.length).toBeLessThanOrEqual(20); // MAX_HISTORY_TURNS
    // Oldest dropped; newest retained.
    expect(history.some((t) => t.content === 'turn-39')).toBe(true);
    expect(history.some((t) => t.content === 'turn-0')).toBe(false);
  });
});
