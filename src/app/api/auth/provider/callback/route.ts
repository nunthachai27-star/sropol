import { NextResponse, type NextRequest } from 'next/server';
import { completeProviderOAuth } from '@/lib/provider-id';
import { storeProviderPendingSession } from '@/lib/provider-id-session-store';
import { logger } from '@/lib/logger';
import { withBasePath } from '@/lib/base-path';

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
    new URL(withBasePath(`/login?providerError=${encodeURIComponent(message)}`), request.url),
  );
}

export async function GET(request: NextRequest) {
  const error = request.nextUrl.searchParams.get('error');
  const errorDescription = request.nextUrl.searchParams.get('error_description');
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const expectedState = request.cookies.get(STATE_COOKIE)?.value;
  const flowId = (state ?? expectedState ?? '').slice(0, 8) || 'no-state';

  logger.info('provider_id_callback_received', {
    flowId,
    hasCode: Boolean(code),
    hasState: Boolean(state),
    hasExpectedState: Boolean(expectedState),
    stateMatch: Boolean(state && expectedState && state === expectedState),
    oauthError: error,
    oauthErrorDescription: errorDescription,
    host: request.headers.get('host') ?? null,
    forwardedHost: request.headers.get('x-forwarded-host') ?? null,
  });

  if (error) {
    logger.warn('provider_id_callback_oauth_error', {
      flowId,
      error,
      errorDescription,
    });
    return redirectToLogin(request, errorDescription ?? error);
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    logger.warn('provider_id_callback_state_invalid', {
      flowId,
      hasCode: Boolean(code),
      hasState: Boolean(state),
      hasExpectedState: Boolean(expectedState),
      stateMatch: Boolean(state && expectedState && state === expectedState),
    });
    return redirectToLogin(request, 'ProviderID login state is invalid or expired');
  }

  const baseUrl = getBaseUrl(request);
  const redirectUri = `${baseUrl}/api/auth/provider/callback`;
  const callbackUrl = sanitizeCallbackUrl(request.cookies.get(CALLBACK_COOKIE)?.value);

  try {
    const pending = await completeProviderOAuth(code, redirectUri, flowId);
    const token = storeProviderPendingSession(pending, flowId);
    logger.info('provider_id_callback_succeeded', {
      flowId,
      providerId: pending.user.provider_id,
      orgCount: pending.organizations.length,
      hcodes: pending.organizations.map((org) => org.hcode),
      callbackUrl,
    });
    // baseUrl already includes any sub-path (from NEXTAUTH_URL). Using the
    // single-arg URL constructor with string concat preserves it — passing
    // '/provider/complete' as a second-arg absolute path would DROP the sub-path.
    const completeUrl = new URL(`${baseUrl}/provider/complete`);
    completeUrl.searchParams.set('token', token);
    completeUrl.searchParams.set('callbackUrl', callbackUrl);

    const response = NextResponse.redirect(completeUrl);
    response.cookies.delete(STATE_COOKIE);
    response.cookies.delete(CALLBACK_COOKIE);
    return response;
  } catch (err) {
    logger.error('provider_id_callback_failed', { flowId, error: err });
    const message = err instanceof Error ? err.message : 'ProviderID login failed';
    const response = redirectToLogin(request, message);
    response.cookies.delete(STATE_COOKIE);
    response.cookies.delete(CALLBACK_COOKIE);
    return response;
  }
}
