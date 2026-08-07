import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  retrieveBmsSession,
  extractConnectionConfig,
  extractUserInfo,
  executeSql,
  callFunction,
  getIpdVitalSignChart,
  getPatientPhoto,
  restInsert,
  restUpdate,
  restDelete,
  setActiveMarketplaceToken,
  APP_IDENTIFIER,
} from '@/lib/bms-browser-client';
import type { ConnectionConfig } from '@/types/bms-browser';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('bms-browser-client.retrieveBmsSession', () => {
  beforeEach(() => mockFetch.mockReset());

  it('GETs PasteJSON with ?Action=GET&code=<sid> query string', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          user_info: {
            bms_url: 'https://t.example/api',
            bms_session_code: 'eyJ...',
            loginname: 'nurse1',
            fullname: 'Nurse One',
            hospcode: '10670',
          },
          expired_second: 3600,
        },
      }),
    });

    const r = await retrieveBmsSession('SID-1');
    expect(r.result?.user_info).toMatchObject({ loginname: 'nurse1' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toMatch(/^https:\/\/hosxp\.net\/phapi\/PasteJSON\?/);
    expect(calledUrl).toContain('Action=GET');
    expect(calledUrl).toContain('code=SID-1');
    // Cache-bust param present
    expect(calledUrl).toMatch(/_=\d+/);
    // Should NOT have a body (GET request)
    expect(mockFetch.mock.calls[0][1]?.body).toBeUndefined();
    expect(mockFetch.mock.calls[0][1]?.method).toBeUndefined(); // defaults to GET
  });

  it('throws on HTTP 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'session expired',
    });
    await expect(retrieveBmsSession('SID-X')).rejects.toThrow();
  });
});

describe('extractConnectionConfig', () => {
  it('extracts apiUrl + bearerToken from result.user_info (PasteJSON shape)', () => {
    const r = {
      result: {
        user_info: {
          bms_url: 'https://t.example/api',
          bms_session_code: 'eyJ...',
        },
      },
    };
    const c = extractConnectionConfig(r);
    expect(c).toEqual({
      apiUrl: 'https://t.example/api',
      bearerToken: 'eyJ...',
      appIdentifier: APP_IDENTIFIER,
    });
  });

  it('falls back to result.key_value when bms_session_code missing', () => {
    const r = {
      result: {
        user_info: { bms_url: 'https://t.example/api' },
        key_value: 'fallback-token',
      },
    };
    const c = extractConnectionConfig(r);
    expect(c.bearerToken).toBe('fallback-token');
  });

  it('strips trailing slash from bms_url', () => {
    const r = {
      result: { user_info: { bms_url: 'https://t.example/api/', bms_session_code: 't' } },
    };
    expect(extractConnectionConfig(r).apiUrl).toBe('https://t.example/api');
  });

  it('throws when bms_url missing', () => {
    expect(() =>
      extractConnectionConfig({ result: { user_info: { bms_session_code: 'x' } } } as never),
    ).toThrow(/bms_url/);
  });

  it('throws when bearer token missing (neither bms_session_code nor key_value)', () => {
    expect(() =>
      extractConnectionConfig({ result: { user_info: { bms_url: 'x' } } } as never),
    ).toThrow(/bearer token/i);
  });

  it('accepts legacy top-level fixture shape (test-only fallback)', () => {
    // Existing tests + integration helpers use the simpler { jwt, bms_url } shape
    const r = { jwt: 'eyJ...', bms_url: 'https://t.example/api' };
    const c = extractConnectionConfig(r);
    expect(c).toEqual({
      apiUrl: 'https://t.example/api',
      bearerToken: 'eyJ...',
      appIdentifier: APP_IDENTIFIER,
    });
  });
});

describe('extractUserInfo', () => {
  it('returns user_info from result.user_info (PasteJSON shape)', () => {
    const r = { result: { user_info: { loginname: 'n1', fullname: 'Nurse', hospcode: '10670' } } };
    expect(extractUserInfo(r as never)).toMatchObject({ loginname: 'n1', hospcode: '10670' });
  });

  it('falls back to top-level user_info (test fixture shape)', () => {
    const r = { user_info: { loginname: 'n1', fullname: 'Nurse', hospcode: '10670' } };
    expect(extractUserInfo(r as never)).toMatchObject({ loginname: 'n1', hospcode: '10670' });
  });
});

const cfg: ConnectionConfig = {
  apiUrl: 'https://t.example/api',
  bearerToken: 'BEARER',
  appIdentifier: 'KK-LRMS.Web',
};

describe('executeSql', () => {
  beforeEach(() => mockFetch.mockReset());

  it('POSTs sql to /api/sql with bearer + app identifier', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: function () {
        return this;
      },
      json: async () => ({ data: [{ x: 1 }], MessageCode: 200, Message: 'ok' }),
    });
    const r = await executeSql('SELECT 1', cfg);
    expect(r.data).toEqual([{ x: 1 }]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://t.example/api/api/sql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer BEARER',
          'Content-Type': 'application/json',
        }),
      }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ sql: 'SELECT 1', app: 'KK-LRMS.Web' });
  });

  it('passes params when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: function () {
        return this;
      },
      json: async () => ({ data: [], MessageCode: 200, Message: 'ok' }),
    });
    await executeSql('SELECT * FROM x WHERE id = :id', cfg, { id: 42 });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // BMS requires typed params; executeSql auto-wraps integer 42 → {value, value_type}
    expect(body.params).toEqual({ id: { value: 42, value_type: 'integer' } });
  });

  it('throws Thai retry message on HTTP 429', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: { get: (h: string) => (h === 'Retry-After' ? '5' : null) },
      json: async () => ({ message: 'rate limit' }),
      clone: function () {
        return this;
      },
    });
    await expect(executeSql('SELECT 1', cfg)).rejects.toThrow(/มีการร้องขอบ่อยเกินไป/);
  });

  it('throws unauthorized on HTTP 501 + MessageCode 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 501,
      statusText: 'Not Implemented',
      clone: function () {
        return { json: async () => ({ MessageCode: 401, Message: 'unauthorized' }) };
      },
      text: async () => '{"MessageCode":401}',
    });
    await expect(executeSql('SELECT 1', cfg)).rejects.toThrow(/Session unauthorized/);
  });

  it('throws "Database error" on body MessageCode != 200 with HTTP 200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: function () {
        return this;
      },
      json: async () => ({ data: [], MessageCode: 409, Message: 'syntax error' }),
    });
    await expect(executeSql('SELECT bad', cfg)).rejects.toThrow(/Database error/);
  });

  it('preserves verbatim Database error Message even with magic substrings', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: function () {
        return this;
      },
      json: async () => ({ data: [], MessageCode: 500, Message: 'Session unauthorized — fake' }),
    });
    await expect(executeSql('SELECT 1', cfg)).rejects.toThrow(/Session unauthorized — fake/);
  });
});

describe('callFunction', () => {
  beforeEach(() => mockFetch.mockReset());

  it('POSTs payload to /api/function?name=X with bearer', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', Value: 12345 }),
    });
    const r = await callFunction('get_serialnumber', cfg, { id_field: 'iptbedmove_id' });
    expect((r as { Value: number }).Value).toBe(12345);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://t.example/api/api/function?name=get_serialnumber',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer BEARER',
          'Content-Type': 'application/json',
        }),
      }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ id_field: 'iptbedmove_id' });
  });

  it('URL-encodes the function name', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok' }),
    });
    await callFunction('weird name with spaces', cfg);
    expect(mockFetch.mock.calls[0][0]).toContain('name=weird%20name%20with%20spaces');
  });

  it('throws unauthorized on HTTP 501', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 501,
      statusText: 'Not Implemented',
      text: async () => '',
    });
    await expect(callFunction('x', cfg)).rejects.toThrow(/Session unauthorized/);
  });

  it('throws Thai retry on HTTP 429', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: { get: () => null },
      json: async () => ({}),
    });
    await expect(callFunction('x', cfg)).rejects.toThrow(/มีการร้องขอบ่อยเกินไป/);
  });

  it('throws Message verbatim when MessageCode >= 400 in 200 body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 500, Message: 'internal failure' }),
    });
    await expect(callFunction('x', cfg)).rejects.toThrow('internal failure');
  });

  it('preserves Message verbatim even when it contains magic substrings', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 500, Message: 'Session unauthorized — fake' }),
    });
    await expect(callFunction('x', cfg)).rejects.toThrow('Session unauthorized — fake');
  });
});

describe('getIpdVitalSignChart', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    setActiveMarketplaceToken(null);
  });

  function pngResponse() {
    return {
      ok: true,
      status: 200,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'image/png' : null) },
      blob: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
    };
  }

  it('POSTs { an, chart_type_id } to /api/function?name=GetIPDVitalSignChart with bearer', async () => {
    mockFetch.mockResolvedValueOnce(pngResponse());
    const r = await getIpdVitalSignChart(cfg, '600001234', 2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.blob).toBeInstanceOf(Blob);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://t.example/api/api/function?name=GetIPDVitalSignChart',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer BEARER',
          'Content-Type': 'application/json',
        }),
      }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ an: '600001234', chart_type_id: 2 });
  });

  it('returns the raw PNG blob when Content-Type is image/png', async () => {
    mockFetch.mockResolvedValueOnce(pngResponse());
    const r = await getIpdVitalSignChart(cfg, 'AN9', 3);
    expect(r).toMatchObject({ ok: true });
  });

  it('merges marketplace-token into the body when provided explicitly', async () => {
    mockFetch.mockResolvedValueOnce(pngResponse());
    await getIpdVitalSignChart(cfg, 'AN1', 2, 'MKT-TOKEN');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body['marketplace-token']).toBe('MKT-TOKEN');
  });

  it('falls back to the active marketplace-token singleton when no explicit token', async () => {
    setActiveMarketplaceToken('SINGLETON-TOKEN');
    mockFetch.mockResolvedValueOnce(pngResponse());
    await getIpdVitalSignChart(cfg, 'AN1', 2);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body['marketplace-token']).toBe('SINGLETON-TOKEN');
  });

  it('returns a structured failure with the MessageCode when the body is JSON (no-data / render error)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 200,
      headers: {
        get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      json: async () => ({
        result: {},
        MessageCode: 500,
        Message: 'GetIPDVitalSignChart error: AN not found',
        RequestTime: '2026-07-08T12:32:00.000Z',
      }),
    });
    const r = await getIpdVitalSignChart(cfg, 'MISSING', 2);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.messageCode).toBe(500);
      // Actionable Thai copy, not the raw English server string.
      expect(r.message).toMatch(/ยังไม่มีข้อมูลสัญญาณชีพ|ไม่พบข้อมูล/);
    }
  });

  it('maps 501 (lite build) to an actionable Thai unsupported message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 200,
      headers: {
        get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      json: async () => ({ MessageCode: 501, Message: 'unsupported in lite build' }),
    });
    const r = await getIpdVitalSignChart(cfg, 'AN1', 2);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.messageCode).toBe(501);
      expect(r.message).toMatch(/ไม่รองรับ/);
    }
  });

  it('falls back to HTTP status when the error body is not parseable JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'text/html' : null) },
      json: async () => {
        throw new Error('not json');
      },
    });
    const r = await getIpdVitalSignChart(cfg, 'AN1', 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.messageCode).toBe(500);
  });

  it('throws the Thai retry message on HTTP 429 (retryable transport error)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: { get: (h: string) => (h === 'Retry-After' ? '5' : null) },
    });
    await expect(getIpdVitalSignChart(cfg, 'AN1', 2)).rejects.toThrow(/มีการร้องขอบ่อยเกินไป/);
  });

  it('throws a Thai timeout message when the request aborts', async () => {
    mockFetch.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    await expect(getIpdVitalSignChart(cfg, 'AN1', 2)).rejects.toThrow(/หมดเวลา/);
  });

  it('throws a Thai connection error on a generic network failure', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(getIpdVitalSignChart(cfg, 'AN1', 2)).rejects.toThrow(/ไม่สามารถเชื่อมต่อ/);
  });
});

describe('getPatientPhoto', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    setActiveMarketplaceToken(null);
  });

  function jpegResponse() {
    return {
      ok: true,
      status: 200,
      blob: async () => new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' }),
    };
  }

  it('GETs /api/rest/patient_image/{hn} with field/responseType/size params + bearer', async () => {
    mockFetch.mockResolvedValueOnce(jpegResponse());
    const r = await getPatientPhoto(cfg, '000123456', { width: 200, height: 200 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.blob).toBeInstanceOf(Blob);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('https://t.example/api/api/rest/patient_image/000123456?');
    expect(url).toContain('field=image');
    expect(url).toContain('responseType=jpg');
    expect(url).toContain('width=200');
    expect(url).toContain('height=200');
    const init = mockFetch.mock.calls[0][1];
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer BEARER' });
    expect(init.body).toBeUndefined();
  });

  it('URL-encodes the HN', async () => {
    mockFetch.mockResolvedValueOnce(jpegResponse());
    await getPatientPhoto(cfg, 'HN 42/1', {});
    expect(mockFetch.mock.calls[0][0]).toContain('/patient_image/HN%2042%2F1?');
  });

  it('appends the marketplace-token to the query string when provided', async () => {
    mockFetch.mockResolvedValueOnce(jpegResponse());
    await getPatientPhoto(cfg, 'HN1', { marketplaceToken: 'MKT-TOKEN' });
    expect(mockFetch.mock.calls[0][0]).toContain('marketplace-token=MKT-TOKEN');
  });

  it('falls back to the active marketplace-token singleton', async () => {
    setActiveMarketplaceToken('SINGLETON');
    mockFetch.mockResolvedValueOnce(jpegResponse());
    await getPatientPhoto(cfg, 'HN1', {});
    expect(mockFetch.mock.calls[0][0]).toContain('marketplace-token=SINGLETON');
  });

  it('returns ok:false with the HTTP status when there is no photo (404)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });
    const r = await getPatientPhoto(cfg, 'HN1', {});
    expect(r).toEqual({ ok: false, status: 404 });
  });

  it('degrades quietly to ok:false status 0 on a network error (no throw)', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const r = await getPatientPhoto(cfg, 'HN1', {});
    expect(r).toEqual({ ok: false, status: 0 });
  });

  it('omits width/height when not requested', async () => {
    mockFetch.mockResolvedValueOnce(jpegResponse());
    await getPatientPhoto(cfg, 'HN1', {});
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).not.toContain('width=');
    expect(url).not.toContain('height=');
  });
});

describe('REST CRUD', () => {
  beforeEach(() => mockFetch.mockReset());

  describe('restInsert', () => {
    it('POSTs to /api/rest/{table} with bearer + body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ MessageCode: 200, Message: 'ok', insert_count: 1 }),
      });
      const r = await restInsert('iptbedmove', { an: 'AN1', oward: 'A' }, cfg);
      expect(r.MessageCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://t.example/api/api/rest/iptbedmove',
        expect.objectContaining({ method: 'POST' }),
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({ an: 'AN1', oward: 'A' });
    });

    it('merges marketplace-token into body when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ MessageCode: 200, Message: 'ok' }),
      });
      await restInsert('x', { a: 1 }, cfg, 'MKT-TOKEN');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body['marketplace-token']).toBe('MKT-TOKEN');
      expect(body.a).toBe(1);
    });

    it('throws REST POST prefix on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal',
        text: async () => 'oops',
      });
      await expect(restInsert('x', {}, cfg)).rejects.toThrow(/REST POST x:/);
    });
  });

  describe('restUpdate', () => {
    it('PUTs to /api/rest/{table}/{id} URL-encoded', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ MessageCode: 200, Message: 'ok', update_count: 1 }),
      });
      await restUpdate('ipt_labour_partograph', 'id 123', { x: 2 }, cfg);
      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://t.example/api/api/rest/ipt_labour_partograph/id%20123',
      );
      expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
    });

    it('throws REST PUT prefix on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => '',
      });
      await expect(restUpdate('x', 1, {}, cfg)).rejects.toThrow(/REST PUT x\/1:/);
    });
  });

  describe('restDelete', () => {
    it('DELETEs from /api/rest/{table}/{id}', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ MessageCode: 200, Message: 'ok' }),
      });
      await restDelete('iptbedmove', 99, cfg);
      expect(mockFetch.mock.calls[0][0]).toBe('https://t.example/api/api/rest/iptbedmove/99');
      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    });

    it('appends marketplace-token to query string (not body) when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ MessageCode: 200, Message: 'ok' }),
      });
      await restDelete('iptbedmove', 99, cfg, 'MKT');
      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://t.example/api/api/rest/iptbedmove/99?marketplace-token=MKT',
      );
    });

    it('throws REST DELETE prefix on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => '',
      });
      await expect(restDelete('x', 1, cfg)).rejects.toThrow(/REST DELETE x\/1:/);
    });
  });
});
