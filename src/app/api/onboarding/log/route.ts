// POST /api/onboarding/log
//
// Companion to useOnboardHosxpWebhook — a thin client→server bridge so the
// hook's silent-catch branches show up in Docker logs instead of only the
// browser console. The hook fires-and-forgets fetch() calls at each decision
// point (preconditions, existing-row check, mint, remote insert, failures).
//
// Event names are allowlisted so a logged-in client can't spam arbitrary
// strings through the server log pipeline. Detail payload passes through the
// logger's PDPA redactor, which strips any sensitive-looking keys
// (token/jwt/apikey/…) before emission.
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';

const ALLOWED_EVENTS: ReadonlySet<string> = new Set([
  'preconditions_ok',
  'preconditions_missing',
  'skipped_done',
  'already_provisioned',
  'check_existing_result',
  'reused_pending_key',
  'minted_key',
  'remote_inserted',
  'remote_updated',
  'failed',
]);

interface Body {
  event?: string;
  detail?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const event = typeof body.event === 'string' ? body.event : '';
  if (!ALLOWED_EVENTS.has(event)) {
    logger.warn('onboarding_hook_log_bad_event', { attempted: event });
    return NextResponse.json({ error: 'unknown event' }, { status: 400 });
  }

  // Auth is best-effort: the hook traces are diagnostic and the route's
  // allowlist already bounds what can be emitted. A 401 here would make the
  // hook invisible in server logs any time the session cookie is stale —
  // which is exactly when we most need the visibility. We still include the
  // authenticated identity when available.
  const session = await auth().catch(() => null);
  const identityPresent = !!session?.user;

  logger.info(`onboarding_hook_${event}`, {
    hcode: session?.user?.hospitalCode ?? null,
    role: session?.user?.role ?? null,
    identityPresent,
    detail: body.detail ?? {},
  });

  return NextResponse.json({ ok: true });
}
