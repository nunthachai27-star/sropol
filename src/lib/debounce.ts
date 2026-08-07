// Leading+trailing debounce for SSE-driven refresh handlers.
//
// Why this exists (2026-07-17 dashboard incident): bulk hospital-sync cycles
// used to emit one SSE event per upserted row, and every open dashboard tab
// reacted to EVERY event with an immediate refetch — ~79 req/s from four
// sessions. Server-side the broadcasts are now coalesced per cycle, but the
// client must still bound its reaction rate: with many hospitals syncing
// concurrently, even one event per hospital per cycle arrives continuously.
//
// Semantics: the FIRST call in a quiet period fires immediately (leading
// edge — the dashboard reflects fresh data with no perceived lag). Calls
// during the wait window coalesce into at most ONE trailing invocation at
// the end of the window. So the wrapped function runs at most twice per
// window, and reflects the latest state after any burst.
export function debounceLeadingTrailing(fn: () => void, waitMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;

  return () => {
    if (timer === null) {
      fn(); // leading edge
      timer = setTimeout(function flush() {
        if (pending) {
          pending = false;
          fn(); // trailing edge — one refresh for the whole burst
          timer = setTimeout(flush, waitMs);
        } else {
          timer = null;
        }
      }, waitMs);
    } else {
      pending = true;
    }
  };
}

/** Default reaction window for SSE-driven SWR revalidation. */
export const SSE_REFRESH_DEBOUNCE_MS = 10_000;
