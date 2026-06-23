import { describe, it, expect } from 'vitest';
import { decideLaborPushMode } from '@/lib/browser-poll';

// The browser-poll labor push must only use 'full_snapshot' (which lets the
// server discharge cached ACTIVE patients absent from the payload) when this
// push is a COMPLETE, verified view of the hospital's active set. Otherwise it
// must stay 'incremental' (upsert-only) so we never wrongly close an active
// case from a partial/unverified view. See systematic-debugging finding:
// stale cached_patients accumulate because the browser path never reconciles.
describe('decideLaborPushMode', () => {
  it('uses full_snapshot when view is authentic and nothing was dropped', () => {
    expect(
      decideLaborPushMode({ authenticityStatus: 'authentic', droppedNameUnstable: 0 }),
    ).toBe('full_snapshot');
  });

  it('falls back to incremental when some patients were dropped by the name probe', () => {
    expect(
      decideLaborPushMode({ authenticityStatus: 'authentic', droppedNameUnstable: 2 }),
    ).toBe('incremental');
  });

  it('falls back to incremental when the probe failed (unverified view)', () => {
    expect(
      decideLaborPushMode({ authenticityStatus: 'probe_failed', droppedNameUnstable: 0 }),
    ).toBe('incremental');
  });

  it('falls back to incremental when authenticity was never established', () => {
    expect(
      decideLaborPushMode({ authenticityStatus: undefined, droppedNameUnstable: 0 }),
    ).toBe('incremental');
  });
});
