// CSRF origin validation for cookie-authenticated mutations.
// Edge-pure: no Node-only imports — consumed by src/middleware.ts.
// The session cookie is SameSite=None (iframe embedding requirement), so the
// browser attaches it to cross-site requests; this check is the CSRF control.

export interface OriginCheckInput {
  method: string;
  /** Origin request header (null when the client did not send one). */
  origin: string | null;
  /** Sec-Fetch-Site request header (modern browsers only). */
  secFetchSite: string | null;
  /** Origin the request actually arrived on (req.nextUrl.origin). */
  requestOrigin: string;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function parseTrustedOrigins(
  nextauthUrl: string | undefined = process.env.NEXTAUTH_URL,
  extra: string | undefined = process.env.CSRF_TRUSTED_ORIGINS,
): string[] {
  const origins: string[] = [];
  if (nextauthUrl) {
    try {
      origins.push(new URL(nextauthUrl).origin);
    } catch {
      // invalid NEXTAUTH_URL contributes no trusted origin
    }
  }
  for (const raw of (extra ?? '').split(',')) {
    const candidate = raw.trim();
    if (!candidate) continue;
    try {
      origins.push(new URL(candidate).origin);
    } catch {
      // skip malformed entries
    }
  }
  return origins;
}

export function isRequestOriginTrusted(
  input: OriginCheckInput,
  trusted: string[] = parseTrustedOrigins(),
): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return true;
  if (input.origin) {
    // OWASP: Origin must match the target origin or an explicit allow-list.
    return input.origin === input.requestOrigin || trusted.includes(input.origin);
  }
  if (input.secFetchSite) {
    return input.secFetchSite !== 'cross-site';
  }
  // Neither header: non-browser client (curl, HOSxP Delphi). Browsers always
  // send at least one of them on credentialed cross-site requests.
  return true;
}

/**
 * Content-type gate for JSON-only mutation handlers (spec 1.2.5): form
 * content types (urlencoded/multipart/text-plain) are CSRF "simple request"
 * vectors and are never legitimate for these routes. Applied per-route (the
 * repo has multipart upload routes, so this must NOT be a global gate).
 */
export function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return contentType.split(';')[0].trim().toLowerCase() === 'application/json';
}
