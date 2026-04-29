import { randomBytes } from 'crypto';
import type { ProviderPendingSession } from '@/lib/provider-id';
import { summarizeProviderOrgs } from '@/lib/provider-id';

const SESSION_TTL_MS = 5 * 60_000;

interface StoredProviderSession {
  data: ProviderPendingSession;
  expiresAt: number;
}

const pendingSessions = new Map<string, StoredProviderSession>();

function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [token, session] of pendingSessions.entries()) {
    if (session.expiresAt <= now) {
      pendingSessions.delete(token);
    }
  }
}

export function storeProviderPendingSession(data: ProviderPendingSession): string {
  cleanupExpiredSessions();
  const token = randomBytes(32).toString('base64url');
  pendingSessions.set(token, {
    data,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

export function peekProviderPendingSession(token: string): ProviderPendingSession | null {
  cleanupExpiredSessions();
  const session = pendingSessions.get(token);
  return session?.data ?? null;
}

export function consumeProviderPendingSession(
  token: string,
  organizationIndex: number,
): { data: ProviderPendingSession; organizationIndex: number } | null {
  cleanupExpiredSessions();
  const session = pendingSessions.get(token);
  if (!session) return null;
  if (
    !Number.isInteger(organizationIndex) ||
    organizationIndex < 0 ||
    organizationIndex >= session.data.organizations.length
  ) {
    return null;
  }
  pendingSessions.delete(token);
  return { data: session.data, organizationIndex };
}

export function getProviderPendingSummary(token: string) {
  const session = peekProviderPendingSession(token);
  if (!session) return null;
  return {
    user: {
      nameTh: session.user.name_th,
      titleTh: session.user.title_th,
      providerId: session.user.provider_id,
    },
    organizations: summarizeProviderOrgs(session.organizations),
  };
}
