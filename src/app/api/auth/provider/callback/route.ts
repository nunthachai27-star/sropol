import { NextResponse, type NextRequest } from 'next/server';
import { completeProviderOAuth } from '@/lib/provider-id';
import { storeProviderPendingSession } from '@/lib/provider-id-session-store';
import { logger } from '@/lib/logger';

const STATE_COOKIE = 'kk-lrms-provider-oauth-state';
const CALLBACK_COOKIE = 'kk-lrms-provider-callback-url';

function getBaseUrl(request: NextRequest): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL.replace(/\/$/, '');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https';
  const host = forwardedHost ?? request.headers.get('host');
  return host ? `${forwardedProto}://${host}` : request.nextUrl.origin;
}

function sanitizeCallbackUrl(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

function redirectToLogin(request: NextRequest, message: string): NextResponse {
  return NextResponse.redirect(
    new URL(`/login?providerError=${encodeURIComponent(message)}`, request.url),
  );
}

export async function GET(request: NextRequest) {
  const error = request.nextUrl.searchParams.get('error');
  if (error) {
    return redirectToLogin(request, request.nextUrl.searchParams.get('error_description') ?? error);
  }

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const expectedState = request.cookies.get(STATE_COOKIE)?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectToLogin(request, 'ProviderID login state is invalid or expired');
  }

  const baseUrl = getBaseUrl(request);
  const redirectUri = `${baseUrl}/api/auth/provider/callback`;
  const callbackUrl = sanitizeCallbackUrl(request.cookies.get(CALLBACK_COOKIE)?.value);

  try {
    const pending = await completeProviderOAuth(code, redirectUri);
    const token = storeProviderPendingSession(pending);
    const completeUrl = new URL('/provider/complete', baseUrl);
    completeUrl.searchParams.set('token', token);
    completeUrl.searchParams.set('callbackUrl', callbackUrl);

    const response = NextResponse.redirect(completeUrl);
    response.cookies.delete(STATE_COOKIE);
    response.cookies.delete(CALLBACK_COOKIE);
    return response;
  } catch (err) {
    logger.error('provider_id_callback_failed', { error: err });
    const message = err instanceof Error ? err.message : 'ProviderID login failed';
    const response = redirectToLogin(request, message);
    response.cookies.delete(STATE_COOKIE);
    response.cookies.delete(CALLBACK_COOKIE);
    return response;
  }
}
