// Review follow-up: POST /api/auth/bms-session pre-validates a BMS session
// and reports the identity. The reported role MUST match the role the session
// created by signIn() will actually carry — i.e. it must apply the same
// ADMIN_ALLOWED_CIDS promotion as the BMS authorize() in @/lib/auth.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserRole } from '@/types/domain';
import type { BmsUserIdentity } from '@/lib/auth-utils';

vi.mock('@/lib/auth-utils', () => ({
  validateBmsSession: vi.fn(),
}));

import { validateBmsSession } from '@/lib/auth-utils';
import { POST } from '@/app/api/auth/bms-session/route';

function identity(overrides: Partial<BmsUserIdentity> = {}): BmsUserIdentity {
  return {
    name: 'Test Nurse',
    userCid: '1111111111111',
    role: UserRole.NURSE,
    hospitalCode: '10670',
    hospitalName: 'รพ.ทดสอบ',
    tunnelUrl: '',
    databaseType: 'postgresql',
    jwt: 'jwt',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...overrides,
  };
}

function request(body: unknown) {
  return { json: async () => body } as never;
}

const ORIGINAL = process.env.ADMIN_ALLOWED_CIDS;

describe('POST /api/auth/bms-session role reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ADMIN_ALLOWED_CIDS;
    else process.env.ADMIN_ALLOWED_CIDS = ORIGINAL;
  });

  it('reports ADMIN for an allow-listed CID, matching the session signIn() will create', async () => {
    process.env.ADMIN_ALLOWED_CIDS = '1111111111111';
    vi.mocked(validateBmsSession).mockResolvedValueOnce(identity());

    const res = await POST(request({ sessionId: 'sess-1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.user.role).toBe(UserRole.ADMIN);
  });

  it('reports the position-derived role unchanged when the CID is not listed', async () => {
    process.env.ADMIN_ALLOWED_CIDS = '9999999999999';
    vi.mocked(validateBmsSession).mockResolvedValueOnce(identity());

    const res = await POST(request({ sessionId: 'sess-2' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.user.role).toBe(UserRole.NURSE);
  });
});
