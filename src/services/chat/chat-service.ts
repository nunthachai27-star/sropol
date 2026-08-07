// Clinical-chatbot service — the single place that talks to GLM-5.2 for the
// chat feature (business logic lives in services, never in route handlers:
// constitution IV). Phase 0 = thin non-streaming chat. Phase 1+ will add
// context builder + redactor + memory here without changing the route shape.
import { llmChat, type LlmChatMessage } from '@/lib/llm-client';
import {
  clinicalChatBaseUrl,
  clinicalChatModel,
  clinicalChatLimits,
} from '@/config/clinical-chat-config';
import { buildChatContext, type ChatContext } from './context-builder';
import {
  clinicalSystemPrompt,
  statisticsSystemPrompt,
  renderContextBlock,
  type ClinicalChatMode,
} from './prompt-config';
import { buildStatisticsContext } from './stats-context-builder';
import { getChatHistory, appendChatTurn } from './memory-store';
import type { DatabaseAdapter } from '@/db/adapter';

export interface ChatReply {
  answer: string;
}

export interface ChatServiceDeps {
  db: DatabaseAdapter;
  /** Session hospital code — RAG scope. Null skips patient context (header-only chat). */
  hospitalCode?: string;
  /** Session user id — enables bounded multi-turn memory (Redis TTL). */
  userId?: string;
  /** Chat mode: 'clinical' (maternity ward, per-patient RAG) is the default;
   *  'statistics' (dashboard) injects deterministic aggregate counts. */
  mode?: ClinicalChatMode;
}

/**
 * Sends a single-turn Thai clinical question to the self-hosted
 * DeepSeek-V4-Flash endpoint with reasoning (thinking) ENABLED by default
 * (extra_body.chat_template_kwargs.enable_thinking from config — DeepSeek
 * sampling params only take effect while thinking is on) and a hard max_tokens
 * cap (cost lever #1; 8k covers reasoning tokens). The endpoint/model/limits
 * all come from config, never literals.
 *
 * Phase 1: when a hospitalCode is provided, a PDPA-redacted patient context
 * block (masked name/CID, clinical fields only) is built and injected into the
 * user turn so the model answers with the hospital's own patients in scope.
 */
export async function askClinicalQuestion(
  question: string,
  deps: ChatServiceDeps,
): Promise<ChatReply> {
  const limits = clinicalChatLimits();
  const isStats = deps.mode === 'statistics';
  // Statistics mode: deterministic aggregate counts (no PHI lists). Clinical
  // (default): hospital-scoped PDPA-redacted patient RAG.
  const contextBlock = isStats
    ? ((await buildStatisticsContext(deps.db, deps.hospitalCode ?? ''))?.context ?? '')
    : renderContextBlock(await buildChatContext(deps.db, deps.hospitalCode ?? ''));
  const userTurn = contextBlock ? `${contextBlock}\n\nคำถาม: ${question}` : question;

  // Multi-turn: pull bounded masked history (Redis TTL) and append this turn.
  const history = deps.userId ? await getChatHistory(deps.userId) : [];
  const messages: LlmChatMessage[] = [
    { role: 'system', content: isStats ? statisticsSystemPrompt() : clinicalSystemPrompt() },
    ...history.map((t) => ({ role: t.role, content: t.content }) as LlmChatMessage),
    { role: 'user', content: userTurn },
  ];

  const answer = await llmChat({
    model: clinicalChatModel(),
    baseUrl: clinicalChatBaseUrl(),
    messages,
    temperature: limits.temperature,
    topP: limits.topP,
    topK: limits.topK,
    maxTokens: limits.maxTokensPerRequest,
    timeoutMs: limits.timeoutMs,
    extraBody: {
      chat_template_kwargs: { enable_thinking: limits.enableThinking },
    },
  });

  // Persist the turn pair (masked transcript only) so context stays bounded.
  if (deps.userId) {
    await appendChatTurn(deps.userId, { role: 'user', content: userTurn });
    await appendChatTurn(deps.userId, { role: 'assistant', content: answer });
  }
  return { answer };
}
