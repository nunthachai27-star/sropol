import { describe, it, expect } from 'vitest';
import { sanitizeCallbackUrl } from '@/lib/safe-callback-url';

describe('sanitizeCallbackUrl', () => {
  it('allows same-origin relative paths', () => {
    expect(sanitizeCallbackUrl('/foo')).toBe('/foo');
    expect(sanitizeCallbackUrl('/dashboard/12345')).toBe('/dashboard/12345');
    expect(sanitizeCallbackUrl('/foo?bar=1&baz=2')).toBe('/foo?bar=1&baz=2');
    expect(sanitizeCallbackUrl('/foo#section')).toBe('/foo#section');
  });

  it('falls back to root for null / undefined / empty input', () => {
    expect(sanitizeCallbackUrl(null)).toBe('/');
    expect(sanitizeCallbackUrl(undefined)).toBe('/');
    expect(sanitizeCallbackUrl('')).toBe('/');
  });

  it('rejects absolute http(s) URLs', () => {
    expect(sanitizeCallbackUrl('http://evil.com')).toBe('/');
    expect(sanitizeCallbackUrl('https://evil.com/path')).toBe('/');
    expect(sanitizeCallbackUrl('HTTPS://evil.com')).toBe('/');
  });

  it('rejects protocol-relative URLs', () => {
    expect(sanitizeCallbackUrl('//evil.com')).toBe('/');
    expect(sanitizeCallbackUrl('//evil.com/path')).toBe('/');
  });

  it('rejects backslash protocol-relative bypasses', () => {
    // Browsers normalise backslashes to forward slashes, so "/\evil.com"
    // resolves like "//evil.com".
    expect(sanitizeCallbackUrl('/\\evil.com')).toBe('/');
    expect(sanitizeCallbackUrl('/\\/evil.com')).toBe('/');
  });

  it('rejects the javascript: scheme', () => {
    expect(sanitizeCallbackUrl('javascript:alert(1)')).toBe('/');
    expect(sanitizeCallbackUrl('javascript:void(0)')).toBe('/');
  });

  it('rejects other non-relative values', () => {
    expect(sanitizeCallbackUrl('evil.com')).toBe('/');
    expect(sanitizeCallbackUrl('mailto:a@b.com')).toBe('/');
    expect(sanitizeCallbackUrl('data:text/html,<script>')).toBe('/');
  });

  it('preserves the leading root path itself', () => {
    expect(sanitizeCallbackUrl('/')).toBe('/');
  });
});
