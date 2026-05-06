// T025: hospital_bms_config table definition
import type { TableDefinition } from '../table-definition';

export const hospitalBmsConfigTable: TableDefinition = {
  name: 'hospital_bms_config',
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    {
      name: 'hospital_id',
      type: 'uuid',
      unique: true,
      references: { table: 'hospitals', column: 'id' },
    },
    { name: 'tunnel_url', type: 'string', maxLength: 500 },
    { name: 'session_id', type: 'string', maxLength: 50, nullable: true },
    { name: 'session_jwt', type: 'text', nullable: true },
    { name: 'session_expires_at', type: 'datetime', nullable: true },
    { name: 'database_type', type: 'string', maxLength: 20, nullable: true },
    // marketplace_token — encrypted at rest. HOSxP randomizes CID/HN in API
    // responses unless every /api/sql call carries this token, so the polling
    // worker MUST persist + replay it on each cycle. Long-lived per hospital;
    // captured during onboarding when the user enters from a real HOSxP.
    { name: 'marketplace_token', type: 'text', nullable: true },
    // Authenticity verdict from the per-cycle fingerprint probe (re-look-up
    // the first patient row by its returned CID/HN; if it doesn't round-trip,
    // the marketplace token is missing/invalid and the data is randomized).
    // status: 'authentic' | 'cid_unstable' | 'no_data' | 'probe_failed'
    { name: 'last_authenticity_check_at', type: 'datetime', nullable: true },
    { name: 'last_authenticity_status', type: 'string', maxLength: 32, nullable: true },
    { name: 'last_authenticity_reason', type: 'text', nullable: true },
    // Set by DELETE /api/admin/hospitals/[hcode]/data — every sync path
    // (immediate, scheduled, browser-driven onboarding heartbeat) refuses to
    // run while this is non-null. Cleared by an explicit fresh onboarding
    // request (which also rewrites marketplace_token), so a quietly-running
    // useOnboardHosxpSync interval can't undo a purge.
    { name: 'data_purged_at', type: 'datetime', nullable: true },
    { name: 'created_at', type: 'datetime' },
    { name: 'updated_at', type: 'datetime' },
  ],
  indexes: [
    { name: 'idx_hbc_hospital_id', columns: ['hospital_id'], unique: true },
  ],
};
