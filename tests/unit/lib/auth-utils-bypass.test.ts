import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateBmsSession } from '@/lib/auth-utils';

// DEV_AUTH_BYPASS must be inert in production builds: it grants an ADMIN
// session with a hardcoded identity whenever BMS is unreachable, so a flag
// accidentally left on in a production .env must not open that door.
describe('validateBmsSession dev bypass gating', () => {
  beforeEach(() => {
    // BMS unreachable — force the fallback branch.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns the dev identity outside production when the flag is on', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_AUTH_BYPASS', 'true');
    const identity = await validateBmsSession('any-session', '');
    expect(identity).not.toBeNull();
    expect(identity?.role).toBe('ADMIN');
    expect(identity?.hospitalCode).toBe('10670');
  });

  it('fails closed in production even when the flag is on', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEV_AUTH_BYPASS', 'true');
    const identity = await validateBmsSession('any-session', '');
    expect(identity).toBeNull();
  });

  it('fails closed when the flag is off', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_AUTH_BYPASS', 'false');
    const identity = await validateBmsSession('any-session', '');
    expect(identity).toBeNull();
  });
});
