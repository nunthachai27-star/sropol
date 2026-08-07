// Startup configuration validation — runs FIRST in initializeApp() so an
// invalid deployment never becomes ready, let alone ingests clinical data.
const HEX_64 = /^[0-9a-fA-F]{64}$/;

export function validateStartupConfig(env: NodeJS.ProcessEnv = process.env): void {
  const errors: string[] = [];
  const isProduction = env.NODE_ENV === 'production';
  const usePglite = env.USE_PGLITE === 'true' || env.NODE_ENV === 'test';

  const key = env.ENCRYPTION_KEY;
  if (!key) {
    if (isProduction) errors.push('ENCRYPTION_KEY is required in production');
  } else if (!HEX_64.test(key) || Buffer.from(key, 'hex').length !== 32) {
    errors.push('ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
  }

  if (!usePglite && !env.DATABASE_URL) {
    errors.push('DATABASE_URL is required when not running PGlite');
  }

  if (errors.length > 0) {
    throw new Error(`Startup configuration invalid: ${errors.join('; ')}`);
  }
}
