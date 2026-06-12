// Regression: a returning user with an expired BMS session (or a hospital whose
// HOSxP tunnel is momentarily down, or the provincial-admin account with no real
// HOSxP) was blocked at login with a misleading "อัปเดต HOSxP เป็นเวอร์ชัน …"
// message. The preflight returned reason 'hosxp_too_old' for EVERY version-check
// failure, conflating "couldn't reach/parse the version" with "version too old".
// Login must fail open when the version is merely indeterminate.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth-utils', () => ({ validateBmsSession: vi.fn() }));
vi.mock('@/lib/hospital-access-guard', () => ({ checkHospitalAccess: vi.fn() }));
vi.mock('@/lib/bms-version', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bms-version')>()),
  checkBmsApiVersion: vi.fn(),
}));

import { POST } from '@/app/api/auth/hospital-preflight/route';
import { validateBmsSession } from '@/lib/auth-utils';
import { checkHospitalAccess } from '@/lib/hospital-access-guard';
import { checkBmsApiVersion } from '@/lib/bms-version';
import type { NextRequest } from 'next/server';

const mockValidate = validateBmsSession as unknown as ReturnType<typeof vi.fn>;
const mockAccess = checkHospitalAccess as unknown as ReturnType<typeof vi.fn>;
const mockVersion = checkBmsApiVersion as unknown as ReturnType<typeof vi.fn>;

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;

beforeEach(() => {
  mockValidate.mockResolvedValue({
    hospitalCode: '10668',
    hospitalName: 'โรงพยาบาลสุรินทร์',
    role: 'PROVINCIAL_ADMIN',
    tunnelUrl: 'https://tunnel.example/api',
  });
  mockAccess.mockResolvedValue({ allowed: true });
});

describe('hospital-preflight — HOSxP version gate', () => {
  it('fails open (login proceeds) when the version check is unreachable', async () => {
    mockVersion.mockResolvedValue({ ok: false, version: null, versionNumber: null, reason: 'unreachable' });
    const res = await POST(req({ sessionId: 'SID' }));
    expect((await res.json()).ok).toBe(true);
  });

  it('fails open when the version response is unreadable', async () => {
    mockVersion.mockResolvedValue({ ok: false, version: null, versionNumber: null, reason: 'invalid_response' });
    const res = await POST(req({ sessionId: 'SID' }));
    expect((await res.json()).ok).toBe(true);
  });

  it('still blocks a CONFIRMED too-old HOSxP version', async () => {
    mockVersion.mockResolvedValue({ ok: false, version: '4.60.0.0', versionNumber: 4060000000, reason: 'too_old' });
    const res = await POST(req({ sessionId: 'SID' }));
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.reason).toBe('hosxp_too_old');
    expect(json.currentVersion).toBe('4.60.0.0');
  });

  it('passes when the version is new enough', async () => {
    mockVersion.mockResolvedValue({ ok: true, version: '4.70.0.0', versionNumber: 4070000000 });
    const res = await POST(req({ sessionId: 'SID' }));
    expect((await res.json()).ok).toBe(true);
  });

  it('still reports invalid_session for a session BMS rejects', async () => {
    mockValidate.mockResolvedValue(null);
    const res = await POST(req({ sessionId: 'SID' }));
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.reason).toBe('invalid_session');
  });
});
