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
 * GetIPDVitalSignChart renders behind a global server-side lock — one shared
 * cached UI frame, rendered one request at a time. The first render after an
 * idle period can take several seconds, so this call gets a more generous
 * budget than the ordinary SQL/function timeout.
 */
export const CHART_TIMEOUT_MS = 90_000;

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
    | 'rest_timed_out'
    | 'chart_timed_out';

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
  const bearerToken = userInfo?.bms_session_code ?? result.key_value ?? (r as { jwt?: string }).jwt;
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
    const response = await fetch(`${config.apiUrl}/api/function?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

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
      throw new BmsClientError(
        'function_call_timed_out',
        'Function call timed out after 60 seconds.',
        {
          cause: error,
        },
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

/**
 * Result of {@link getIpdVitalSignChart}. Success carries the raw PNG blob;
 * an app-level failure carries the server's MessageCode plus an actionable
 * Thai message. Deterministic app-level errors (missing AN, no vital data,
 * unsupported build) are returned rather than thrown — retrying the exact
 * same (an, chart_type_id) against the serialized render endpoint won't help,
 * so we don't want SWR to retry. Transport-level failures (network, timeout,
 * HTTP 429) still throw so callers can retry those.
 */
export type IpdVitalSignChartResponse =
  { ok: true; blob: Blob } | { ok: false; messageCode: number | null; message: string };

/**
 * Map a GetIPDVitalSignChart app-level MessageCode to actionable Thai copy.
 * Known codes (per the API spec §5): 400 empty an · 401 auth · 404 wrong
 * method/empty name · 500 missing key / render error (AN not found, no vital
 * data) · 501 lite build (unsupported). Unknown codes fall back to the raw
 * server Message, then a generic message.
 */
function describeVitalSignChartError(messageCode: number | null, rawMessage: string): string {
  switch (messageCode) {
    case 400:
      return 'ไม่พบเลขที่รับผู้ป่วยใน (AN) — ไม่สามารถสร้างกราฟได้';
    case 401:
      return 'เซสชันหมดอายุ กรุณาเชื่อมต่อระบบใหม่อีกครั้ง';
    case 404:
      return 'เรียกใช้บริการสร้างกราฟไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ';
    case 500:
      return 'ยังไม่มีข้อมูลสัญญาณชีพสำหรับผู้ป่วยรายนี้ หรือไม่พบข้อมูลการรับผู้ป่วย (AN)';
    case 501:
      return 'เซิร์ฟเวอร์ HOSxP รุ่นนี้ไม่รองรับการสร้างกราฟสัญญาณชีพ';
    default:
      return rawMessage || 'สร้างกราฟสัญญาณชีพไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
  }
}

/**
 * Fetch a ready-to-use IPD vital-sign chart PNG from HOSxP's
 * GetIPDVitalSignChart function endpoint.
 *
 * The server renders the classic HOSxP paper chart (temperature/pulse dual
 * axis + respiration + blood pressure) and returns it as a PNG image, so the
 * browser no longer has to reconstruct the chart from raw nurse-note rows.
 *
 * Per the spec, the response is discriminated by Content-Type: `image/png`
 * bytes on success, otherwise a JSON error envelope carrying MessageCode +
 * Message. The render endpoint is serialized behind a global lock and caches
 * one frame per (an, begin_date), so requesting several chart_type_id pages
 * for the same AN is cheap.
 *
 * @param chartTypeId Chart page: 1 = header/summary, 2–7 = chart pages 1–6.
 */
export async function getIpdVitalSignChart(
  config: ConnectionConfig,
  an: string,
  chartTypeId: number,
  marketplaceToken?: string | null,
): Promise<IpdVitalSignChartResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHART_TIMEOUT_MS);
  try {
    const body: { an: string; chart_type_id: number; 'marketplace-token'?: string } = {
      an,
      chart_type_id: chartTypeId,
    };
    const mkt = resolveMarketplaceToken(marketplaceToken);
    if (mkt) {
      body['marketplace-token'] = mkt;
    }

    const response = await fetch(`${config.apiUrl}/api/function?name=GetIPDVitalSignChart`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    // Rate limiting is transient — throw so callers can retry after a wait.
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const suffix = retryAfter ? ` กรุณารอ ${retryAfter} วินาทีแล้วลองใหม่` : '';
      throw new BmsClientError(
        'rate_limited',
        `มีการร้องขอบ่อยเกินไป (HTTP 429).${suffix} กรุณารอสักครู่แล้วลองใหม่อีกครั้ง`,
      );
    }

    // Success vs. error is decided by Content-Type (spec §6), NOT HTTP status —
    // the app-level MessageCode may not equal the HTTP status.
    const contentType = (response.headers.get('Content-Type') ?? '').toLowerCase();
    if (contentType.startsWith('image/png')) {
      return { ok: true, blob: await response.blob() };
    }

    // Error envelope — JSON per the spec. Parse defensively: a lite build or
    // gateway may return a non-JSON body, in which case fall back to the HTTP
    // status so the caller still gets a stable, mapped Thai message.
    let messageCode: number | null = null;
    let rawMessage = '';
    try {
      const parsed = (await response.json()) as { MessageCode?: unknown; Message?: unknown };
      if (typeof parsed.MessageCode === 'number') messageCode = parsed.MessageCode;
      if (typeof parsed.Message === 'string') rawMessage = parsed.Message;
    } catch {
      // non-JSON body
    }
    if (messageCode === null) messageCode = response.status || null;
    return {
      ok: false,
      messageCode,
      message: describeVitalSignChartError(messageCode, rawMessage),
    };
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new BmsClientError(
        'chart_timed_out',
        'สร้างกราฟสัญญาณชีพหมดเวลา (ใช้เวลานานเกินไป) กรุณาลองใหม่อีกครั้ง',
        { cause: error },
      );
    }
    if (error instanceof BmsClientError) throw error;
    throw new Error('ไม่สามารถเชื่อมต่อบริการสร้างกราฟสัญญาณชีพได้ กรุณาตรวจสอบการเชื่อมต่อ', {
      cause: error,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fast-fail timeout for a patient photo. A face thumbnail is a non-critical
 * decoration, so we don't want a slow/hung blob read to stall the ward view.
 */
export const PATIENT_PHOTO_TIMEOUT_MS = 15_000;

/**
 * Result of {@link getPatientPhoto}. A patient photo is decorative, so every
 * failure mode (missing row, NULL blob, auth, network) collapses to a single
 * `{ ok: false, status }` that callers render as a neutral placeholder —
 * `status` is the HTTP status (or 0 for a network/timeout failure).
 */
export type PatientPhotoResponse = { ok: true; blob: Blob } | { ok: false; status: number };

export interface PatientPhotoOptions {
  /** Requested pixel width. Server only resizes JPEG-encoded blobs (spec §3). */
  width?: number;
  /** Requested pixel height. */
  height?: number;
  marketplaceToken?: string | null;
}

/**
 * Fetch a patient's face photo from HOSxP's REST BLOB endpoint, keyed by HN.
 *
 * Hits `GET /api/rest/patient_image/{hn}?field=image&responseType=jpg[&width&height]`
 * (composite PK `hn,image_name`; discovery keys on `hn` and returns the first
 * row, so a specific `image_name` can't be selected here — that's the
 * `patient_photo` route's job). `responseType`/`width`/`height` only apply to
 * JPEG-encoded blobs; non-JPEG blobs come back at their original size.
 *
 * Never throws: a photo is optional, so a missing row (404), a non-BLOB field
 * (400), an auth failure (401), or a network error all resolve to
 * `{ ok: false, status }` so the caller shows a placeholder rather than an
 * error.
 */
export async function getPatientPhoto(
  config: ConnectionConfig,
  hn: string,
  options: PatientPhotoOptions = {},
): Promise<PatientPhotoResponse> {
  const { width, height, marketplaceToken } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PATIENT_PHOTO_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ field: 'image', responseType: 'jpg' });
    if (width && width > 0) params.set('width', String(Math.round(width)));
    if (height && height > 0) params.set('height', String(Math.round(height)));
    const mkt = resolveMarketplaceToken(marketplaceToken);
    // GET has no body, so the token rides the query string (matches restDelete).
    if (mkt) params.set('marketplace-token', mkt);

    const url = `${config.apiUrl}/api/rest/patient_image/${encodeURIComponent(hn)}?${params.toString()}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.bearerToken}` },
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, status: response.status };
    }
    return { ok: true, blob: await response.blob() };
  } catch {
    // Network error or timeout — degrade quietly to the placeholder.
    return { ok: false, status: 0 };
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
      throw new BmsClientError(
        'rest_timed_out',
        `REST insert timed out after ${QUERY_TIMEOUT_MS / 1000}s`,
        {
          cause: error,
        },
      );
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
      throw new BmsClientError(
        'rest_timed_out',
        `REST update timed out after ${QUERY_TIMEOUT_MS / 1000}s`,
        {
          cause: error,
        },
      );
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
      throw new BmsClientError(
        'rest_timed_out',
        `REST delete timed out after ${QUERY_TIMEOUT_MS / 1000}s`,
        {
          cause: error,
        },
      );
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
