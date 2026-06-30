import { describe, it, expect } from 'vitest';
import { pollBackoffDelay } from '@/lib/browser-poll';

// When a hospital's HOSxP gateway/tunnel is persistently unreachable (e.g. a
// remote tab hitting a tunnel that blocks CORS, or a down gateway), the poll
// kept firing its full query set every 60s forever — failing every time, with
// zero chance of success until the underlying issue resolves. That floods the
// console and the tunnel for nothing. After a few consecutive failures the
// cadence should back off exponentially, capped, and snap back to base on the
// next success.
describe('pollBackoffDelay', () => {
  const BASE = 60_000;

  it('uses the base interval while healthy (0 consecutive failures)', () => {
    expect(pollBackoffDelay(0, BASE)).toBe(BASE);
  });

  it('stays at base for the first couple of failures (transient blips)', () => {
    expect(pollBackoffDelay(1, BASE)).toBe(BASE);
    expect(pollBackoffDelay(2, BASE)).toBe(BASE);
  });

  it('starts doubling once failures cross the threshold (3)', () => {
    expect(pollBackoffDelay(3, BASE)).toBe(BASE * 2);
    expect(pollBackoffDelay(4, BASE)).toBe(BASE * 4);
    expect(pollBackoffDelay(5, BASE)).toBe(BASE * 8);
  });

  it('caps the backoff so it never grows unbounded', () => {
    expect(pollBackoffDelay(50, BASE)).toBe(10 * 60_000); // 10-minute cap
  });

  it('honours custom threshold and cap', () => {
    expect(pollBackoffDelay(1, BASE, { thresholdFailures: 1, maxMs: 5 * BASE })).toBe(BASE * 2);
    expect(pollBackoffDelay(10, BASE, { thresholdFailures: 1, maxMs: 5 * BASE })).toBe(5 * BASE);
  });
});
