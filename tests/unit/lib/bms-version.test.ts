import { describe, it, expect, vi } from 'vitest';
import {
  checkBmsApiVersion,
  encodeApiVersion,
  MIN_BMS_API_VERSION,
  MIN_BMS_API_VERSION_NUMBER,
} from '@/lib/bms-version';

describe('encodeApiVersion', () => {
  it('encodes the minimum version exactly', () => {
    // 4.69.5.1 → 004 069 005 001 → 4_069_005_001
    expect(encodeApiVersion('4.69.5.1')).toBe(4_069_005_001);
    expect(MIN_BMS_API_VERSION).toBe('4.69.5.1');
    expect(MIN_BMS_API_VERSION_NUMBER).toBe(4_069_005_001);
  });

  it('zero-pads each segment to three digits before joining', () => {
    expect(encodeApiVersion('1.2.3.4')).toBe(1_002_003_004);
    expect(encodeApiVersion('999.999.999.999')).toBe(999_999_999_999);
  });

  it('orders versions correctly using packed-int comparison', () => {
    const min = encodeApiVersion(MIN_BMS_API_VERSION)!;
    expect(encodeApiVersion('4.69.5.1')! >= min).toBe(true);
    expect(encodeApiVersion('4.69.5.2')! >= min).toBe(true);
    expect(encodeApiVersion('4.69.6.0')! >= min).toBe(true);
    expect(encodeApiVersion('4.70.0.0')! >= min).toBe(true);
    expect(encodeApiVersion('5.0.0.0')! >= min).toBe(true);

    expect(encodeApiVersion('4.69.5.0')! < min).toBe(true);
    expect(encodeApiVersion('4.69.4.999')! < min).toBe(true);
    expect(encodeApiVersion('4.69.4.24')! < min).toBe(true);
    expect(encodeApiVersion('4.68.99.99')! < min).toBe(true);
    expect(encodeApiVersion('3.99.99.99')! < min).toBe(true);
  });

  it('rejects malformed inputs', () => {
    expect(encodeApiVersion('')).toBeNull();
    expect(encodeApiVersion('4.69.4')).toBeNull();
    expect(encodeApiVersion('4.69.4.24.0')).toBeNull();
    expect(encodeApiVersion('a.b.c.d')).toBeNull();
    expect(encodeApiVersion('4.69.4.-1')).toBeNull();
    expect(encodeApiVersion('4.69.4.1000')).toBeNull();
  });
});

describe('checkBmsApiVersion', () => {
  function makeFetch(
    response: Partial<Response> & { _body?: string },
  ): typeof fetch {
    return vi.fn(async () => {
      const body = response._body ?? '';
      return {
        ok: response.ok ?? true,
        status: response.status ?? 200,
        text: async () => body,
      } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  it('accepts a JSON envelope with `result` field', async () => {
    const fetchImpl = makeFetch({
      ok: true,
      status: 200,
      _body: JSON.stringify({ MessageCode: 200, Message: 'OK', result: '4.69.5.1' }),
    });
    const r = await checkBmsApiVersion('https://tun.example/', 'jwt', { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.version).toBe('4.69.5.1');
    expect(r.versionNumber).toBe(MIN_BMS_API_VERSION_NUMBER);
  });

  it('accepts a bare-string body (older HOSxP builds)', async () => {
    const fetchImpl = makeFetch({ ok: true, status: 200, _body: '4.70.0.0' });
    const r = await checkBmsApiVersion('https://tun.example', 'jwt', { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.version).toBe('4.70.0.0');
  });

  it('accepts the exact minimum version (>= boundary)', async () => {
    const fetchImpl = makeFetch({
      ok: true,
      status: 200,
      _body: JSON.stringify({ result: MIN_BMS_API_VERSION }),
    });
    const r = await checkBmsApiVersion('https://tun.example', 'jwt', { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(r.version).toBe(MIN_BMS_API_VERSION);
  });

  it('accepts versions newer than the minimum', async () => {
    const fetchImpl = makeFetch({
      ok: true,
      status: 200,
      _body: JSON.stringify({ result: '4.69.5.2' }),
    });
    const r = await checkBmsApiVersion('https://tun.example', 'jwt', { fetchImpl });
    expect(r.ok).toBe(true);
  });

  it('rejects the version one tick below the minimum', async () => {
    const fetchImpl = makeFetch({
      ok: true,
      status: 200,
      _body: JSON.stringify({ result: '4.69.5.0' }),
    });
    const r = await checkBmsApiVersion('https://tun.example', 'jwt', { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('too_old');
  });

  it('rejects too-old versions', async () => {
    const fetchImpl = makeFetch({
      ok: true,
      status: 200,
      _body: JSON.stringify({ result: '4.69.4.24' }),
    });
    const r = await checkBmsApiVersion('https://tun.example', 'jwt', { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('too_old');
    expect(r.version).toBe('4.69.4.24');
  });

  it('rejects unparseable responses (e.g. empty body from buggy build)', async () => {
    const fetchImpl = makeFetch({ ok: true, status: 200, _body: '' });
    const r = await checkBmsApiVersion('https://tun.example', 'jwt', { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid_response');
  });

  it('rejects non-2xx HTTP responses as unreachable', async () => {
    const fetchImpl = makeFetch({ ok: false, status: 501, _body: '' });
    const r = await checkBmsApiVersion('https://tun.example', 'jwt', { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unreachable');
    expect(r.httpStatus).toBe(501);
  });

  it('posts to the correct /api/function endpoint with bearer token', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return {
        ok: true,
        status: 200,
        text: async () => '4.69.5.1',
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await checkBmsApiVersion('https://tun.example/', 'JWT-XYZ', { fetchImpl });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://tun.example/api/function?name=get_server_api_version');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer JWT-XYZ');
  });
});
