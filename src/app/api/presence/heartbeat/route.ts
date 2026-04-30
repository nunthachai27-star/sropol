import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { recordOnlineUser } from '@/lib/presence';

function requestIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || null;
  return request.headers.get('x-real-ip');
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let path = '/';
    try {
      const body = await request.json() as { path?: unknown };
      if (typeof body.path === 'string' && body.path.startsWith('/')) {
        path = body.path.slice(0, 256);
      }
    } catch {
      // Empty heartbeat body is valid.
    }

    const user = await recordOnlineUser(session, {
      path,
      ipAddress: requestIp(request),
      userAgent: request.headers.get('user-agent'),
    });

    return NextResponse.json({ ok: true, user });
  } catch (error) {
    logger.error('presence_heartbeat_failed', { error });
    return NextResponse.json({ error: 'presence heartbeat failed' }, { status: 500 });
  }
}
