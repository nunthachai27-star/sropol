// T090: Next.js middleware — route protection with NextAuth
// T108: Security headers middleware
import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

// /hospital-maternity-ward is gated by NextAuth (existing redirect) +
// BmsSessionContext at the page level (no middleware-level userType check).

// Public paths that don't require authentication
const PUBLIC_PATHS = ['/login', '/provider/complete', '/about', '/api/auth', '/api/health', '/api/webhooks', '/api/referrals/check'];
const STATIC_PATHS = ['/_next', '/favicon.ico'];
const READONLY_BLOCKED_API_PREFIXES = [
  '/api/admin',
  '/api/onboarding',
  '/api/sync/trigger',
  '/api/referrals',
  '/api/hospital/audit-log',
];
// Dev-only API routes that are already guarded server-side by simulationGuard()
// (which throws 404 in production). Listing them here lets local CLI tooling
// curl them without a NextAuth cookie. No-op in prod because the guard fires first.
const DEV_ONLY_API_PATHS = ['/api/dev/simulate', '/api/dev/smoke-tab-update'];

// T108: Add security headers to all responses
//
// NOTE: X-Frame-Options is intentionally NOT set, and CSP frame-ancestors is
// wide open (*) so KK-LRMS can be embedded inside HOSxP / marketplace / other
// partner hospital portals. Product requirement, not a misconfiguration.
// Clickjacking mitigations (session binding to bms-session-id, no destructive
// one-click actions without confirm) live at the app layer instead.
function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('Content-Security-Policy', "frame-ancestors *");
  // HSTS - only in production
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return response;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Allow static assets and public paths
  if (STATIC_PATHS.some((p) => pathname.startsWith(p))) {
    return addSecurityHeaders(NextResponse.next());
  }

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return addSecurityHeaders(NextResponse.next());
  }

  // Dev-only API routes — server-side guard blocks them in production anyway.
  if (
    process.env.NODE_ENV !== 'production' &&
    DEV_ONLY_API_PATHS.some((p) => pathname.startsWith(p))
  ) {
    return addSecurityHeaders(NextResponse.next());
  }

  // Check authentication
  const session = req.auth;
  if (!session?.user) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    // Preserve bms-session-id for auto-login
    const bmsSessionId = req.nextUrl.searchParams.get('bms-session-id');
    if (bmsSessionId) {
      loginUrl.searchParams.set('bms-session-id', bmsSessionId);
    }
    // Preserve marketplace_token (snake_case OR kebab-case — launchers vary)
    // so BmsSessionProvider can pair it with the new session on the next page.
    const marketplaceToken =
      req.nextUrl.searchParams.get('marketplace_token') ??
      req.nextUrl.searchParams.get('marketplace-token');
    if (marketplaceToken) {
      loginUrl.searchParams.set('marketplace_token', marketplaceToken);
    }
    return addSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  if (session.user.accessMode === 'readonly') {
    if (pathname.startsWith('/admin')) {
      return addSecurityHeaders(NextResponse.redirect(new URL('/', req.url)));
    }
    if (
      req.method !== 'GET' &&
      READONLY_BLOCKED_API_PREFIXES.some((p) => pathname.startsWith(p))
    ) {
      return addSecurityHeaders(
        NextResponse.json(
          { error: 'readonly_session', message: 'ProviderID sessions are read-only' },
          { status: 403 },
        ),
      );
    }
  }

  // Admin-only route protection. Two gates, both must pass:
  //   1. role === 'ADMIN'  (BMS-derived, may be promoted by DEV_AUTH_BYPASS).
  //   2. user_cid in ADMIN_ALLOWED_CIDS  (when env var is non-empty).
  // The CID gate exists because (a) `mapPositionToRole` grants ADMIN to anyone
  // whose BMS position contains "director"/"ผู้อำนวยการ", and (b) DEV_AUTH_BYPASS
  // promotes everyone to ADMIN — neither is acceptable as the sole gate for
  // production /admin access. The allow-list short-circuits both.
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    if (session.user.role !== 'ADMIN') {
      return addSecurityHeaders(NextResponse.redirect(new URL('/', req.url)));
    }
    const allowList = (process.env.ADMIN_ALLOWED_CIDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowList.length > 0) {
      const cid = session.user.userCid ?? '';
      if (!cid || !allowList.includes(cid)) {
        return addSecurityHeaders(NextResponse.redirect(new URL('/', req.url)));
      }
    }
  }

  return addSecurityHeaders(NextResponse.next());
});

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
