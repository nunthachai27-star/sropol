// Security headers — regression test for the production incident where
// `Permissions-Policy: camera=(), microphone=()` (empty allowlists) blocked
// getUserMedia inside the embedded Jitsi iframe on every page: calls
// connected but nobody had camera or mic. Camera/mic must be allowed for
// self and the Jitsi origin; geolocation stays denied.
import { describe, it, expect } from 'vitest';
import { NextResponse } from 'next/server';
import { addSecurityHeaders } from '@/lib/security-headers';
import { JITSI_DOMAIN } from '@/config/video-call';

describe('addSecurityHeaders', () => {
  it('allows camera and microphone for self and the Jitsi origin', () => {
    const response = addSecurityHeaders(NextResponse.next());
    const policy = response.headers.get('Permissions-Policy') ?? '';

    expect(policy).toContain(`camera=(self "https://${JITSI_DOMAIN}")`);
    expect(policy).toContain(`microphone=(self "https://${JITSI_DOMAIN}")`);
    // Regression guard: the empty allowlist form must never come back.
    expect(policy).not.toContain('camera=()');
    expect(policy).not.toContain('microphone=()');
  });

  it('still denies geolocation and keeps the embed-friendly frame policy', () => {
    const response = addSecurityHeaders(NextResponse.next());
    expect(response.headers.get('Permissions-Policy')).toContain('geolocation=()');
    expect(response.headers.get('Content-Security-Policy')).toBe('frame-ancestors *');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
