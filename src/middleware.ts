// T090: Next.js middleware — route protection with NextAuth
// T108: Security headers middleware
//
// Edge-runtime constraint: this file is bundled for the Edge, which has no
// Node `crypto`/DB/fs. We import the Edge-safe `authConfig` directly and build
// our own `auth()` instance here, so the full Node-side `@/lib/auth` (with
// Credentials providers, DB-backed hospital-access-guard, ProviderID session
// store, sync services) never reaches this bundle.
import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth.config';
import { isAdminAuthorized } from '@/lib/admin-access';
import { addSecurityHeaders } from '@/lib/security-headers';
import { isRequestOriginTrusted } from '@/lib/request-origin';
import { apiError } from '@/lib/api-errors';
import { logger } from '@/lib/logger';
import { NextResponse } from 'next/server';

const { auth } = NextAuth(authConfig);

// /hospital-maternity-ward is gated by NextAuth (existing redirect) +
// BmsSessionContext at the page level (no middleware-level userType check).

// Public paths that don't require authentication.
// /deck is the MOPH executive briefing deck (no PHI, presentation assets only).
// Public so the briefing room laptop can open it directly via URL without
// requiring a BMS session.
const PUBLIC_PATHS = [
  '/login',
  '/provider/complete',
  '/about',
  '/deck',
  '/api/auth',
  '/api/health',
  '/api/webhooks',
  '/api/referrals/check',
];
const STATIC_PATHS = ['/_next', '/favicon.ico'];
const READONLY_BLOCKED_API_PREFIXES = [
  '/api/admin',
  '/api/onboarding',
  '/api/sync/trigger',
  '/api/referrals',
  '/api/hospital/audit-log',
  '/api/dev',
];
// Dev-only API routes. In production isSimulationEnabled() is hard-false and
// every handler 404s via simulationGuard(); this unauthenticated middleware
// bypass additionally only applies when NODE_ENV !== 'production'.
const DEV_ONLY_API_PATHS = ['/api/dev/simulate', '/api/dev/smoke-tab-update'];

// T108: security headers for all responses — policy + rationale live in
// src/lib/security-headers.ts (NextAuth-free so unit tests can import it).

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

  // CSRF: cookie-authenticated mutations must come from a trusted origin.
  // Public paths (webhooks, /api/auth) never reach this point.
  if (
    !isRequestOriginTrusted({
      method: req.method,
      origin: req.headers.get('origin'),
      secFetchSite: req.headers.get('sec-fetch-site'),
      requestOrigin: req.nextUrl.origin,
    })
  ) {
    return addSecurityHeaders(NextResponse.json(apiError('CSRF_ORIGIN_REJECTED'), { status: 403 }));
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
    if (req.method !== 'GET' && READONLY_BLOCKED_API_PREFIXES.some((p) => pathname.startsWith(p))) {
      return addSecurityHeaders(
        NextResponse.json(
          { error: 'readonly_session', message: 'ProviderID sessions are read-only' },
          { status: 403 },
        ),
      );
    }
  }

  // Admin-only route protection. The role / CID / readonly rule lives in ONE
  // place — isAdminAuthorized (@/lib/admin-access) — shared verbatim with the
  // handler-level requireAdmin() guard so the two enforcement layers can never
  // diverge. See that module for why the CID allow-list gate exists.
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    if (
      !isAdminAuthorized({
        role: session.user.role,
        userCid: session.user.userCid,
        accessMode: session.user.accessMode,
      })
    ) {
      logger.warn('admin_access_denied_middleware', {
        pathname,
        role: session.user.role,
        accessMode: session.user.accessMode,
        userIdLast4: session.user.userCid?.slice(-4) ?? '',
      });
      return addSecurityHeaders(NextResponse.redirect(new URL('/', req.url)));
    }
  }

  return addSecurityHeaders(NextResponse.next());
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
