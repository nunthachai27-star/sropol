import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import { buildProviderAuthorizeUrl } from '@/lib/provider-id';
import { logger } from '@/lib/logger';

const STATE_COOKIE = 'kk-lrms-provider-oauth-state';
const CALLBACK_COOKIE = 'kk-lrms-provider-callback-url';
const COOKIE_MAX_AGE_SECONDS = 5 * 60;

function getBaseUrl(request: NextRequest): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL.replace(/\/$/, '');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https';
  const host = forwardedHost ?? request.headers.get('host');
  return host ? `${forwardedProto}://${host}` : request.nextUrl.origin;
}

function sanitizeCallbackUrl(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export async function GET(request: NextRequest) {
  try {
    const state = randomBytes(24).toString('base64url');
    const baseUrl = getBaseUrl(request);
    const redirectUri = `${baseUrl}/api/auth/provider/callback`;
    const authorizeUrl = buildProviderAuthorizeUrl(redirectUri, state);
    const callbackUrl = sanitizeCallbackUrl(request.nextUrl.searchParams.get('callbackUrl'));

    const response = NextResponse.redirect(authorizeUrl);
    const cookieOptions = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: COOKIE_MAX_AGE_SECONDS,
    };
    response.cookies.set(STATE_COOKIE, state, cookieOptions);
    response.cookies.set(CALLBACK_COOKIE, callbackUrl, cookieOptions);
    return response;
  } catch (error) {
    logger.error('provider_id_start_failed', { error });
    return NextResponse.redirect(new URL('/login?error=provider_id_not_configured', request.url));
  }
}
