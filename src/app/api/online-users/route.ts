// GET /api/online-users — sanitized list of currently-online users for the
// dashboard's hover tooltip on `/`. Returns the same presence data the
// admin tab reads, but strips IP and userAgent so the list is safe to
// expose to nurses/obstetricians as well as admins.
//
// Auth: any signed-in session. Rejected for unauthenticated callers
// because the presence list reveals workforce activity (who's online,
// at which hospital, on which page).
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listOnlineUsers } from '@/lib/presence';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const users = await listOnlineUsers();
    const sanitized = users.map((u) => ({
      userId: u.userId,
      name: u.name,
      role: u.role,
      hospitalCode: u.hospitalCode,
      hospitalName: u.hospitalName,
      path: u.path,
      lastSeenAt: u.lastSeenAt,
    }));

    return NextResponse.json({
      users: sanitized,
      total: sanitized.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('online_users_failed', { error });
    return NextResponse.json(
      { error: 'failed to load online users' },
      { status: 500 },
    );
  }
}
