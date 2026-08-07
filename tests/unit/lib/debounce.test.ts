// debounceLeadingTrailing — the SSE-refresh rate limiter (2026-07-17
// dashboard incident). Fake timers make the window deterministic.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounceLeadingTrailing } from '@/lib/debounce';

describe('debounceLeadingTrailing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires immediately on the leading edge', () => {
    const fn = vi.fn();
    const d = debounceLeadingTrailing(fn, 10_000);
    d();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst into one trailing call at the end of the window', () => {
    const fn = vi.fn();
    const d = debounceLeadingTrailing(fn, 10_000);
    d(); // leading
    d();
    d();
    d(); // burst — all coalesce
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(fn).toHaveBeenCalledTimes(2); // one trailing for the whole burst
    vi.advanceTimersByTime(30_000);
    expect(fn).toHaveBeenCalledTimes(2); // nothing pending — no further calls
  });

  it('resets after a quiet window: next call is a fresh leading edge', () => {
    const fn = vi.fn();
    const d = debounceLeadingTrailing(fn, 10_000);
    d();
    vi.advanceTimersByTime(10_000); // window closes with nothing pending
    d();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('sustained events yield at most one call per window after the leading edge', () => {
    const fn = vi.fn();
    const d = debounceLeadingTrailing(fn, 10_000);
    // 60s of an event every second
    for (let t = 0; t < 60; t++) {
      d();
      vi.advanceTimersByTime(1_000);
    }
    // leading (1) + one trailing per 10s window elapsed (~6)
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(8);
  });
});
