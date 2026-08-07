// T-C4: Startup config validation tests — TDD: write tests FIRST
import { describe, it, expect } from 'vitest';
import { validateStartupConfig } from '@/lib/startup-config';

const VALID_KEY = 'a'.repeat(64);

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    ENCRYPTION_KEY: VALID_KEY,
    DATABASE_URL: 'postgres://x',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe('validateStartupConfig', () => {
  it('passes a valid production config', () => {
    expect(() => validateStartupConfig(env({}))).not.toThrow();
  });
  it('rejects a missing ENCRYPTION_KEY in production', () => {
    expect(() => validateStartupConfig(env({ ENCRYPTION_KEY: undefined }))).toThrow(
      /ENCRYPTION_KEY/,
    );
  });
  it('rejects a 64-char NON-HEX key', () => {
    expect(() => validateStartupConfig(env({ ENCRYPTION_KEY: 'z'.repeat(64) }))).toThrow(/hex/);
  });
  it('rejects a wrong-length key', () => {
    expect(() => validateStartupConfig(env({ ENCRYPTION_KEY: 'ab'.repeat(16) }))).toThrow(/64/);
  });
  it('requires DATABASE_URL when PGlite is off', () => {
    expect(() => validateStartupConfig(env({ DATABASE_URL: undefined }))).toThrow(/DATABASE_URL/);
  });
  it('does not require DATABASE_URL under PGlite/test', () => {
    expect(() =>
      validateStartupConfig(env({ DATABASE_URL: undefined, USE_PGLITE: 'true' })),
    ).not.toThrow();
  });
  it('aggregates every problem into one actionable error', () => {
    expect(() =>
      validateStartupConfig(env({ ENCRYPTION_KEY: 'bad', DATABASE_URL: undefined })),
    ).toThrow(/ENCRYPTION_KEY[\s\S]*DATABASE_URL|DATABASE_URL[\s\S]*ENCRYPTION_KEY/);
  });
});
