// Review follow-up: the promoteRoleByAllowedCid WIRING in the BMS Credentials
// authorize() (src/lib/auth.ts) had zero coverage — the pure function was
// tested but deleting its call site left the whole suite green. This test
// captures the config passed to NextAuth() and invokes the real authorize
// callback, so removing or bypassing the promotion now fails a test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserRole } from '@/types/domain';

vi.mock('next-auth', () => ({
  default: vi.fn(() => ({
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
    auth: vi.fn(),
  })),
}));

vi.mock('@/lib/auth-utils', () => ({
  mapPositionToRole: vi.fn(),
  validateBmsSession: vi.fn(),
}));

vi.mock('@/lib/hospital-access-guard', () => ({
  assertHospitalAccess: vi.fn(async () => ({ allowed: true, reason: 'test' })),
}));

import NextAuth from 'next-auth';
import { validateBmsSession } from '@/lib/auth-utils';
import '@/lib/auth';

interface AuthorizeProvider {
  name?: string;
  authorize?: (credentials: Record<string, unknown>) => Promise<{ role?: string } | null>;
  options?: { name?: string; authorize?: AuthorizeProvider['authorize'] };
}

function bmsAuthorize(): NonNullable<AuthorizeProvider['authorize']> {
  const config = vi.mocked(NextAuth).mock.calls[0][0] as { providers: AuthorizeProvider[] };
  const provider = config.providers.find((p) => (p.options?.name ?? p.name) === 'BMS Session');
  const authorize = provider?.options?.authorize ?? provider?.authorize;
  if (!authorize) throw new Error('BMS Session provider authorize() not found');
  return authorize;
}

const IDENTITY = {
  name: 'Test Obstetrician',
  userCid: '1111111111111',
  role: UserRole.OBSTETRICIAN,
  hospitalCode: '00000',
  hospitalName: 'รพ.ทดสอบ',
  tunnelUrl: '',
  databaseType: 'postgresql',
  jwt: 'jwt',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

const ORIGINAL = process.env.ADMIN_ALLOWED_CIDS;

describe('BMS authorize() applies the ADMIN_ALLOWED_CIDS promotion', () => {
  beforeEach(() => {
    vi.mocked(validateBmsSession).mockReset();
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ADMIN_ALLOWED_CIDS;
    else process.env.ADMIN_ALLOWED_CIDS = ORIGINAL;
  });

  it('returns role ADMIN for an allow-listed CID', async () => {
    process.env.ADMIN_ALLOWED_CIDS = '1111111111111';
    vi.mocked(validateBmsSession).mockResolvedValueOnce({ ...IDENTITY });

    const user = await bmsAuthorize()({ sessionId: 'sess-promote' });

    expect(user).not.toBeNull();
    expect(user!.role).toBe(UserRole.ADMIN);
  });

  it('returns the position-derived role when the CID is not listed', async () => {
    process.env.ADMIN_ALLOWED_CIDS = '9999999999999';
    vi.mocked(validateBmsSession).mockResolvedValueOnce({ ...IDENTITY });

    const user = await bmsAuthorize()({ sessionId: 'sess-plain' });

    expect(user).not.toBeNull();
    expect(user!.role).toBe(UserRole.OBSTETRICIAN);
  });
});
