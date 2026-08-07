// T035: BmsSessionClient — handles BMS Session API communication

import type {
  BmsQueryResult,
  BmsValidateResponse,
  SessionConfig,
  BmsApiError,
} from '@/types/bms-session';
import type { DatabaseDialect } from '@/config/hosxp-queries';
import type { DatabaseAdapter } from '@/db/adapter';
import { logger } from '@/lib/logger';

export class BmsApiErrorClass extends Error {
  code: BmsApiError['code'];
  statusCode: number;
  details?: unknown;

  constructor(error: BmsApiError) {
    super(error.message);
    this.name = 'BmsApiError';
    this.code = error.code;
    this.statusCode = error.statusCode;
    this.details = error.details;
  }
}

// Classifies a raw transport failure (thrown by fetch or response.json())
// into a truthful BmsApiError. Previously every non-HTTP failure — DNS,
// refused connections, TLS, malformed JSON — was flattened to TIMEOUT in
// some call sites and CONNECTION_ERROR in others, regardless of cause.
function classifyTransportError(error: unknown): BmsApiError {
  const err = error as Error & { cause?: { code?: string } };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return { code: 'TIMEOUT', message: `Request timed out: ${err.message}`, statusCode: 0 };
  }
  const causeCode = String(err?.cause?.code ?? '');
  const detail =
    causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN'
      ? 'DNS lookup failed'
      : causeCode === 'ECONNREFUSED'
        ? 'connection refused'
        : causeCode.startsWith('ERR_TLS') ||
            causeCode === 'CERT_HAS_EXPIRED' ||
            causeCode === 'DEPTH_ZERO_SELF_SIGNED_CERT'
          ? 'TLS error'
          : err instanceof SyntaxError
            ? 'invalid JSON response'
            : 'network error';
  return {
    code: 'CONNECTION_ERROR',
    message: `${detail}: ${err?.message ?? String(error)}`,
    statusCode: 0,
  };
}

export class BmsSessionClient {
  private tunnelUrl: string;

  constructor(tunnelUrl: string) {
    this.tunnelUrl = tunnelUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  async getSessionId(): Promise<string> {
    const url = `${this.tunnelUrl}/api/SessionID`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        throw new BmsApiErrorClass({
          code: 'CONNECTION_ERROR',
          message: `Failed to get session ID: ${response.statusText}`,
          statusCode: response.status,
        });
      }
      const sessionId = await response.json();
      return typeof sessionId === 'string' ? sessionId : String(sessionId);
    } catch (error) {
      if (error instanceof BmsApiErrorClass) throw error;
      throw new BmsApiErrorClass(classifyTransportError(error));
    }
  }

  async validateSession(sessionId: string, validateUrl: string): Promise<SessionConfig> {
    try {
      const response = await fetch(validateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const code = response.status === 501 ? 'UNAUTHORIZED' : 'CONNECTION_ERROR';
        throw new BmsApiErrorClass({
          code,
          message: `Session validation failed: ${response.statusText}`,
          statusCode: response.status,
        });
      }

      const data: BmsValidateResponse = await response.json();
      return {
        sessionId,
        jwt: data.jwt,
        bmsUrl: data.bms_url,
        userInfo: data.user_info,
        expiresAt: new Date(Date.now() + data.expired_second * 1000),
        expiredSecond: data.expired_second,
      };
    } catch (error) {
      if (error instanceof BmsApiErrorClass) throw error;
      throw new BmsApiErrorClass(classifyTransportError(error));
    }
  }

  async executeQuery(
    sql: string,
    bmsUrl: string,
    jwt: string,
    params?: Record<string, unknown>,
    options?: {
      marketplaceToken?: string | null;
      appIdentifier?: string;
    },
  ): Promise<BmsQueryResult> {
    const url = `${bmsUrl}/api/sql`;
    try {
      const body: Record<string, unknown> = { sql };
      if (params) body.params = params;
      if (options?.appIdentifier) body.app = options.appIdentifier;
      if (options?.marketplaceToken) body['marketplace-token'] = options.marketplaceToken;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const code =
          response.status === 501
            ? 'UNAUTHORIZED'
            : response.status === 409
              ? 'SQL_ERROR'
              : 'CONNECTION_ERROR';
        throw new BmsApiErrorClass({
          code,
          message: `SQL query failed: ${response.statusText}`,
          statusCode: response.status,
        });
      }

      return await response.json();
    } catch (error) {
      if (error instanceof BmsApiErrorClass) throw error;
      throw new BmsApiErrorClass(classifyTransportError(error));
    }
  }

  // Detects the HOSxP database dialect by running a version query. Returns
  // null (never a guessed dialect) when detection fails for any reason —
  // callers must treat null as "unknown" and ask for an explicit dialect
  // rather than silently persisting a wrong guess.
  async getDatabaseType(
    bmsUrl: string,
    jwt: string,
    options?: { marketplaceToken?: string | null; appIdentifier?: string },
  ): Promise<DatabaseDialect | null> {
    try {
      const result = await this.executeQuery('SELECT version()', bmsUrl, jwt, undefined, options);
      const first = result.data[0] ?? {};
      const version = String(
        first['version()'] ?? first.version ?? Object.values(first)[0] ?? '',
      ).toLowerCase();
      return version.includes('postgresql') ? 'postgresql' : 'mysql';
    } catch (error) {
      const code = error instanceof BmsApiErrorClass ? error.code : 'CONNECTION_ERROR';
      logger.warn('bms_db_type_detect_failed', { code });
      return null;
    }
  }
}

/**
 * Resolve a usable BMS session id for a hospital, for the MOPH alert drain
 * (codex #6a: the in-band session from the sync request may have expired by
 * the time the drain runs).
 *
 * Fast path: return the cached `session_id` from `hospital_bms_config` if it
 * is still valid (`session_expires_at` in the future with a safety margin).
 * Slow path: fetch a fresh session id from the hospital's tunnel via
 * `BmsSessionClient.getSessionId()`. Throws on missing config / tunnel failure
 * — the drain catches and defers all pending rows to the next run.
 *
 * NOTE: this only fetches the *session id* (the MOPH API resolves the hospital
 * JWT server-side from it). It does not validate the session or fetch a JWT —
 * that is the BMS Session API's job, not ours.
 */
export async function resolveSessionIdForHospital(
  db: DatabaseAdapter,
  hospitalId: string,
): Promise<string> {
  const rows = await db.query<{
    tunnel_url: string;
    session_id: string | null;
    session_expires_at: Date | string | null;
  }>(
    `SELECT tunnel_url, session_id, session_expires_at
     FROM hospital_bms_config
     WHERE hospital_id = $1
     LIMIT 1`,
    [hospitalId],
  );
  if (rows.length === 0 || !rows[0].tunnel_url) {
    throw new BmsApiErrorClass({
      code: 'CONNECTION_ERROR',
      message: `no tunnel_url configured for hospital ${hospitalId}`,
      statusCode: 0,
    });
  }
  const cfg = rows[0];

  // Fast path: cached session still valid (>60s margin).
  if (cfg.session_id) {
    const expires = cfg.session_expires_at ? new Date(cfg.session_expires_at).getTime() : 0;
    if (expires && expires - Date.now() > 60_000) {
      return cfg.session_id;
    }
  }

  // Slow path: pull a fresh session id from the tunnel.
  const client = new BmsSessionClient(cfg.tunnel_url);
  return client.getSessionId();
}
