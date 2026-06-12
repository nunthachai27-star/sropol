import type { NextConfig } from 'next';
import { execSync } from 'node:child_process';
import { version as appVersion } from './package.json';

const isDocker = process.env.DOCKER_BUILD === 'true';

// Resolve a short build identifier so the production UI can show "is the
// new build live?" at a glance. Order:
//   1. NEXT_PUBLIC_BUILD_ID env (CI / Docker can override explicitly)
//   2. short git SHA at build time
//   3. 'dev' fallback (no git, e.g. ephemeral container without .git)
let buildId = process.env.NEXT_PUBLIC_BUILD_ID;
if (!buildId) {
  try {
    buildId = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    buildId = 'dev';
  }
}
const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME ?? new Date().toISOString();

// Serve the app under a URL sub-path (e.g. /sr-lrms) when set. Baked into the
// bundle at build time; empty = root deployment. Client/server/middleware code
// reads the same value via NEXT_PUBLIC_BASE_PATH (see src/lib/base-path.ts).
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');

const nextConfig: NextConfig = {
  reactCompiler: true,
  // standalone output only for Docker builds; regular next start for bare server
  ...(isDocker && { output: 'standalone' as const }),
  ...(basePath && { basePath }),
  serverExternalPackages: ['better-sqlite3', 'pg'],
  allowedDevOrigins: ['https://kk-lrms.bmscloud.in.th'],
  devIndicators: false,
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
    NEXT_PUBLIC_BUILD_TIME: buildTime,
    // Auto-bumped on every commit by .husky/pre-commit. Baked in at build
    // time so the deployed UI shows the version of the latest built commit.
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
};

export default nextConfig;
