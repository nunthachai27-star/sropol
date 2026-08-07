import '@testing-library/jest-dom/vitest';

// jsdom has no EventSource. CallProvider (mounted by both route-group
// layouts) opens a per-user SSE stream, so layout-rendering tests need a
// minimal stand-in. Tests that care about SSE semantics use the real
// SseManager server-side (tests/unit/lib/sse.test.ts) — this stub only keeps
// jsdom renders from crashing.
class EventSourceStub {
  static readonly instances: EventSourceStub[] = [];
  readonly url: string;
  readyState = 0;

  constructor(url: string) {
    this.url = url;
    EventSourceStub.instances.push(this);
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {
    this.readyState = 2;
  }
}

if (typeof globalThis.EventSource === 'undefined') {
  (globalThis as { EventSource?: unknown }).EventSource = EventSourceStub;
}
