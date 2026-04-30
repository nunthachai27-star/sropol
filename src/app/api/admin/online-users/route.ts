import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { cacheStatus } from '@/lib/cache';
import { logger } from '@/lib/logger';
import { listOnlineUsers } from '@/lib/presence';

export async function GET() {
  try {
    const session = await auth();
    if (session?.user?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
    }

    const [users, cache] = await Promise.all([
      listOnlineUsers(),
      cacheStatus(),
    ]);

    return NextResponse.json({
      users,
      total: users.length,
      cache,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('admin_online_users_failed', { error });
    return NextResponse.json({ error: 'failed to load online users' }, { status: 500 });
  }
}
