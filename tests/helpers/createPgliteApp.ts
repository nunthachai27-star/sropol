// Cold-start pglite "app" — boots the EXACT production startup sequence
// against an in-memory pglite (real Postgres dialect):
//
//   1. SchemaSync.sync     — creates every table from ALL_TABLES
//   2. SeedOrchestrator    — populates KK hospitals + admin user
//   3. createApiKey        — provisions a test webhook API key for one
//                            seeded hospital so tests can hit the live
//                            POST /api/webhooks/patient-data route with a
//                            real Bearer token.
//
// This is what `src/app/api/startup.ts` does at production boot, minus
// `startPolling` (no live HOSxP in tests).

import { createPgliteDb } from './createPgliteDb';
import { SeedOrchestrator } from '@/db/seeds';
import { createApiKey } from '@/services/webhook';
import { KK_HOSPITALS } from '@/config/hospitals';
import type { PgliteAdapter } from '@/db/pglite-adapter';

export interface PgliteAppContext {
  db: PgliteAdapter;
  hcode: string;        // HCODE of the hospital the test API key is bound to
  hospitalId: string;   // UUID assigned by HospitalSeeder
  apiKey: string;       // raw bearer token — call createApiKey returns this once
}

/**
 * Boot a blank pglite database through the production startup path.
 * The returned API key authenticates webhook POSTs against the chosen hospital.
 */
export async function createPgliteApp(
  hcodeForApiKey: string = KK_HOSPITALS[0].hcode,
): Promise<PgliteAppContext> {
  const db = await createPgliteDb();
  await new SeedOrchestrator().run(db);

  const rows = await db.query<{ id: string; hcode: string }>(
    'SELECT id, hcode FROM hospitals WHERE hcode = ?',
    [hcodeForApiKey],
  );
  if (rows.length === 0) {
    throw new Error(
      `createPgliteApp: hospital ${hcodeForApiKey} not seeded — ` +
      `is HospitalSeeder.shouldRun() returning true on pglite?`,
    );
  }
  const hospital = rows[0];

  const { rawKey } = await createApiKey(db, hospital.id, 'pglite-cold-start-test');

  return {
    db,
    hcode: hospital.hcode,
    hospitalId: hospital.id,
    apiKey: rawKey,
  };
}
