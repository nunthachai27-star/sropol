// Base path helper for serving KK-LRMS under a URL sub-path
// (e.g. https://surintelehealth.com/sr-lrms).
//
// Next.js `basePath` auto-prefixes <Link>, router navigation, <Image> and
// /_next assets — but NOT raw `fetch('/api/...')`, `new EventSource('/...')`,
// `window.location.href = '/...'`, middleware `NextResponse.redirect`, or
// `new URL('/path', base)`. Those must be prefixed manually with this helper.
//
// Driven entirely by NEXT_PUBLIC_BASE_PATH (inlined at build, available on both
// client and Edge/middleware). Default empty string = root deployment, so the
// existing bmscloud root install and all unit tests behave exactly as before;
// prefixing only activates when the env var is set to e.g. "/sr-lrms".

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Prefix an absolute app path with the configured base path.
 * Only rewrites root-relative paths ("/api/..."); absolute URLs
 * ("https://...") and already-prefixed paths are returned untouched.
 */
export function withBasePath(path: string): string {
  if (!BASE_PATH) return path;
  // Leave absolute URLs and protocol-relative URLs alone.
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  // Idempotent: don't double-prefix.
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) return path;
  return `${BASE_PATH}${path}`;
}

/**
 * fetch() wrapper that prepends the base path to root-relative request URLs.
 * Drop-in replacement for `fetch('/api/...')` in client code.
 */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(withBasePath(input), init);
}
