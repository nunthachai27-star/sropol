// T035: BmsSessionClient tests — uses mocked fetch
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BmsSessionClient, BmsApiErrorClass } from '@/lib/bms-session';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const BMS_URL = 'https://99999-test.tunnel.hosxp.net';

describe('BmsSessionClient', () => {
  let client: BmsSessionClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new BmsSessionClient(BMS_URL);
  });

  it('should create with tunnel URL', () => {
    expect(client).toBeDefined();
  });

  describe('getSessionId', () => {
    it('should fetch session ID from tunnel URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => '550e8400-e29b-41d4-a716-446655440000',
      });

      const sessionId = await client.getSessionId();
      expect(sessionId).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://99999-test.tunnel.hosxp.net/api/SessionID',
        expect.any(Object),
      );
    });

    it('should throw on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      await expect(client.getSessionId()).rejects.toThrow();
    });
  });

  describe('validateSession', () => {
    it('should validate session ID via hosxp.net and return config', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jwt: 'eyJhbGc...',
          bms_url: 'https://99999-test.tunnel.hosxp.net',
          user_info: {
            name: 'Test User',
            position: 'doctor',
            hospital_code: '99999',
            department: 'OB/GYN',
            is_hr_admin: false,
            is_director: false,
          },
          expired_second: 2592000,
        }),
      });

      const config = await client.validateSession(
        'test-session-id',
        'https://hosxp.net/phapi/PasteJSON',
      );
      expect(config.jwt).toBe('eyJhbGc...');
      expect(config.bmsUrl).toBe('https://99999-test.tunnel.hosxp.net');
      expect(config.userInfo.name).toBe('Test User');
    });

    it('should throw BmsApiError on 501 unauthorized', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 501,
        statusText: 'Unauthorized',
      });

      await expect(
        client.validateSession('bad-session', 'https://hosxp.net/phapi/PasteJSON'),
      ).rejects.toThrow(BmsApiErrorClass);
    });
  });

  describe('executeQuery', () => {
    it('should execute SQL query with Bearer JWT', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ an: '123', hn: '456' }],
          field: ['an', 'hn'],
          field_name: ['AN', 'HN'],
          record_count: 1,
        }),
      });

      const result = await client.executeQuery(
        'SELECT * FROM ipt',
        'https://99999-test.tunnel.hosxp.net',
        'test-jwt-token',
      );
      expect(result.data).toHaveLength(1);
      expect(result.record_count).toBe(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://99999-test.tunnel.hosxp.net/api/sql',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-jwt-token',
          }),
        }),
      );
    });

    it('should throw on 409 SQL error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'SQL Error',
      });

      await expect(client.executeQuery('INVALID SQL', 'https://test.net', 'jwt')).rejects.toThrow(
        BmsApiErrorClass,
      );
    });
  });

  describe('classifyTransportError (via executeQuery/getDatabaseType)', () => {
    it('classifies an AbortSignal timeout as TIMEOUT', async () => {
      const timeoutError = new DOMException(
        'The operation was aborted due to timeout',
        'TimeoutError',
      );
      mockFetch.mockRejectedValueOnce(timeoutError);
      await expect(client.executeQuery('SELECT 1', BMS_URL, 'jwt')).rejects.toMatchObject({
        code: 'TIMEOUT',
      });
    });

    it('classifies DNS failure as CONNECTION_ERROR with a DNS message, not TIMEOUT', async () => {
      const dnsError = Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ENOTFOUND' },
      });
      mockFetch.mockRejectedValueOnce(dnsError);
      await expect(client.executeQuery('SELECT 1', BMS_URL, 'jwt')).rejects.toMatchObject({
        code: 'CONNECTION_ERROR',
        message: expect.stringContaining('DNS lookup failed'),
      });
    });

    it('classifies a malformed 200 response as CONNECTION_ERROR (invalid JSON), not TIMEOUT', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      });
      await expect(client.executeQuery('SELECT 1', BMS_URL, 'jwt')).rejects.toMatchObject({
        code: 'CONNECTION_ERROR',
        message: expect.stringContaining('invalid JSON response'),
      });
    });

    it('getDatabaseType returns null (not a mysql guess) when detection fails', async () => {
      mockFetch.mockRejectedValueOnce(
        Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'ECONNREFUSED' },
        }),
      );
      await expect(client.getDatabaseType(BMS_URL, 'jwt')).resolves.toBeNull();
    });
  });
});
