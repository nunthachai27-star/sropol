// T090: Next.js middleware — route protection with NextAuth
// T108: Security headers middleware
import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

// Public paths that don't require authentication
const PUBLIC_PATHS = ['/login', '/about', '/api/auth', '/api/health', '/api/webhooks', '/api/referrals/check'];
const STATIC_PATHS = ['/_next', '/favicon.ico'];

// T108: Add security headers to all responses
function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
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
    return addSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  // Admin-only route protection
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    const userRole = (session.user as unknown as { role?: string }).role;
    if (userRole !== 'ADMIN') {
      return addSecurityHeaders(NextResponse.redirect(new URL('/', req.url)));
    }
  }

  return addSecurityHeaders(NextResponse.next());
});

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
