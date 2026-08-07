/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSSE } from '@/hooks/useSSE';

type Listener = (e: MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  closed = false;
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
  private listeners: Record<string, Listener[]> = {};

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: Listener) {
    (this.listeners[type] ??= []).push(cb);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    for (const cb of this.listeners[type] ?? []) {
      cb({ data: JSON.stringify(data) } as MessageEvent);
    }
  }

  fail() {
    this.onerror?.call(this as unknown as EventSource, new Event('error'));
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useSSE connection state', () => {
  it('starts in "connecting" and opens the dashboard stream', () => {
    const { result } = renderHook(() => useSSE());
    expect(result.current.connectionState).toBe('connecting');
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe('/api/sse/dashboard');
  });

  it('moves to "connected" after the server connected event', () => {
    const { result } = renderHook(() => useSSE());
    act(() => {
      MockEventSource.instances[0].emit('connected', { clientId: 'c1' });
    });
    expect(result.current.connectionState).toBe('connected');
  });

  it('moves to "reconnecting" on stream error and back to "connected" after reconnect', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSSE());
    act(() => {
      MockEventSource.instances[0].emit('connected', { clientId: 'c1' });
    });
    expect(result.current.connectionState).toBe('connected');

    act(() => {
      MockEventSource.instances[0].fail();
    });
    expect(result.current.connectionState).toBe('reconnecting');
    expect(MockEventSource.instances[0].closed).toBe(true);

    // First backoff delay is 1s — a second EventSource should appear.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(MockEventSource.instances).toHaveLength(2);

    act(() => {
      MockEventSource.instances[1].emit('connected', { clientId: 'c2' });
    });
    expect(result.current.connectionState).toBe('connected');
  });

  it('still dispatches patient-update events to the callback', () => {
    const onPatientUpdate = vi.fn();
    renderHook(() => useSSE({ onPatientUpdate }));
    act(() => {
      MockEventSource.instances[0].emit('patient-update', { type: 'referral_update' });
    });
    expect(onPatientUpdate).toHaveBeenCalledWith({ type: 'referral_update' });
  });

  it('closes the stream on unmount', () => {
    const { unmount } = renderHook(() => useSSE());
    unmount();
    expect(MockEventSource.instances[0].closed).toBe(true);
  });
});
