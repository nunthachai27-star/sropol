import type {
  BmsFunctionResponse,
  BmsSessionResponse,
  ConnectionConfig,
  RestApiResponse,
  SqlApiResponse,
  SqlParams,
  UserInfo,
} from '@/types/bms-browser';

export const PASTE_JSON_URL = 'https://hosxp.net/phapi/PasteJSON';
export const APP_IDENTIFIER = 'KK-LRMS.Web';
export const SESSION_TIMEOUT_MS = 30_000;
export const QUERY_TIMEOUT_MS = 60_000;

/**
 * Local HOSxP API gateway URL. The HOSxP marketplace gateway commonly runs
 * on the same workstation that the user opens KK-LRMS from (the BMS bundle
 * binds 127.0.0.1:45011 by default). When reachable, we swap the remote
 * tunnel URL out for the local one to avoid the Cloudflare-tunnel hop —
 * cuts ~50–300 ms off every browser-initiated SQL/REST call (live ward
 * view, partograph save, vital-sign save, etc.).
 *
 * Ported from bms-session-id-blank-template/src/services/bmsSession.ts.
 */
export const LOCAL_API_URL = 'http://127.0.0.1:45011';

/** Fast-fail timeout for the local-API probe so we don't block session
 *  ready when the gateway isn't running locally. */
export const LOCAL_PROBE_TIMEOUT_MS = 3_000;

// ---------------------------------------------------------------------------
// Active marketplace-token singleton
// ---------------------------------------------------------------------------
//
// BMS tunnel endpoints (/api/sql, /api/rest) accept an optional
// `marketplace-token` to unlock READ/READWRITE scopes the session alone may
// lack. Callers don't always have easy access to the token (it's launched via
// URL, stored in localStorage, read inside React context), so we mirror
// hosxp-telemed's `resolveMarketplaceToken` pattern: keep the current token in
// a module-level variable that the BmsSessionProvider publishes on mount,
// and fall back to it when an explicit argument isn't passed.
//
// This avoids threading `marketplaceToken` through every maternity-ward
// service call site while keeping the explicit-override path for tests.
let activeMarketplaceToken: string | null = null;

export function setActiveMarketplaceToken(token: string | null | undefined): void {
  activeMarketplaceToken = token && token.length > 0 ? token : null;
}

export function getActiveMarketplaceToken(): string | null {
  return activeMarketplaceToken;
}

function resolveMarketplaceToken(explicit?: string | null): string | null {
  if (explicit && explicit.length > 0) return explicit;
  return activeMarketplaceToken;
}

/**
 * Private tagged error used to mark thrown errors that originated inside the
 * BMS client and must be re-thrown verbatim by the outer try/catch (rather
 * than being wrapped in the generic "Unable to connect" fallback).
 *
 * NOT exported: callers continue to receive plain `Error` instances (since
 * `BmsClientError extends Error`) with the same `.message` text as before —
 * this is purely an internal control-flow tag that replaces the previous
 * fragile `error.message.startsWith(...)` allowlist + sentinel-string trick.
 */
class BmsClientError extends Error {
  readonly kind:
    | 'session_unauthorized'
    | 'function_api_returned'
    | 'function_call_timed_out'
    | 'sql_api_returned'
    | 'database_error'
    | 'query_timed_out'
    | 'rate_limited'
    | 'body_error'
    | 'rest_failed'
    | 'rest_timed_out';

  constructor(kind: BmsClientError['kind'], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BmsClientError';
    this.kind = kind;
  }
}

export async function retrieveBmsSession(sessionId: string): Promise<BmsSessionResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
  try {
    // PasteJSON expects GET with ?Action=GET&code=<sid>; cache-bust with _ to
    // defeat any intermediate HTTP caching. POST + JSON body returns a 200
    // with a non-actionable payload that lacks the result.user_info envelope.
    const url = `${PASTE_JSON_URL}?Action=GET&code=${encodeURIComponent(sessionId)}&_=${Date.now()}`;
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(
        `BMS session retrieval failed (HTTP ${response.status}): ${detail.slice(0, 200)}`,
      );
    }
    return (await response.json()) as BmsSessionResponse;
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('BMS session retrieval timed out after 30 seconds');
    }
    if (error instanceof Error && error.message.startsWith('BMS session retrieval')) throw error;
    throw new Error(`Cannot connect to BMS session API: ${(error as Error).message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

// PasteJSON wraps the connection details in `result.user_info`. The bearer
// token is `bms_session_code` (preferred) or `key_value` (fallback). Top-level
// `jwt`/`bms_url` are NOT present — earlier port read from those and crashed
// at runtime with "missing jwt".
type RawUserInfo = {
  bms_url?: string;
  bms_session_code?: string;
  loginname?: string;
  username?: string;
  fullname?: string;
  name?: string;
  hospcode?: string;
  hospital_code?: string;
  [key: string]: unknown;
};
type RawResult = {
  user_info?: RawUserInfo;
  key_value?: string;
  [key: string]: unknown;
};

function readResult(r: BmsSessionResponse): RawResult {
  // Accept either `r.result.user_info...` (PasteJSON) or top-level fields
  // (test fixtures). Top-level wins only when result is absent.
  return (r.result as RawResult | undefined) ?? (r as unknown as RawResult);
}

export function extractConnectionConfig(r: BmsSessionResponse): ConnectionConfig {
  const result = readResult(r);
  const userInfo = result.user_info;
  const apiUrl = userInfo?.bms_url ?? (r as { bms_url?: string }).bms_url;
  if (!apiUrl) {
    throw new Error('BMS session response missing bms_url');
  }
  const bearerToken =
    userInfo?.bms_session_code ?? result.key_value ?? (r as { jwt?: string }).jwt;
  if (!bearerToken) {
    throw new Error('BMS session response missing bearer token (bms_session_code/key_value)');
  }
  return {
    apiUrl: apiUrl.replace(/\/$/, ''),
    bearerToken,
    appIdentifier: APP_IDENTIFIER,
  };
}

export function extractUserInfo(r: BmsSessionResponse): UserInfo {
  const result = readResult(r);
  const ui = (result.user_info ?? (r.user_info as RawUserInfo | undefined) ?? {}) as RawUserInfo;
  return {
    loginname: String(ui.loginname ?? ui.username ?? ''),
    fullname: String(ui.fullname ?? ui.name ?? ''),
    hospcode: String(ui.hospcode ?? ui.hospital_code ?? ''),
    ...ui,
  };
}

/**
 * Wrap raw param values into the typed shape BMS requires:
 *   `{ name: <val> }` → `{ name: { value: <val>, value_type: 'string'|'integer'|... } }`
 *
 * BMS rejects untyped/primitive params with `409 "Invalid variant operation"`
 * (verified live). Already-wrapped `{value, value_type}` entries pass through.
 *
 * Type detection follows Pascal/Delphi conventions:
 *   - boolean → 'string' ('Y'/'N' is the HOSxP convention; raw bool is rare)
 *   - integer (Number.isInteger) → 'integer'
 *   - other number → 'float'
 *   - Date → 'datetime' (ISO string)
 *   - everything else (string, null) → 'string'
 */
function wrapBmsParams(raw: SqlParams): Record<string, { value: unknown; value_type: string }> {
  const out: Record<string, { value: unknown; value_type: string }> = {};
  for (const [key, v] of Object.entries(raw)) {
    if (
      v !== null &&
      typeof v === 'object' &&
      'value' in (v as object) &&
      'value_type' in (v as object)
    ) {
      out[key] = v as { value: unknown; value_type: string };
      continue;
    }
    if (typeof v === 'number') {
      out[key] = { value: v, value_type: Number.isInteger(v) ? 'integer' : 'float' };
    } else if (v instanceof Date) {
      out[key] = { value: v.toISOString(), value_type: 'datetime' };
    } else {
      // string | null | boolean | undefined → coerce to string
      out[key] = { value: v == null ? null : String(v), value_type: 'string' };
    }
  }
  return out;
}

export async function executeSql<T = Record<string, unknown>>(
  sql: string,
  config: ConnectionConfig,
  params?: SqlParams,
  marketplaceToken?: string | null,
): Promise<SqlApiResponse<T>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const body: {
      sql: string;
      app: string;
      params?: Record<string, { value: unknown; value_type: string }>;
      'marketplace-token'?: string;
    } = {
      sql,
      app: config.appIdentifier,
    };
    if (params && Object.keys(params).length > 0) {
      body.params = wrapBmsParams(params);
    }
    const mkt = resolveMarketplaceToken(marketplaceToken);
    if (mkt) {
      body['marketplace-token'] = mkt;
    }

    const response = await fetch(`${config.apiUrl}/api/sql`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      let detail = '';
      try {
        const j = (await response.json()) as { message?: string; error?: string };
        detail = j.message || j.error || '';
      } catch {
        // ignore
      }
      const suffix = detail
        ? `: ${detail}`
        : retryAfter
          ? ` กรุณารอ ${retryAfter} วินาทีแล้วลองใหม่`
          : '';
      throw new BmsClientError(
        'rate_limited',
        `มีการร้องขอบ่อยเกินไป (HTTP 429).${suffix} กรุณารอสักครู่แล้วลองใหม่อีกครั้ง`,
      );
    }

    // BMS tunnel uses HTTP 501 for several distinct failures (auth errors,
    // SQL errors, concurrency races). The real error lives in the JSON body's
    // Message/MessageCode fields, so we always try to parse the body first
    // and distinguish the cases before falling back to generic handling.
    let parsed: SqlApiResponse<T> | null = null;
    try {
      parsed = (await response.clone().json()) as SqlApiResponse<T>;
    } catch {
      // not JSON
    }

    if (parsed && typeof parsed.MessageCode === 'number' && parsed.MessageCode !== 200) {
      console.warn(
        '[bms-browser-client] /api/sql non-200',
        'httpStatus=' + response.status,
        'MessageCode=' + parsed.MessageCode,
        'Message=' + JSON.stringify(parsed.Message ?? null),
      );
      if (parsed.MessageCode === 401) {
        throw new BmsClientError(
          'session_unauthorized',
          'Session unauthorized. Please reconnect with a valid session ID.',
        );
      }
      const detail = parsed.Message || `MessageCode ${parsed.MessageCode}`;
      throw new BmsClientError('database_error', `Database error: ${detail}`);
    }

    if (response.status === 501) {
      console.warn('[bms-browser-client] /api/sql HTTP 501 without parseable MessageCode');
      throw new BmsClientError(
        'session_unauthorized',
        'Session unauthorized. Please reconnect with a valid session ID.',
      );
    }
    if (!response.ok) {
      throw new BmsClientError(
        'sql_api_returned',
        `SQL API returned HTTP ${response.status}: ${response.statusText}`,
      );
    }
    return parsed ?? ((await response.json()) as SqlApiResponse<T>);
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new BmsClientError(
        'query_timed_out',
        'Query timed out after 60 seconds. Try a simpler query.',
        { cause: error },
      );
    }
    if (error instanceof BmsClientError) throw error;
    throw new Error('Unable to connect to the BMS API. Please check your connection.', {
      cause: error,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function callFunction<T = BmsFunctionResponse>(
  name: string,
  config: ConnectionConfig,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${config.apiUrl}/api/function?name=${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.bearerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );

    if (response.status === 429) {
      let retryInfo = '';
      const retryAfter = response.headers.get('Retry-After');
      if (retryAfter) {
        retryInfo = ` กรุณารอ ${retryAfter} วินาทีแล้วลองใหม่`;
      }
      try {
        const errorData = (await response.json()) as { message?: string; error?: string };
        const detail = errorData.message || errorData.error;
        if (detail) {
          retryInfo = `: ${detail}`;
        }
      } catch {
        // ignore JSON parse errors
      }
      throw new BmsClientError(
        'rate_limited',
        `มีการร้องขอบ่อยเกินไป (HTTP 429).${retryInfo} กรุณารอสักครู่แล้วลองใหม่อีกครั้ง`,
      );
    }

    if (response.status === 501) {
      throw new BmsClientError(
        'session_unauthorized',
        'Session unauthorized. Please reconnect with a valid session ID.',
      );
    }

    if (!response.ok) {
      throw new BmsClientError(
        'function_api_returned',
        `Function API returned HTTP ${response.status}: ${response.statusText}`,
      );
    }

    const result = (await response.json()) as BmsFunctionResponse;
    // Some BMS functions return 200 HTTP but error in body (e.g. MessageCode 500).
    // The body Message is preserved verbatim — even if it happens to contain
    // substrings like "Session unauthorized" — because the catch block uses
    // `instanceof BmsClientError` to identify pass-through errors instead of
    // matching on `.message` text.
    if (result.MessageCode && result.MessageCode >= 400 && result.Message) {
      throw new BmsClientError('body_error', result.Message);
    }
    return result as T;
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new BmsClientError('function_call_timed_out', 'Function call timed out after 60 seconds.', {
        cause: error,
      });
    }

    if (error instanceof BmsClientError) throw error;

    throw new Error('Unable to connect to the BMS API. Please check your connection.', {
      cause: error,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Extract a human-readable error message from a non-OK REST response.
 * Tries JSON body first (Message/message/errors), then plain text, then statusText.
 */
async function extractRestErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as {
      Message?: unknown;
      message?: unknown;
      errors?: unknown;
      Errors?: unknown;
    };
    const head = body?.Message ?? body?.message;
    const errorsArr = body?.errors ?? body?.Errors;
    const errorList = Array.isArray(errorsArr) ? errorsArr.map((e) => String(e)).join('; ') : '';
    const headText = typeof head === 'string' ? head : head == null ? '' : JSON.stringify(head);
    if (headText && errorList) return `${headText}: ${errorList}`;
    if (errorList) return errorList;
    if (headText) return headText;
    return JSON.stringify(body);
  } catch {
    try {
      const text = await response.text();
      if (text) return text.slice(0, 500);
    } catch {
      // ignore
    }
    return response.statusText || `HTTP ${response.status}`;
  }
}

export async function restInsert(
  table: string,
  data: Record<string, unknown>,
  config: ConnectionConfig,
  marketplaceToken?: string | null,
): Promise<RestApiResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const url = `${config.apiUrl}/api/rest/${encodeURIComponent(table)}`;
    const mkt = resolveMarketplaceToken(marketplaceToken);
    const body = mkt ? { 'marketplace-token': mkt, ...data } : data;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const msg = await extractRestErrorMessage(response);
      throw new BmsClientError('rest_failed', `REST POST ${table}: ${msg}`);
    }
    return (await response.json()) as RestApiResponse;
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new BmsClientError('rest_timed_out', `REST insert timed out after ${QUERY_TIMEOUT_MS / 1000}s`, {
        cause: error,
      });
    }
    if (error instanceof BmsClientError) throw error;
    throw new Error('Unable to connect to the BMS REST API.', { cause: error });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function restUpdate(
  table: string,
  resourceId: string | number,
  data: Record<string, unknown>,
  config: ConnectionConfig,
  marketplaceToken?: string | null,
): Promise<RestApiResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const url = `${config.apiUrl}/api/rest/${encodeURIComponent(table)}/${encodeURIComponent(String(resourceId))}`;
    const mkt = resolveMarketplaceToken(marketplaceToken);
    const body = mkt ? { 'marketplace-token': mkt, ...data } : data;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${config.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const msg = await extractRestErrorMessage(response);
      throw new BmsClientError('rest_failed', `REST PUT ${table}/${resourceId}: ${msg}`);
    }
    return (await response.json()) as RestApiResponse;
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new BmsClientError('rest_timed_out', `REST update timed out after ${QUERY_TIMEOUT_MS / 1000}s`, {
        cause: error,
      });
    }
    if (error instanceof BmsClientError) throw error;
    throw new Error('Unable to connect to the BMS REST API.', { cause: error });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function restDelete(
  table: string,
  resourceId: string | number,
  config: ConnectionConfig,
  marketplaceToken?: string | null,
): Promise<RestApiResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    let url = `${config.apiUrl}/api/rest/${encodeURIComponent(table)}/${encodeURIComponent(String(resourceId))}`;
    const mkt = resolveMarketplaceToken(marketplaceToken);
    if (mkt) {
      url += `?marketplace-token=${encodeURIComponent(mkt)}`;
    }
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${config.bearerToken}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const msg = await extractRestErrorMessage(response);
      throw new BmsClientError('rest_failed', `REST DELETE ${table}/${resourceId}: ${msg}`);
    }
    return (await response.json()) as RestApiResponse;
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new BmsClientError('rest_timed_out', `REST delete timed out after ${QUERY_TIMEOUT_MS / 1000}s`, {
        cause: error,
      });
    }
    if (error instanceof BmsClientError) throw error;
    throw new Error('Unable to connect to the BMS REST API.', { cause: error });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Probe the local HOSxP API gateway at {@link LOCAL_API_URL}. When reachable,
 * returns a new {@link ConnectionConfig} pointing at the local URL so
 * subsequent SQL/REST calls bypass the remote tunnel.
 *
 * The probe POSTs `SELECT 1` with the same auth headers the real
 * {@link executeSql} uses — same shape, same MessageCode contract — so a
 * 200 success here proves the local gateway can also serve real queries.
 *
 * Timeout is short (3s) and any error path (network, CORS preflight,
 * abort, body parse) silently falls back to the remote config. Callers
 * can ignore the `isLocal` boolean if they only care about the URL swap.
 *
 * Ported from bms-session-id-blank-template/src/services/bmsSession.ts.
 */
export async function probeLocalApi(
  config: ConnectionConfig,
  marketplaceToken?: string | null,
): Promise<{ config: ConnectionConfig; isLocal: boolean }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOCAL_PROBE_TIMEOUT_MS);
  try {
    const body: {
      sql: string;
      app: string;
      'marketplace-token'?: string;
    } = {
      sql: 'SELECT 1 as test',
      app: config.appIdentifier,
    };
    const mkt = resolveMarketplaceToken(marketplaceToken);
    if (mkt) body['marketplace-token'] = mkt;

    const response = await fetch(`${LOCAL_API_URL}/api/sql`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (response.ok) {
      const data = (await response.json()) as SqlApiResponse;
      if (data.MessageCode === 200) {
        // eslint-disable-next-line no-console
        console.info(
          `[bms-browser-client] Local API detected at ${LOCAL_API_URL} — swapping apiUrl for browser-side calls`,
        );
        return {
          config: { ...config, apiUrl: LOCAL_API_URL },
          isLocal: true,
        };
      }
    }
  } catch {
    // Local API not available (network error, timeout, CORS preflight
    // failure, or body parse). Fall through to remote-tunnel fallback.
  } finally {
    clearTimeout(timeoutId);
  }

  return { config, isLocal: false };
}
