import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// base-path.ts reads NEXT_PUBLIC_BASE_PATH at module-eval time, so each case
// re-imports the module with a fresh env via vi.resetModules().
async function loadWithBasePath(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
  } else {
    process.env.NEXT_PUBLIC_BASE_PATH = value;
  }
  return import('@/lib/base-path');
}

describe('withBasePath', () => {
  const original = process.env.NEXT_PUBLIC_BASE_PATH;
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = original;
  });

  it('returns the path unchanged when no base path is configured (root deploy)', async () => {
    const { withBasePath, BASE_PATH } = await loadWithBasePath(undefined);
    expect(BASE_PATH).toBe('');
    expect(withBasePath('/api/health')).toBe('/api/health');
  });

  it('prefixes root-relative paths when a base path is configured', async () => {
    const { withBasePath } = await loadWithBasePath('/sr-lrms');
    expect(withBasePath('/api/health')).toBe('/sr-lrms/api/health');
    expect(withBasePath('/geo/th-provinces.geojson')).toBe('/sr-lrms/geo/th-provinces.geojson');
  });

  it('leaves absolute and protocol-relative URLs untouched', async () => {
    const { withBasePath } = await loadWithBasePath('/sr-lrms');
    expect(withBasePath('https://example.com/api/x')).toBe('https://example.com/api/x');
    expect(withBasePath('//cdn.example.com/x')).toBe('//cdn.example.com/x');
  });

  it('is idempotent — does not double-prefix an already-prefixed path', async () => {
    const { withBasePath } = await loadWithBasePath('/sr-lrms');
    expect(withBasePath('/sr-lrms/api/health')).toBe('/sr-lrms/api/health');
    expect(withBasePath('/sr-lrms')).toBe('/sr-lrms');
  });
});
