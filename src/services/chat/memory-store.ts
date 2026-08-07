// Phase 3 — clinical-chat multi-turn session memory (Redis, TTL-bounded).
//
// Stores ONLY the PDPA-safe prompt transcript (masked by context-builder +
// prompt-config — never raw patient PHI) keyed per user with a TTL, and caps
// history so a long session cannot grow the context window unbounded (cost:
// every stored turn is re-sent to GLM-5.2 each request).
import { cacheGetJson, cacheSetJson } from '@/lib/cache';
import type { LlmChatMessage } from '@/lib/llm-client';

const KEY_PREFIX = 'kk-lrms:chat';
const MAX_HISTORY_TURNS = 20;
const SESSION_TTL_SECONDS = 60 * 60; // 1h idle expiry

export type ChatMemoryTurn = Pick<LlmChatMessage, 'role' | 'content'>;

interface MemoryEnvelope {
  messages: ChatMemoryTurn[];
}

function sessionKey(userId: string): string {
  return `${KEY_PREFIX}:mem:${userId}`;
}

/** Read the user's bounded chat history (empty array when none / expired). */
export async function getChatHistory(userId: string): Promise<ChatMemoryTurn[]> {
  const envelope = await cacheGetJson<MemoryEnvelope>(sessionKey(userId));
  return envelope?.messages ?? [];
}

/** Append a turn and persist the bounded history with a TTL. */
export async function appendChatTurn(
  userId: string,
  turn: ChatMemoryTurn,
): Promise<ChatMemoryTurn[]> {
  const current = await getChatHistory(userId);
  const next = [...current, turn].slice(-MAX_HISTORY_TURNS);
  await cacheSetJson(
    sessionKey(userId),
    { messages: next } satisfies MemoryEnvelope,
    SESSION_TTL_SECONDS,
  );
  return next;
}
