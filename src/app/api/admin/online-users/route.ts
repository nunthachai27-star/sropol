import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { cacheStatus } from '@/lib/cache';
import { logger } from '@/lib/logger';
import { listOnlineUsers } from '@/lib/presence';

export async function GET() {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    const [users, cache] = await Promise.all([listOnlineUsers(), cacheStatus()]);

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
