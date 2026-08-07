// Cooperative event-loop yielding for long synchronous-CPU service loops.
//
// Production incident (2026-07-17 page-latency diagnosis): the app is ONE
// Next.js standalone Node process, and browser-push sync processing (ANC
// bundles of hundreds of pregnancies × rule classification × per-field AES,
// plus the labor-patient loops in src/services/webhook.ts) ran multi-second
// synchronous-CPU stretches on the serving event loop. Every page request
// stalled behind them: static /login TTFB measured 17-58ms normally but
// 3-7.2s during a push burst, with the main JS thread at 91% CPU.
//
// The fix is NOT to reduce total CPU — it is to bound the stall granularity:
// hand control back to the event loop every ~25ms of work so pending HTTP
// requests interleave with sync processing.

/**
 * Hand control back to the Node event loop for one turn.
 *
 * Uses `setImmediate`, NOT `setTimeout(0)`: setImmediate callbacks run in the
 * event loop's **check phase, after the poll phase**, so any pending I/O and
 * HTTP events get processed before the caller resumes. `setTimeout(0)` runs
 * in the timers phase with a clamped minimum delay and does not give the poll
 * phase the same guaranteed turn per yield.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Time-budget-based cooperative yielder for hot service loops.
 *
 * Call `await yielder.tick()` at the top of each outer loop iteration
 * (OUTSIDE any db.transaction body — never lengthen a transaction's lock
 * hold time with a yield). Under budget it is a no-op costing one Date.now()
 * call; once `budgetMs` of wall-clock work has accumulated it yields one
 * event-loop turn and resets.
 *
 * Time-budget rather than every-N-items so the stall bound holds regardless
 * of per-item cost (one pregnancy with 40 visits and one with none both
 * count by elapsed time, not by row).
 *
 * Why 25ms: a few ticks per human-perceptible frame — concurrent HTTP
 * requests wait at most ~25ms for the loop instead of multi-second bursts,
 * while the added wall-clock overhead of the extra event-loop turns stays
 * under ~1% of total processing time. Reference: 2026-07-17 production
 * page-latency incident (see module header).
 */
export class CooperativeYielder {
  private last = Date.now();
  private yielded = 0;

  constructor(private budgetMs = 25) {}

  /** Number of actual yields performed — observability/test seam. */
  get yields(): number {
    return this.yielded;
  }

  async tick(): Promise<void> {
    if (Date.now() - this.last >= this.budgetMs) {
      await yieldToEventLoop();
      this.yielded++;
      this.last = Date.now();
    }
  }
}
