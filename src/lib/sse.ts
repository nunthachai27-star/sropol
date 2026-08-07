// T038: SSE event emitter — singleton SseManager
//
// Supports two delivery modes:
//   broadcast(event, data)          — every connected client (dashboard updates)
//   sendToUser(userId, event, data) — every tab of one user (video-call signaling)

interface SseClient {
  id: string;
  controller: ReadableStreamDefaultController;
  // Set for authenticated per-user streams (/api/sse/calls); undefined for
  // anonymous broadcast streams (/api/sse/dashboard).
  userId?: string;
}

// Next.js bundles route handlers separately and reloads modules on HMR, so a
// static-field singleton fragments into one instance per bundle — a call
// placed through /api/calls would ring into a different client map than the
// one /api/sse/calls registered with. Pinning on globalThis guarantees one
// instance per Node process (same pattern as __dbSingleton / __pgliteLock).
const _global = globalThis as unknown as { __sseManager?: SseManager };

export class SseManager {
  private clients: Map<string, SseClient> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    // Start heartbeat every 30s to keep connections alive
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 30000);
  }

  static getInstance(): SseManager {
    if (!_global.__sseManager) {
      _global.__sseManager = new SseManager();
    }
    return _global.__sseManager;
  }

  /** Tear down the singleton and its globalThis pin so tests start clean. */
  static resetForTests(): void {
    _global.__sseManager?.destroy();
    _global.__sseManager = undefined;
  }

  addClient(id: string, controller: ReadableStreamDefaultController, userId?: string): void {
    this.clients.set(id, { id, controller, userId });
  }

  removeClient(id: string): void {
    this.clients.delete(id);
  }

  broadcast(event: string, data: unknown): void {
    const encoded = encodeEvent(event, data);
    for (const [clientId, client] of this.clients) {
      this.enqueueOrDrop(clientId, client, encoded);
    }
  }

  /**
   * Deliver an event to every connected tab of one user. Returns the number
   * of tabs reached — 0 means the user has no live stream (offline or all
   * tabs dead), which callers like the video-call service surface as
   * "callee unreachable" instead of ringing into the void.
   */
  sendToUser(userId: string, event: string, data: unknown): number {
    const encoded = encodeEvent(event, data);
    let delivered = 0;
    for (const [clientId, client] of this.clients) {
      if (client.userId === undefined || client.userId !== userId) continue;
      if (this.enqueueOrDrop(clientId, client, encoded)) delivered++;
    }
    return delivered;
  }

  /** Enqueue to one client; on failure remove it. Returns delivery success. */
  private enqueueOrDrop(clientId: string, client: SseClient, chunk: Uint8Array): boolean {
    try {
      client.controller.enqueue(chunk);
      return true;
    } catch {
      // Client disconnected — remove
      this.clients.delete(clientId);
      return false;
    }
  }

  private sendHeartbeat(): void {
    const encoder = new TextEncoder();
    const ping = encoder.encode(': ping\n\n');
    for (const [clientId, client] of this.clients) {
      this.enqueueOrDrop(clientId, client, ping);
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.clients.clear();
  }
}

function encodeEvent(event: string, data: unknown): Uint8Array {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  return new TextEncoder().encode(message);
}
