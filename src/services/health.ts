// T109: Health check service — centralized health status logic

import type { DatabaseAdapter } from '@/db/adapter';
import { cacheStatus } from '@/lib/cache';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  database: 'connected' | 'disconnected';
  cache: { backend: 'redis' | 'memory'; degraded: boolean; degradedSince: string | null };
  uptime: number;
  timestamp: string;
  hospitalConnections: {
    total: number;
    online: number;
    offline: number;
    unknown: number;
  };
  degradedReasons: string[];
}

const startTime = Date.now();

export async function getHealthStatus(db: DatabaseAdapter): Promise<HealthStatus> {
  let dbStatus: 'connected' | 'disconnected' = 'disconnected';
  let hospitalConnections = { total: 0, online: 0, offline: 0, unknown: 0 };

  try {
    // Test DB connection with a simple query
    await db.query('SELECT 1 as ok');
    dbStatus = 'connected';

    // Get hospital connection stats
    const stats = await db.query<{ connection_status: string; count: number }>(
      'SELECT connection_status, COUNT(*) as count FROM hospitals WHERE is_active = true GROUP BY connection_status',
    );

    const total = await db.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM hospitals WHERE is_active = true',
    );
    hospitalConnections.total = total[0]?.count ?? 0;

    for (const row of stats) {
      if (row.connection_status === 'ONLINE') hospitalConnections.online = row.count;
      else if (row.connection_status === 'OFFLINE') hospitalConnections.offline = row.count;
      else hospitalConnections.unknown += row.count;
    }
  } catch {
    dbStatus = 'disconnected';
  }

  const cache = await cacheStatus();
  const degradedReasons: string[] = [];
  if (hospitalConnections.offline > 0) degradedReasons.push('hospitals_offline');
  if (cache.degraded) degradedReasons.push('redis_unavailable');
  if (hospitalConnections.total > 0 && hospitalConnections.online === 0) {
    // Grace-state: nothing has synced (yet) — never present this as healthy.
    degradedReasons.push('no_hospitals_online');
  }
  const status: HealthStatus['status'] =
    dbStatus === 'disconnected' ? 'unhealthy' : degradedReasons.length > 0 ? 'degraded' : 'healthy';

  return {
    status,
    database: dbStatus,
    cache: { backend: cache.backend, degraded: cache.degraded, degradedSince: cache.degradedSince },
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    hospitalConnections,
    degradedReasons,
  };
}
