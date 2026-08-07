// HOSxP date hygiene — some sites store Buddhist-Era years (พ.ศ.) in DATE
// columns (พล: birth_date 2556-11-03). Unsanitized, one such row poisons the
// MAX(born_at)-based sync cutoff and bricks the hospital's incremental sync.
import { describe, it, expect } from 'vitest';
import { normalizeHosxpDate, isPlausibleEventDate } from '@/lib/hosxp-date';

describe('normalizeHosxpDate', () => {
  it('converts Buddhist-Era years to Gregorian', () => {
    expect(normalizeHosxpDate('2556-11-03')).toBe('2013-11-03');
    expect(normalizeHosxpDate('2569-07-01')).toBe('2026-07-01');
  });

  it('passes Gregorian dates and null through unchanged', () => {
    expect(normalizeHosxpDate('2026-07-01')).toBe('2026-07-01');
    expect(normalizeHosxpDate(null)).toBeNull();
    expect(normalizeHosxpDate('')).toBeNull();
  });

  it('keeps time components intact', () => {
    expect(normalizeHosxpDate('2569-07-01T10:30:00')).toBe('2026-07-01T10:30:00');
  });
});

describe('isPlausibleEventDate', () => {
  const now = new Date('2026-07-10T00:00:00Z');
  it('rejects future dates beyond tolerance and accepts past dates', () => {
    expect(isPlausibleEventDate('2026-07-09', now)).toBe(true);
    expect(isPlausibleEventDate('2026-07-10', now)).toBe(true);
    expect(isPlausibleEventDate('2100-01-01', now)).toBe(false);
    expect(isPlausibleEventDate(null, now)).toBe(false);
  });
});
