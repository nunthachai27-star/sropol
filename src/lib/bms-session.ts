// T035: BmsSessionClient — handles BMS Session API communication

import type {
  BmsQueryResult,
  BmsValidateResponse,
  SessionConfig,
  BmsApiError,
} from '@/types/bms-session';

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
      throw new BmsApiErrorClass({
        code: 'CONNECTION_ERROR',
        message: `Cannot connect to BMS at ${this.tunnelUrl}: ${(error as Error).message}`,
        statusCode: 0,
      });
    }
  }

  async validateSession(
    sessionId: string,
    validateUrl: string,
  ): Promise<SessionConfig> {
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
      throw new BmsApiErrorClass({
        code: 'CONNECTION_ERROR',
        message: `Validation failed: ${(error as Error).message}`,
        statusCode: 0,
      });
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
      throw new BmsApiErrorClass({
        code: 'TIMEOUT',
        message: `Query timeout: ${(error as Error).message}`,
        statusCode: 0,
      });
    }
  }

  getDatabaseType(bmsUrl: string, jwt: string): Promise<'postgresql' | 'mysql'> {
    // Detect database type by trying a version query
    return this.executeQuery('SELECT version()', bmsUrl, jwt).then((result) => {
      const version = String(result.data[0]?.['version()'] ?? '');
      return version.toLowerCase().includes('postgresql') ? 'postgresql' : 'mysql';
    });
  }
}
