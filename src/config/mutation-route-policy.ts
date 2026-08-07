/**
 * CSRF policy manifest: EVERY route.ts under src/app/api that exports
 * POST/PUT/PATCH/DELETE must appear here with a deliberate policy.
 * tests/unit/security/mutation-route-manifest.test.ts fails the build when a
 * new mutation route is added without one.
 *
 * - session-origin-checked: cookie session auth; middleware Origin gate applies.
 * - bearer-api-key:         machine endpoint (webhook key); no browser CSRF surface.
 * - auth-endpoint:          credential exchange handled by NextAuth/BMS validation.
 * - dev-simulation-guard:   admin + feature-flag gated; hard-404 in production.
 * - public-by-design:       intentionally session-free (documented consumer).
 */
export type MutationRoutePolicy =
  | 'session-origin-checked'
  | 'bearer-api-key'
  | 'auth-endpoint'
  | 'dev-simulation-guard'
  | 'public-by-design';

export const MUTATION_ROUTE_POLICIES: Record<string, MutationRoutePolicy> = {
  'src/app/api/referrals/route.ts': 'session-origin-checked',
  'src/app/api/referrals/[id]/accept/route.ts': 'session-origin-checked',
  'src/app/api/referrals/[id]/reject/route.ts': 'session-origin-checked',
  'src/app/api/referrals/[id]/transit/route.ts': 'session-origin-checked',
  'src/app/api/referrals/[id]/arrive/route.ts': 'session-origin-checked',
  'src/app/api/referrals/check/route.ts': 'bearer-api-key',
  'src/app/api/webhooks/patient-data/route.ts': 'bearer-api-key',
  'src/app/api/auth/bms-session/route.ts': 'auth-endpoint',
  'src/app/api/auth/hospital-preflight/route.ts': 'auth-endpoint',
  'src/app/api/calls/route.ts': 'session-origin-checked',
  'src/app/api/calls/[id]/invite/route.ts': 'session-origin-checked',
  'src/app/api/calls/[id]/accept/route.ts': 'session-origin-checked',
  'src/app/api/calls/[id]/decline/route.ts': 'session-origin-checked',
  'src/app/api/calls/[id]/leave/route.ts': 'session-origin-checked',
  'src/app/api/presence/heartbeat/route.ts': 'session-origin-checked',
  'src/app/api/sync/trigger/route.ts': 'session-origin-checked',
  'src/app/api/sync/browser-push/route.ts': 'session-origin-checked',
  'src/app/api/sync/browser-authenticity/route.ts': 'session-origin-checked',
  'src/app/api/onboarding/confirm-push/route.ts': 'session-origin-checked',
  'src/app/api/onboarding/hosxp-sync/route.ts': 'session-origin-checked',
  'src/app/api/onboarding/webhook-key/route.ts': 'session-origin-checked',
  'src/app/api/onboarding/log/route.ts': 'session-origin-checked',
  'src/app/api/hospital/audit-log/route.ts': 'session-origin-checked',
  'src/app/api/chat/route.ts': 'session-origin-checked',
  'src/app/api/profile/notification-preference/route.ts': 'session-origin-checked',
  'src/app/api/dev/simulate/start/route.ts': 'dev-simulation-guard',
  'src/app/api/dev/simulate/stop/route.ts': 'dev-simulation-guard',
  'src/app/api/dev/simulate/clear/route.ts': 'dev-simulation-guard',
  'src/app/api/dev/simulate/reset-onboarding/route.ts': 'dev-simulation-guard',
  'src/app/api/dev/smoke-tab-update/route.ts': 'dev-simulation-guard',
  // /api/admin/* mutation routes: populated from the red run of this test —
  // every one is 'session-origin-checked' (verified: each calls
  // requireAdmin() in every exported handler).
  'src/app/api/admin/clear-cache/route.ts': 'session-origin-checked',
  'src/app/api/admin/config/route.ts': 'session-origin-checked',
  'src/app/api/admin/moph-alerts/route.ts': 'session-origin-checked',
  'src/app/api/admin/provinces/[provinceCode]/center-monitors/[monitorId]/route.ts':
    'session-origin-checked',
  'src/app/api/admin/provinces/[provinceCode]/center-monitors/route.ts': 'session-origin-checked',
  'src/app/api/admin/hospitals/[hcode]/bms-config/route.ts': 'session-origin-checked',
  'src/app/api/admin/hospitals/[hcode]/clear-purge/route.ts': 'session-origin-checked',
  'src/app/api/admin/hospitals/[hcode]/consult-doctors/[doctorId]/route.ts':
    'session-origin-checked',
  'src/app/api/admin/hospitals/[hcode]/consult-doctors/route.ts': 'session-origin-checked',
  'src/app/api/admin/hospitals/[hcode]/data/route.ts': 'session-origin-checked',
  'src/app/api/admin/hospitals/[hcode]/route.ts': 'session-origin-checked',
  'src/app/api/admin/hospitals/[hcode]/test-connection/route.ts': 'session-origin-checked',
  'src/app/api/admin/hospitals/route.ts': 'session-origin-checked',
  'src/app/api/admin/webhooks/[keyId]/route.ts': 'session-origin-checked',
  'src/app/api/admin/webhooks/route.ts': 'session-origin-checked',
};
