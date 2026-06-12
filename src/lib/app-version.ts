// Single source of truth for the user-facing app version.
//
// The value originates in package.json's `version` field, which the
// .husky/pre-commit hook auto-bumps (patch) on every commit. next.config.ts
// reads it at build time and exposes it as NEXT_PUBLIC_APP_VERSION, so this
// constant is inlined into both server and client bundles. The '0.0.0'
// fallback only applies when the env wasn't baked (e.g. a stray unit test
// importing this outside the Next build).
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0';

/** Convenience: the version prefixed with "v" for display (e.g. "v1.0.3"). */
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
