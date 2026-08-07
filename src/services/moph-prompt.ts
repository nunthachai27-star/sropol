// MOPH Prompt (LINE Official Account) sender client.
//
// Thin typed wrapper around the external "send via BMS session" endpoint:
//   POST https://sms.bmscloud.in.th/v1/moph/send-via-bms-session
//   Authorization: Bearer <bms-session-id>   (per-hospital; resolved by caller)
//   Body: { cid (13-digit recipient), title, text, confirm_url?, service_id?, flex? }
// hospital_code/hospital_name are resolved SERVER-SIDE from the session and are
// therefore NEVER included in the request body.
//
// Retry policy: 502 only (session/JWT transiently unresolvable), exponential
// backoff up to MOPH_MAX_502_RETRIES. 400/401/422 are terminal. Timeouts are
// treated as retryable (like 502) since the drain loop must stay bounded.
//
// This module performs NO audit write — the authoritative per-recipient record
// lives in moph_alert_log (see risk-alert.ts / moph-alert-drain.ts). Keeping
// audit out of the sender avoids the dual-audit divergence risk (codex #6b).

import { logger } from '@/lib/logger';
import { mophPromptApiUrl, mophAlertLimits } from '@/config/moph-alert-config';

/** A bare LINE Flex bubble/carousel OR full envelope; passed through verbatim. */
export type MophFlex = Record<string, unknown>;

export interface SendMophPromptInput {
  /** Per-hospital BMS session id — used as the Bearer token. */
  sessionId: string;
  /** Recipient Thai Citizen ID — exactly 13 digits, validated before send. */
  cid: string;
  /** LINE altText + audit title. */
  title: string;
  /** Body text (used unless `flex` is given). */
  text: string;
  /** Optional action-button URL in the Flex footer. */
  confirmUrl?: string | null;
  /** Optional MophPrompt service_id override. */
  serviceId?: string | null;
  /** Optional custom LINE Flex override (full envelope or bare bubble). */
  flex?: MophFlex | null;
}

export interface MophPromptResponse {
  messageId: string | null;
  hospitalCode: string | null;
  hospitalName: string | null;
  line: { success: boolean; status: 'success' | 'failed' | 'skipped' };
}

export type MophPromptErrorCode =
  | 'INVALID_CID' // 400-equivalent: caller-side cid validation
  | 'AUTH' // 401
  | 'VALIDATION' // 422
  | 'CLIENT_ERROR' // 400 from server (non-cid) or other 4xx, terminal
  | 'RETRYABLE' // 502 / timeout, retries remain
  | 'RETRYABLE_EXHAUSTED'; // 502/timeout after max retries

export class MophPromptError extends Error {
  readonly code: MophPromptErrorCode;
  readonly statusCode: number;
  constructor(code: MophPromptErrorCode, message: string, statusCode = 0) {
    super(message);
    this.name = 'MophPromptError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const CID_RE = /^\d{13}$/;

/** Validates a Thai CID is exactly 13 digits (the API returns 400 otherwise). */
export function isValidCid(cid: string): boolean {
  return CID_RE.test(cid);
}

interface RawApiResponse {
  message_id?: string | null;
  hospital_code?: string | null;
  hospital_name?: string | null;
  line?: { success?: boolean; status?: string } | null;
}

function parseResponse(raw: RawApiResponse): MophPromptResponse {
  const status = (raw.line?.status ?? 'failed') as MophPromptResponse['line']['status'];
  const allowed: MophPromptResponse['line']['status'][] = ['success', 'failed', 'skipped'];
  return {
    messageId: raw.message_id ?? null,
    hospitalCode: raw.hospital_code ?? null,
    hospitalName: raw.hospital_name ?? null,
    line: {
      success: raw.line?.success ?? false,
      status: allowed.includes(status) ? status : 'failed',
    },
  };
}

function buildBody(input: SendMophPromptInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    cid: input.cid,
    title: input.title,
    text: input.text,
  };
  if (input.confirmUrl) body.confirm_url = input.confirmUrl;
  if (input.serviceId) body.service_id = input.serviceId;
  if (input.flex) body.flex = input.flex;
  // Intentionally NEVER set hospital_code / hospital_name — resolved by server
  // from the Bearer session. Sending them would be ignored at best and a
  // contract violation at worst.
  return body;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a single MOPH Prompt message. Resolves with the parsed API response on
 * HTTP 200 (regardless of `line.status`, which may be success|failed|skipped).
 * Rejects with {@link MophPromptError} for 4xx (terminal) or exhausted 502/timeout.
 */
export async function sendMophPrompt(input: SendMophPromptInput): Promise<MophPromptResponse> {
  if (!isValidCid(input.cid)) {
    throw new MophPromptError(
      'INVALID_CID',
      `cid must be exactly 13 digits (got length ${input.cid.length})`,
      400,
    );
  }
  const url = mophPromptApiUrl();
  const { max502Retries, retryBackoffMs, perSendTimeoutMs } = mophAlertLimits();
  const body = buildBody(input);

  let attempt = 0;
  // total attempts = 1 initial + max502Retries retries
  for (let remaining = max502Retries; ; remaining--) {
    attempt++;
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.sessionId}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(perSendTimeoutMs),
      });
    } catch (err) {
      // Timeout / network — retryable, same bucket as 502.
      const isLast = remaining <= 0;
      if (isLast) {
        logger.warn('moph_prompt_timeout_exhausted', { attempt });
        throw new MophPromptError(
          'RETRYABLE_EXHAUSTED',
          `send timed out after ${attempt} attempts`,
          0,
        );
      }
      logger.debug('moph_prompt_timeout_retry', { attempt });
      await sleep(retryBackoffMs * 2 ** (attempt - 1));
      continue;
    }

    if (resp.status === 200) {
      const raw = (await resp.json().catch(() => ({}))) as RawApiResponse;
      return parseResponse(raw);
    }

    // 4xx — terminal, no retry.
    if (resp.status === 401) {
      throw new MophPromptError('AUTH', `401 Unauthorized: missing/invalid bearer`, 401);
    }
    if (resp.status === 422) {
      throw new MophPromptError('VALIDATION', `422 body validation error`, 422);
    }
    if (resp.status >= 400 && resp.status < 500) {
      throw new MophPromptError('CLIENT_ERROR', `${resp.status} client error`, resp.status);
    }

    // 5xx (502 expected) — retryable.
    const isLast = remaining <= 0;
    if (isLast) {
      logger.warn('moph_prompt_502_exhausted', { attempt, status: resp.status });
      throw new MophPromptError(
        'RETRYABLE_EXHAUSTED',
        `${resp.status} after ${attempt} attempts`,
        resp.status,
      );
    }
    logger.debug('moph_prompt_502_retry', { attempt, status: resp.status });
    await sleep(retryBackoffMs * 2 ** (attempt - 1));
  }
}
