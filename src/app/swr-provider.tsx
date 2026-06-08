// SWR global provider with 30s deduping interval
'use client';

import { SWRConfig } from 'swr';
import { withBasePath } from '@/lib/base-path';

// Throw on non-2xx so SWR populates `error` instead of handing components a
// 500 body typed as success data. Carries the HTTP status + parsed error
// message so the UI can render a real reason ("column X does not exist")
// instead of a silent empty state.
class FetchError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
    this.body = body;
  }
}

function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const err = (body as { error?: unknown }).error;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return null;
}

async function fetcher(url: string): Promise<unknown> {
  // SWR cache keys stay the bare "/api/..." path; only the wire request is
  // prefixed with the deployment base path. Keeps mutate(key) call sites intact.
  const res = await fetch(withBasePath(url));
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    // API contract returns either { error: "string" } (legacy) or
    // { error: { code, message, details } } (current). Extract the human
    // message from whichever shape is present so the UI can show
    // "ไม่พบข้อมูลการตั้งครรภ์" instead of the generic "500 Internal Server
    // Error" status text.
    const message = extractErrorMessage(body) ?? `${res.status} ${res.statusText || 'Request failed'}`;
    throw new FetchError(res.status, message, body);
  }
  return body;
}

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher,
        dedupingInterval: 30000,
        revalidateOnFocus: true,
        errorRetryCount: 3,
      }}
    >
      {children}
    </SWRConfig>
  );
}
