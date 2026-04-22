// Minimal OpenAI-compatible LLM client for the dev-mode simulation generator.
// Points at a self-hosted vLLM instance (default: BMS cloud) serving Gemma-4.
// Reads LLM_BASE_URL + LLM_DEFAULT_MODEL from env so deployments can override.
//
// This client is intentionally thin — no streaming, no function calling, no
// retries with backoff. The simulation engine wraps it with its own error
// handling so individual LLM misfires don't kill the whole simulation.

import { logger } from './logger';

// Default points at the on-prem vLLM on the lab LAN. Override via
// LLM_BASE_URL when deploying off-network (e.g. back to the public
// vllm-qwen.bmscloud.in.th endpoint for cloud demos).
const DEFAULT_BASE_URL = 'http://192.168.50.207:24000/v1';
const DEFAULT_MODEL = 'gemma4';
// 3-minute ceiling for heavy prompts (shift plans, full clinical records
// under JSON schema). vLLM under 26-parallel sim load can take 30-90s per
// response; 180s gives generous headroom while still catching hard hangs.
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_TOKENS = 8000;

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmChatOptions {
  model?: string;
  messages: LlmChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** When true, asks the server to return a strict JSON object. */
  jsonMode?: boolean;
  /** Optional JSON schema for guided generation (vLLM extra_body.guided_json). */
  jsonSchema?: Record<string, unknown>;
  /** Abort signal so callers can cancel in-flight requests. */
  signal?: AbortSignal;
  /** Override the internal request-timeout ceiling (ms). Default 30_000. Use
   *  a larger value for heavy prompts like Tier-3 plan generation. */
  timeoutMs?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export interface LlmModelInfo {
  id: string;
  ownedBy?: string;
  maxContextLen?: number;
}

function baseUrl(): string {
  return (process.env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function defaultModel(): string {
  return process.env.LLM_DEFAULT_MODEL || DEFAULT_MODEL;
}

function apiKey(): string | null {
  return process.env.LLM_API_KEY || null;
}

export async function listLlmModels(signal?: AbortSignal): Promise<LlmModelInfo[]> {
  const key = apiKey();
  const res = await fetch(`${baseUrl()}/models`, {
    method: 'GET',
    headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    signal,
  });
  if (!res.ok) {
    throw new Error(`LLM /models returned ${res.status}`);
  }
  const body = (await res.json()) as { data?: Array<{ id: string; owned_by?: string; max_model_len?: number }> };
  return (body.data ?? []).map((m) => ({
    id: m.id,
    ownedBy: m.owned_by,
    maxContextLen: m.max_model_len,
  }));
}

export async function llmChat(opts: LlmChatOptions): Promise<string> {
  const key = apiKey();
  const controller = new AbortController();
  // Callers can raise the ceiling (planner's 20-event plan needs ~40s on the
  // shared vLLM). Passing 0 disables the internal timer and defers entirely
  // to the caller-provided signal.
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const t = timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  // Merge external signal with internal timeout.
  if (opts.signal) {
    opts.signal.addEventListener('abort', () => controller.abort());
  }
  try {
    const body: Record<string, unknown> = {
      model: opts.model || defaultModel(),
      messages: opts.messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    };
    if (opts.jsonMode) {
      body.response_format = { type: 'json_object' };
    }
    if (opts.jsonSchema) {
      // vLLM guided-generation extension — server forces output to conform.
      body.extra_body = { guided_json: opts.jsonSchema };
    }
    const res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as ChatCompletionResponse;
    if (json.error) throw new Error(`LLM error: ${json.error.message}`);
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM returned empty content');
    return content;
  } catch (err) {
    logger.warn('llm_chat_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    if (t) clearTimeout(t);
  }
}

/**
 * Calls `llmChat` with `jsonMode: true` and parses the response as JSON.
 * Throws if the response isn't valid JSON.
 */
export async function llmJson<T>(opts: Omit<LlmChatOptions, 'jsonMode'>): Promise<T> {
  const raw = await llmChat({ ...opts, jsonMode: true });
  // Some models wrap JSON in markdown code fences; strip them defensively.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`LLM JSON parse failed: ${cleaned.slice(0, 200)}`);
  }
}
