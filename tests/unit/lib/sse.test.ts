// Unit tests for src/lib/sse.ts — SseManager singleton
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SseManager } from '@/lib/sse';

function createMockController() {
  const chunks: Uint8Array[] = [];
  const controller = {
    enqueue: vi.fn((chunk: Uint8Array) => chunks.push(chunk)),
    close: vi.fn(),
  } as unknown as ReadableStreamDefaultController;
  return { controller, chunks };
}

function decodeChunks(chunks: Uint8Array[]): string {
  const decoder = new TextDecoder();
  return chunks.map((c) => decoder.decode(c)).join('');
}

describe('SseManager', () => {
  let manager: SseManager;

  beforeEach(() => {
    vi.useFakeTimers();
    // Clean slate for each test (afterEach resets, this covers the first test)
    SseManager.resetForTests();
    manager = SseManager.getInstance();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Reset the singleton (and its globalThis pin) so each test gets a fresh instance
    SseManager.resetForTests();
  });

  it('starts with zero clients', () => {
    expect(manager.getClientCount()).toBe(0);
  });

  it('returns the same singleton instance', () => {
    const instance1 = SseManager.getInstance();
    const instance2 = SseManager.getInstance();
    expect(instance1).toBe(instance2);
  });

  it('adds a client and increases client count', () => {
    const { controller } = createMockController();
    manager.addClient('client-1', controller);
    expect(manager.getClientCount()).toBe(1);
  });

  it('adds multiple clients', () => {
    const { controller: c1 } = createMockController();
    const { controller: c2 } = createMockController();
    manager.addClient('client-1', c1);
    manager.addClient('client-2', c2);
    expect(manager.getClientCount()).toBe(2);
  });

  it('removes a client and decreases client count', () => {
    const { controller } = createMockController();
    manager.addClient('client-1', controller);
    expect(manager.getClientCount()).toBe(1);

    manager.removeClient('client-1');
    expect(manager.getClientCount()).toBe(0);
  });

  it('removing a non-existent client does not throw', () => {
    expect(() => manager.removeClient('nonexistent')).not.toThrow();
  });

  it('broadcasts events to all connected clients', () => {
    const mock1 = createMockController();
    const mock2 = createMockController();
    manager.addClient('client-1', mock1.controller);
    manager.addClient('client-2', mock2.controller);

    manager.broadcast('patient-update', { an: '123' });

    const expected = 'event: patient-update\ndata: {"an":"123"}\n\n';

    expect(decodeChunks(mock1.chunks)).toBe(expected);
    expect(decodeChunks(mock2.chunks)).toBe(expected);
  });

  it('broadcasts correct SSE format', () => {
    const mock = createMockController();
    manager.addClient('client-1', mock.controller);

    manager.broadcast('sync-complete', { hospital: 'KK', count: 5 });

    const output = decodeChunks(mock.chunks);
    expect(output).toContain('event: sync-complete');
    expect(output).toContain('data: {"hospital":"KK","count":5}');
    // Must end with double newline per SSE spec
    expect(output).toMatch(/\n\n$/);
  });

  it('handles client disconnect gracefully during broadcast', () => {
    const goodMock = createMockController();
    const badController = {
      enqueue: vi.fn(() => {
        throw new Error('Stream closed');
      }),
      close: vi.fn(),
    } as unknown as ReadableStreamDefaultController;

    manager.addClient('good-client', goodMock.controller);
    manager.addClient('bad-client', badController);

    expect(manager.getClientCount()).toBe(2);

    // Broadcast should not throw even if one client errors
    expect(() => manager.broadcast('test-event', { ok: true })).not.toThrow();

    // The bad client should have been removed
    expect(manager.getClientCount()).toBe(1);

    // The good client should still have received the message
    expect(decodeChunks(goodMock.chunks)).toContain('event: test-event');
  });

  it('sends heartbeat pings to all clients every 30 seconds', () => {
    const mock = createMockController();
    manager.addClient('client-1', mock.controller);

    // Advance timer by 30 seconds to trigger heartbeat
    vi.advanceTimersByTime(30000);

    const output = decodeChunks(mock.chunks);
    expect(output).toContain(': ping');
  });

  it('removes disconnected clients during heartbeat', () => {
    const badController = {
      enqueue: vi.fn(() => {
        throw new Error('Stream closed');
      }),
      close: vi.fn(),
    } as unknown as ReadableStreamDefaultController;

    manager.addClient('bad-client', badController);
    expect(manager.getClientCount()).toBe(1);

    // Trigger heartbeat
    vi.advanceTimersByTime(30000);

    // Client that errored should be removed
    expect(manager.getClientCount()).toBe(0);
  });

  it('destroy clears all clients and stops heartbeat', () => {
    const mock = createMockController();
    manager.addClient('client-1', mock.controller);
    expect(manager.getClientCount()).toBe(1);

    manager.destroy();
    expect(manager.getClientCount()).toBe(0);
  });

  it('broadcast to zero clients does not throw', () => {
    expect(() => manager.broadcast('test', { data: 1 })).not.toThrow();
  });

  it('replaces a client with the same ID', () => {
    const mock1 = createMockController();
    const mock2 = createMockController();

    manager.addClient('same-id', mock1.controller);
    manager.addClient('same-id', mock2.controller);

    // Map.set replaces the value — count should still be 1
    expect(manager.getClientCount()).toBe(1);

    // Broadcasting should only reach the second controller
    manager.broadcast('test', { val: 42 });
    expect(mock2.chunks.length).toBe(1);
    // The first controller should NOT receive the broadcast
    expect(mock1.chunks.length).toBe(0);
  });

  // Per-user targeting backs video-call signaling: a ring must reach every
  // open tab of the callee and nobody else.
  describe('per-user targeting', () => {
    it('sendToUser reaches only clients registered with that userId', () => {
      const alice = createMockController();
      const bob = createMockController();
      manager.addClient('tab-alice', alice.controller, 'user-alice');
      manager.addClient('tab-bob', bob.controller, 'user-bob');

      const delivered = manager.sendToUser('user-alice', 'call:invite', { callId: 'c1' });

      expect(delivered).toBe(1);
      expect(decodeChunks(alice.chunks)).toBe('event: call:invite\ndata: {"callId":"c1"}\n\n');
      expect(bob.chunks.length).toBe(0);
    });

    it('reaches every tab of the same user', () => {
      const tab1 = createMockController();
      const tab2 = createMockController();
      manager.addClient('tab-1', tab1.controller, 'user-alice');
      manager.addClient('tab-2', tab2.controller, 'user-alice');

      const delivered = manager.sendToUser('user-alice', 'call:invite', { callId: 'c1' });

      expect(delivered).toBe(2);
      expect(decodeChunks(tab1.chunks)).toContain('call:invite');
      expect(decodeChunks(tab2.chunks)).toContain('call:invite');
    });

    it('returns 0 and does not throw when the user has no connected tabs', () => {
      const other = createMockController();
      manager.addClient('tab-other', other.controller, 'user-bob');

      expect(manager.sendToUser('user-nobody', 'call:invite', {})).toBe(0);
      expect(other.chunks.length).toBe(0);
    });

    it('does not target clients registered without a userId', () => {
      const anonymous = createMockController();
      manager.addClient('dashboard-tab', anonymous.controller);

      expect(manager.sendToUser('dashboard-tab', 'call:invite', {})).toBe(0);
      expect(anonymous.chunks.length).toBe(0);
    });

    it('removes dead clients encountered during sendToUser', () => {
      const badController = {
        enqueue: vi.fn(() => {
          throw new Error('Stream closed');
        }),
        close: vi.fn(),
      } as unknown as ReadableStreamDefaultController;
      manager.addClient('dead-tab', badController, 'user-alice');

      expect(manager.sendToUser('user-alice', 'call:invite', {})).toBe(0);
      expect(manager.getClientCount()).toBe(0);
    });

    it('broadcast still reaches clients registered with a userId', () => {
      const mock = createMockController();
      manager.addClient('tab-1', mock.controller, 'user-alice');

      manager.broadcast('sync-complete', { ok: true });
      expect(decodeChunks(mock.chunks)).toContain('sync-complete');
    });
  });

  // Next.js bundles route handlers separately: a static-field singleton can
  // fragment into one instance per bundle (same failure mode as __dbSingleton).
  // Pinning on globalThis guarantees callers in every bundle share the client map.
  it('pins the singleton on globalThis so all bundles share one instance', () => {
    const instance = SseManager.getInstance();
    const g = globalThis as unknown as { __sseManager?: SseManager };
    expect(g.__sseManager).toBe(instance);
  });
});
