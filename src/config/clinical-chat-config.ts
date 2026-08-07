// Clinical-chatbot configuration.
//
// Single source of truth for the chatbot's tunables and the DeepSeek-V4-Flash
// inference endpoint (the on-prem SGLang/vLLM server at CLINICAL_CHAT_BASE_URL
// serves model "deepseek-v4-flash"). The chatbot is ENABLED BY DEFAULT; set
// CLINICAL_CHAT_ENABLED="false" to disable (explicit opt-out, mirroring the
// MOPH_ALERTS_ENABLED pattern). Sampling defaults follow the DeepSeek V4 spec
// (constitution: no hardcoded conditions/URLs).

/** Master switch. When "false" the chat UI and /api/chat routes short-circuit
 *  503 and NEVER call the LLM (no fetch — a misconfigured deploy cannot burn
 *  compute). Any other value (or unset) = enabled. */
export function clinicalChatEnabled(): boolean {
  return process.env.CLINICAL_CHAT_ENABLED !== 'false';
}

/** DeepSeek-V4-Flash inference endpoint (SGLang/vLLM, OpenAI-compatible). */
export function clinicalChatBaseUrl(): string {
  return process.env.CLINICAL_CHAT_BASE_URL?.trim() || 'https://sglang-glm.bmscloud.in.th/v1';
}

/** Model served by clinicalChatBaseUrl() — the on-prem server exposes
 *  "deepseek-v4-flash". */
export function clinicalChatModel(): string {
  return process.env.CLINICAL_CHAT_MODEL?.trim() || 'deepseek-v4-flash';
}

export interface ClinicalChatLimits {
  /** Hard ceiling on completion tokens per request — cost lever #1 alongside
   *  enable_thinking:false (reasoning tokens are billed and can eat the whole
   *  budget if left unbounded). */
  maxTokensPerRequest: number;
  /** Per-request HTTP timeout (ms). vLLM can be slow under load. */
  timeoutMs: number;
  /** DeepSeek V4 spec sampling. */
  temperature: number;
  topP: number;
  /** Non-restrictive default (<=0 = disabled); DeepSeek guidance: "you usually
   *  only need to use temperature". */
  topK: number;
  /** Reasoning (thinking) for answer quality. DeepSeek sampling params only
   *  take effect while thinking is ON, and the 8k token cap covers reasoning
   *  tokens. Default true; set CLINICAL_CHAT_ENABLE_THINKING=false to disable. */
  enableThinking: boolean;
}

export function clinicalChatLimits(): ClinicalChatLimits {
  return {
    maxTokensPerRequest: numEnv('CLINICAL_CHAT_MAX_TOKENS', 8000),
    timeoutMs: numEnv('CLINICAL_CHAT_TIMEOUT_MS', 120_000),
    temperature: numEnv('CLINICAL_CHAT_TEMPERATURE', 1.0),
    topP: numEnv('CLINICAL_CHAT_TOP_P', 1.0),
    topK: numEnv('CLINICAL_CHAT_TOP_K', -1),
    enableThinking: boolEnv('CLINICAL_CHAT_ENABLE_THINKING', true),
  };
}

function boolEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return raw !== 'false';
}

function numEnv(key: string, fallback: number): number {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
