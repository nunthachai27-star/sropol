import type {
  BmsSessionResponse,
  ConnectionConfig,
  SqlApiResponse,
  SqlParams,
  UserInfo,
} from '@/types/bms-browser';

export const PASTE_JSON_URL = 'https://hosxp.net/phapi/PasteJSON';
export const APP_IDENTIFIER = 'KK-LRMS.Web';
export const SESSION_TIMEOUT_MS = 30_000;
export const QUERY_TIMEOUT_MS = 60_000;

export async function retrieveBmsSession(sessionId: string): Promise<BmsSessionResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
  try {
    const response = await fetch(PASTE_JSON_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
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

export function extractConnectionConfig(r: BmsSessionResponse): ConnectionConfig {
  if (!r.jwt) throw new Error('BMS session response missing jwt');
  if (!r.bms_url) throw new Error('BMS session response missing bms_url');
  return {
    apiUrl: r.bms_url.replace(/\/$/, ''),
    bearerToken: r.jwt,
    appIdentifier: APP_IDENTIFIER,
  };
}

export function extractUserInfo(r: BmsSessionResponse): UserInfo {
  const ui = (r.user_info ?? {}) as Record<string, unknown>;
  return {
    loginname: String(ui.loginname ?? ui.username ?? ''),
    fullname: String(ui.fullname ?? ui.name ?? ''),
    hospcode: String(ui.hospcode ?? ui.hospital_code ?? ''),
    ...ui,
  };
}

export async function executeSql<T = Record<string, unknown>>(
  sql: string,
  config: ConnectionConfig,
  params?: SqlParams,
): Promise<SqlApiResponse<T>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const body: { sql: string; app: string; params?: SqlParams } = {
      sql,
      app: config.appIdentifier,
    };
    if (params && Object.keys(params).length > 0) body.params = params;

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
      throw new Error(
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
        throw new Error('Session unauthorized. Please reconnect with a valid session ID.');
      }
      const detail = parsed.Message || `MessageCode ${parsed.MessageCode}`;
      throw new Error(`Database error: ${detail}`);
    }

    if (response.status === 501) {
      console.warn('[bms-browser-client] /api/sql HTTP 501 without parseable MessageCode');
      throw new Error('Session unauthorized. Please reconnect with a valid session ID.');
    }
    if (!response.ok) {
      throw new Error(`SQL API returned HTTP ${response.status}: ${response.statusText}`);
    }
    return parsed ?? ((await response.json()) as SqlApiResponse<T>);
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Query timed out after 60 seconds. Try a simpler query.', { cause: error });
    }
    if (
      error instanceof Error &&
      (error.message.startsWith('Session unauthorized') ||
        error.message.startsWith('Database error') ||
        error.message.startsWith('SQL API returned') ||
        error.message.startsWith('Query timed out') ||
        error.message.startsWith('มีการร้องขอบ่อยเกินไป'))
    ) {
      throw error;
    }
    throw new Error('Unable to connect to the BMS API. Please check your connection.', {
      cause: error,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
