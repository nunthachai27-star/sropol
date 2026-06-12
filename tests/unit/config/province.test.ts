// Regression: prod (SR-LRMS / Surin) put all 18 hospitals under "จังหวัดอื่น"
// because DEFAULT_PROVINCE_CODE resolved to '' — the Docker build passes an
// EMPTY NEXT_PUBLIC_DEFAULT_PROVINCE_CODE and `'' ?? '32'` keeps the empty
// string (?? only catches null/undefined). The fallback must treat an empty /
// whitespace value as "unset" too.
import { describe, it, expect } from 'vitest';
import { resolveProvinceCode } from '@/config/province';

describe('resolveProvinceCode', () => {
  it('falls back to the default when the env var is undefined', () => {
    expect(resolveProvinceCode(undefined)).toBe('32');
  });

  it('falls back to the default when the env var is an empty string (Docker passes "")', () => {
    expect(resolveProvinceCode('')).toBe('32');
  });

  it('falls back to the default when the env var is only whitespace', () => {
    expect(resolveProvinceCode('   ')).toBe('32');
  });

  it('uses an explicitly provided province code', () => {
    expect(resolveProvinceCode('40')).toBe('40'); // e.g. original kk-lrms / Khon Kaen
  });

  it('trims a padded value', () => {
    expect(resolveProvinceCode(' 32 ')).toBe('32');
  });

  it('honours a caller-supplied fallback', () => {
    expect(resolveProvinceCode('', '40')).toBe('40');
  });
});
