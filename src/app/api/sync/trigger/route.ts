// POST /api/sync/trigger — historically kicked off a server-side immediate
// HOSxP pull. Server-side polling is now disabled in favour of browser-side
// polling via /api/sync/browser-push (the user's tab fetches HOSxP via
// 127.0.0.1:45011 and POSTs the result here).
//
// We keep the endpoint as an authenticated no-op so the existing /
// "Refresh now" button + the maternity-ward fireAudit fallback don't 404.
// In a future cleanup pass these clients can be migrated to invoke the
// browser-poll directly; until then this returns immediately.
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hospitalCode = session.user.hospitalCode ?? null;
    return NextResponse.json({
      synced: false,
      reason: 'server_polling_disabled_use_browser_push',
      hcode: hospitalCode,
      lastSyncAt: null,
    });
  } catch (error) {
    logger.error('sync_trigger_failed', { error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
