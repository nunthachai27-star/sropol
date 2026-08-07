import { describe, it, expect } from 'vitest';
import {
  isRequestOriginTrusted,
  parseTrustedOrigins,
  isJsonContentType,
} from '@/lib/request-origin';

const APP = 'https://kk-lrms.bmscloud.in.th';

describe('parseTrustedOrigins', () => {
  it('derives the app origin from NEXTAUTH_URL and appends extras', () => {
    expect(
      parseTrustedOrigins(`${APP}/`, 'https://embedder.example.com, https://two.example.com'),
    ).toEqual([APP, 'https://embedder.example.com', 'https://two.example.com']);
  });
  it('skips invalid URLs instead of throwing', () => {
    expect(parseTrustedOrigins('not a url', 'also-bad')).toEqual([]);
  });
});

describe('isRequestOriginTrusted', () => {
  const base = { requestOrigin: APP };
  it('always allows safe methods', () => {
    expect(
      isRequestOriginTrusted(
        { method: 'GET', origin: 'https://evil.example.com', secFetchSite: 'cross-site', ...base },
        [APP],
      ),
    ).toBe(true);
  });
  it('rejects a cross-site Origin on POST', () => {
    expect(
      isRequestOriginTrusted(
        { method: 'POST', origin: 'https://evil.example.com', secFetchSite: 'cross-site', ...base },
        [APP],
      ),
    ).toBe(false);
  });
  it('allows the configured app origin', () => {
    expect(
      isRequestOriginTrusted(
        { method: 'POST', origin: APP, secFetchSite: 'same-origin', ...base },
        [APP],
      ),
    ).toBe(true);
  });
  it('allows Origin matching the request host even if NEXTAUTH_URL is misconfigured', () => {
    expect(
      isRequestOriginTrusted({ method: 'POST', origin: APP, secFetchSite: null, ...base }, []),
    ).toBe(true);
  });
  it('rejects cross-site Sec-Fetch-Site when Origin is absent', () => {
    expect(
      isRequestOriginTrusted(
        { method: 'POST', origin: null, secFetchSite: 'cross-site', ...base },
        [APP],
      ),
    ).toBe(false);
  });
  it('allows non-browser clients that send neither header (curl, HOSxP Pascal)', () => {
    expect(
      isRequestOriginTrusted({ method: 'POST', origin: null, secFetchSite: null, ...base }, [APP]),
    ).toBe(true);
  });
});

describe('isJsonContentType', () => {
  it('accepts application/json with or without charset', () => {
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true);
  });
  it('rejects form content types (CSRF simple-request vectors)', () => {
    expect(isJsonContentType('application/x-www-form-urlencoded')).toBe(false);
    expect(isJsonContentType('multipart/form-data; boundary=x')).toBe(false);
    expect(isJsonContentType('text/plain')).toBe(false);
  });
});
