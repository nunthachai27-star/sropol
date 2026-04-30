import type { Session } from 'next-auth';
import { cacheGetJson, cacheKeys, cacheSetJson } from '@/lib/cache';

const PRESENCE_TTL_SECONDS = 120;
const PRESENCE_KEY_PREFIX = 'presence:users';

export interface OnlineUserSnapshot {
  userId: string;
  name: string;
  role: string;
  hospitalCode: string;
  hospitalName: string;
  authProvider: string;
  accessMode: string;
  path: string;
  ipAddress: string | null;
  userAgent: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

function presenceKey(userId: string): string {
  return `${PRESENCE_KEY_PREFIX}:${encodeURIComponent(userId)}`;
}

export async function recordOnlineUser(
  session: Session,
  context: {
    path?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  } = {},
): Promise<OnlineUserSnapshot | null> {
  const user = session.user;
  if (!user?.id) return null;

  const key = presenceKey(user.id);
  const now = new Date();
  const existing = await cacheGetJson<OnlineUserSnapshot>(key);
  const snapshot: OnlineUserSnapshot = {
    userId: user.id,
    name: user.name ?? 'Unknown user',
    role: user.role,
    hospitalCode: user.hospitalCode,
    hospitalName: user.hospitalName,
    authProvider: user.authProvider,
    accessMode: user.accessMode,
    path: context.path || existing?.path || '/',
    ipAddress: context.ipAddress ?? existing?.ipAddress ?? null,
    userAgent: context.userAgent ?? existing?.userAgent ?? null,
    firstSeenAt: existing?.firstSeenAt ?? now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PRESENCE_TTL_SECONDS * 1000).toISOString(),
  };

  await cacheSetJson(key, snapshot, PRESENCE_TTL_SECONDS);
  return snapshot;
}

export async function listOnlineUsers(): Promise<OnlineUserSnapshot[]> {
  const keys = await cacheKeys(`${PRESENCE_KEY_PREFIX}:*`);
  const users = await Promise.all(keys.map((key) => cacheGetJson<OnlineUserSnapshot>(key)));
  return users
    .filter((user): user is OnlineUserSnapshot => Boolean(user))
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
}
