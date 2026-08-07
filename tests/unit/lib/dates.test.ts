// Direct coverage for src/lib/dates.ts — the pg-Date/ISO-string boundary
// helpers. Production pg (and the pglite test harness) return TIMESTAMPTZ
// columns as JS Date objects while the API types declare ISO strings; these
// helpers are the single normalization point service mappers must use.
import { describe, it, expect } from 'vitest';
import { toIsoDate, toIsoString, isoDatesEqual } from '@/lib/dates';

describe('toIsoString', () => {
  it('passes through an ISO string, normalized to full ISO-8601', () => {
    expect(toIsoString('2026-07-01T02:30:00.000Z')).toBe('2026-07-01T02:30:00.000Z');
    expect(toIsoString('2026-07-01T02:30:00Z')).toBe('2026-07-01T02:30:00.000Z');
  });

  it('converts a pg Date object to its ISO string', () => {
    expect(toIsoString(new Date('2026-07-01T02:30:00.000Z'))).toBe('2026-07-01T02:30:00.000Z');
  });

  it('is null-safe', () => {
    expect(toIsoString(null)).toBeNull();
    expect(toIsoString(undefined)).toBeNull();
  });

  it('returns null for unparseable values instead of throwing', () => {
    expect(toIsoString('not-a-date')).toBeNull();
    expect(toIsoString(new Date('invalid'))).toBeNull();
  });
});

describe('toIsoDate', () => {
  it('extracts the calendar day from a date-only string', () => {
    expect(toIsoDate('2026-05-01')).toBe('2026-05-01');
  });

  it('recovers the written calendar day from a TIMESTAMPTZ Date (host-timezone write)', () => {
    // A naive '2026-05-01' written into TIMESTAMPTZ is stored as host-midnight;
    // local getters must recover the day that was written, not the UTC day.
    const hostMidnight = new Date(2026, 4, 1); // 2026-05-01T00:00 local
    expect(toIsoDate(hostMidnight)).toBe('2026-05-01');
  });

  it('is null-safe', () => {
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
  });
});

describe('isoDatesEqual', () => {
  it('treats a pg Date and the original naive date string as the same day', () => {
    expect(isoDatesEqual(new Date(2026, 4, 1), '2026-05-01')).toBe(true);
  });

  it('detects genuinely different days', () => {
    expect(isoDatesEqual(new Date(2026, 4, 2), '2026-05-01')).toBe(false);
  });
});
