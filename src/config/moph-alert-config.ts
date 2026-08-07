// MOPH Prompt (LINE) risk-alert configuration.
//
// Single source of truth for the alert pipeline's tunables and the external
// MOPH Prompt API endpoint. Centralized here so the sender, drain, and trigger
// sites never hardcode thresholds or URLs (constitution: no hardcoded
// conditions for data lookup / external calls).

/** MOPH Prompt "send via BMS session" endpoint. */
export function mophPromptApiUrl(): string {
  return (
    process.env.MOPH_PROMPT_API_URL?.trim() ||
    'https://sms.bmscloud.in.th/v1/moph/send-via-bms-session'
  );
}

/** Master switch. When false, producers enqueue nothing and the drain is a no-op. */
export function mophAlertsEnabled(): boolean {
  return process.env.MOPH_ALERTS_ENABLED !== 'false';
}

export interface MophAlertLimits {
  /** Max pending rows processed per drain invocation. */
  maxAlertsPerDrain: number;
  /** Per-send HTTP timeout (ms). */
  perSendTimeoutMs: number;
  /** Total drain budget (ms) — stop sending when exceeded, leave rest pending. */
  drainBudgetMs: number;
  /** Max 502 retries per row before giving up (row stays pending across drains
   *  until this per-attempt ceiling; after it, mark failed). */
  max502Retries: number;
  /** Base backoff (ms) for 502 retries — doubled per attempt. */
  retryBackoffMs: number;
  /** Retention window (days) for terminal (sent/failed) moph_alert_log rows.
   *  0 = keep forever. The drain purges rows older than this after each run. */
  retentionDays: number;
}

export function mophAlertLimits(): MophAlertLimits {
  return {
    maxAlertsPerDrain: numEnv('MOPH_MAX_ALERTS_PER_DRAIN', 5),
    perSendTimeoutMs: numEnv('MOPH_PER_SEND_TIMEOUT_MS', 3000),
    drainBudgetMs: numEnv('MOPH_DRAIN_BUDGET_MS', 10000),
    max502Retries: numEnv('MOPH_MAX_502_RETRIES', 4),
    retryBackoffMs: numEnv('MOPH_RETRY_BACKOFF_MS', 500),
    retentionDays: numEnv('MOPH_ALERT_RETENTION_DAYS', 90),
  };
}

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
