// In-process HTTP server that mimics the BMS Session API endpoints.
//
// Used by E2E tests and Playwright fixtures so the browser-direct BMS client
// (src/lib/bms-browser-client.ts) can hit a real HTTP server without needing
// a live BMS tunnel during tests.
//
// Listens on a random localhost port (port 0 — the OS picks a free one) and
// records every request for assertion purposes.

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';

interface RecordedRequest {
  method: string;
  path: string;
  body: unknown | null;
  auth: string | null;
}

export interface MockBmsServer {
  url: string;
  /** Register a SQL response for any query whose body.sql contains the substring */
  setSqlResponse(matchSubstring: string, data: unknown[]): void;
  /** Register a function response by name */
  setFunctionResponse(name: string, value: unknown): void;
  /** All requests received, oldest first */
  recordedRequests: RecordedRequest[];
  close(): Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk) => {
      buf += chunk.toString();
    });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export async function createMockBmsServer(): Promise<MockBmsServer> {
  const sqlResponses = new Map<string, unknown[]>();
  const functionResponses = new Map<string, unknown>();
  const recordedRequests: RecordedRequest[] = [];

  const server: Server = createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://placeholder');
    const path = url.pathname;
    const auth = req.headers.authorization ?? null;

    let bodyText = '';
    try {
      bodyText = await readBody(req);
    } catch {
      // ignore — body will stay empty
    }
    let body: unknown | null = null;
    if (bodyText) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = bodyText;
      }
    }
    recordedRequests.push({ method, path, body, auth });

    // POST /api/sql — match against registered substrings
    if (method === 'POST' && path === '/api/sql') {
      const sql = String((body as { sql?: string } | null)?.sql ?? '');
      let data: unknown[] = [];
      for (const [match, value] of sqlResponses) {
        if (sql.includes(match)) {
          data = value;
          break;
        }
      }
      return sendJson(res, { data, MessageCode: 200, Message: 'ok' });
    }

    // POST /api/function?name=...
    if (method === 'POST' && path === '/api/function') {
      const name = url.searchParams.get('name') ?? '';
      const value = functionResponses.has(name) ? functionResponses.get(name) : 0;
      const payload: Record<string, unknown> = { MessageCode: 200, Message: 'ok', Value: value };
      if (value !== null && typeof value === 'object') {
        Object.assign(payload, value as Record<string, unknown>);
      }
      return sendJson(res, payload);
    }

    // POST /api/rest/{table} — insert
    if (method === 'POST' && /^\/api\/rest\/[^/]+$/.test(path)) {
      return sendJson(res, { MessageCode: 200, Message: 'ok', insert_count: 1 });
    }

    // PUT /api/rest/{table}/{id} — update
    if (method === 'PUT' && /^\/api\/rest\/[^/]+\/[^/]+$/.test(path)) {
      return sendJson(res, { MessageCode: 200, Message: 'ok', update_count: 1 });
    }

    // DELETE /api/rest/{table}/{id}
    if (method === 'DELETE' && /^\/api\/rest\/[^/]+\/[^/]+$/.test(path)) {
      return sendJson(res, { MessageCode: 200, Message: 'ok' });
    }

    sendJson(res, { error: 'mock-bms: unhandled', path, method }, 404);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('createMockBmsServer: unable to determine bound address');
  }
  const url = `http://127.0.0.1:${addr.port}`;

  return {
    url,
    setSqlResponse: (match, data) => {
      sqlResponses.set(match, data);
    },
    setFunctionResponse: (name, value) => {
      functionResponses.set(name, value);
    },
    recordedRequests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        // Stop accepting new connections, then wait for in-flight to drain.
        server.close((err) => (err ? reject(err) : resolve()));
        // Best-effort: drop any keep-alive idle sockets so close() resolves
        // promptly under Vitest's afterEach timeout.
        server.closeIdleConnections?.();
      }),
  };
}
