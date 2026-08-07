// Security headers applied by middleware.ts to every response. Kept in its
// own module (no NextAuth imports) so unit tests can cover the policy without
// booting the auth stack.
//
// NOTE: X-Frame-Options is intentionally NOT set, and CSP frame-ancestors is
// wide open (*) so KK-LRMS can be embedded inside HOSxP / marketplace / other
// partner hospital portals. Product requirement, not a misconfiguration.
// Clickjacking mitigations (session binding to bms-session-id, no destructive
// one-click actions without confirm) live at the app layer instead.
//
// Camera/microphone MUST stay allowed for self + the Jitsi origin: the empty
// allowlist form (camera=()) blocked getUserMedia inside the embedded Jitsi
// iframe site-wide — video calls connected but had no media (2026-07-11
// incident). Guarded by tests/unit/middleware-headers.test.ts.
import type { NextResponse } from 'next/server';
import { JITSI_DOMAIN } from '@/config/video-call';

// Exported so the Playwright media smoke test can serve its harness page with
// the EXACT production policy — a regression to camera=() fails that test too.
export const PERMISSIONS_POLICY = `camera=(self "https://${JITSI_DOMAIN}"), microphone=(self "https://${JITSI_DOMAIN}"), geolocation=()`;

export function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', PERMISSIONS_POLICY);
  response.headers.set('Content-Security-Policy', 'frame-ancestors *');
  // HSTS - only in production
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return response;
}
