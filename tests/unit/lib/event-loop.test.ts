// Unit tests: cooperative event-loop yielding (src/lib/event-loop.ts).
//
// Production incident (2026-07-17 page-latency diagnosis): browser-push sync
// processing ran multi-second synchronous-CPU stretches on the single serving
// event loop, stalling ALL page requests 3-7s during push bursts. The fix is
// bounded cooperative yielding — these tests pin the primitive's contract:
//   1. yieldToEventLoop actually reaches the check phase (pending setImmediate
//      callbacks queued BEFORE it run BEFORE it resolves — ordering proof).
//   2. CooperativeYielder.tick() is time-budget based: no yield under budget,
//      a yield once the budget elapses.
//   3. After a yield the budget resets (no yield-every-tick thrash).
//
// Determinism note: no fake timers and no sleeps. setImmediate is not faked
// by vi.useFakeTimers() by default and mixing faked Date.now with real
// setImmediate is a trap — instead budgets of 0 (always elapsed) and 10_000ms
// (never elapsed within a test) make every assertion machine-speed-proof.
import { describe, it, expect } from 'vitest';
import { yieldToEventLoop, CooperativeYielder } from '@/lib/event-loop';

describe('yieldToEventLoop', () => {
  it('resolves only after setImmediate callbacks queued before it (check-phase ordering)', async () => {
    const order: string[] = [];
    setImmediate(() => order.push('pre-queued-immediate'));
    await yieldToEventLoop();
    order.push('after-yield');
    // FIFO within the check phase: the callback registered first runs first,
    // so anything pending when we yield gets its turn before we resume.
    expect(order).toEqual(['pre-queued-immediate', 'after-yield']);
  });

  it('lets multiple pending immediates drain before resuming', async () => {
    const ran: number[] = [];
    setImmediate(() => ran.push(1));
    setImmediate(() => ran.push(2));
    setImmediate(() => ran.push(3));
    await yieldToEventLoop();
    expect(ran).toEqual([1, 2, 3]);
  });
});

describe('CooperativeYielder', () => {
  it('does NOT yield while under budget', async () => {
    // 10s budget — no test machine takes 10s between two awaits.
    const yielder = new CooperativeYielder(10_000);
    await yielder.tick();
    await yielder.tick();
    expect(yielder.yields).toBe(0);
  });

  it('yields once the budget has elapsed', async () => {
    // 0ms budget — the budget is always elapsed, so every tick yields.
    const yielder = new CooperativeYielder(0);
    await yielder.tick();
    expect(yielder.yields).toBe(1);
    await yielder.tick();
    await yielder.tick();
    expect(yielder.yields).toBe(3);
  });

  it('resets the budget after yielding', async () => {
    const yielder = new CooperativeYielder(10_000);
    // Force the budget to be elapsed without waiting: rewind the internal
    // clock. Runtime-accessible even though TS-private — test-only reach.
    (yielder as unknown as { last: number }).last = Date.now() - 20_000;
    await yielder.tick();
    expect(yielder.yields).toBe(1); // budget was elapsed → yielded
    // The yield reset `last` to now; with a 10s budget the very next tick
    // must NOT yield again.
    await yielder.tick();
    expect(yielder.yields).toBe(1);
  });

  it('defaults to a 25ms budget', async () => {
    const yielder = new CooperativeYielder();
    // Immediately after construction the budget cannot have elapsed.
    await yielder.tick();
    expect(yielder.yields).toBe(0);
  });
});
