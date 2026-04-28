// Centralized feature-flag helpers. Any check that gates a feature behind
// environment configuration should live here so we don't drift across call
// sites when the rules change.

/**
 * Whether the dev-simulation surface (API + orchestrator + api-key cache) is
 * available in this deployment.
 *
 * Resolution order:
 *  1. `DEV_SIMULATION_ENABLED=true`  → enabled (even in prod, intentional)
 *  2. `DEV_SIMULATION_ENABLED=false` → disabled (even in dev, opt-out)
 *  3. Unset                          → enabled iff `NODE_ENV !== 'production'`
 *
 * Server-only — the flag is not exposed to the client bundle. UI surfaces
 * should treat the simulator controls as opt-in and let the server gate
 * reject disallowed calls.
 */
export function isSimulationEnabled(): boolean {
  const flag = process.env.DEV_SIMULATION_ENABLED;
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}
