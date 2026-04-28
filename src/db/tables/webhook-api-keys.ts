// webhook_api_keys table — API key storage for non-HOSxP hospital webhook integration
import type { TableDefinition } from '../table-definition';

export const webhookApiKeysTable: TableDefinition = {
  name: 'webhook_api_keys',
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    {
      name: 'hospital_id',
      type: 'uuid',
      references: { table: 'hospitals', column: 'id' },
    },
    { name: 'key_hash', type: 'string', maxLength: 64 }, // SHA-256 of the raw API key
    { name: 'key_prefix', type: 'string', maxLength: 8 }, // First 8 chars for identification (e.g. "kklrms_a")
    { name: 'label', type: 'string', maxLength: 100 }, // Human-readable label
    { name: 'is_active', type: 'boolean', defaultValue: true },
    { name: 'last_used_at', type: 'datetime', nullable: true },
    { name: 'created_at', type: 'datetime' },
    { name: 'revoked_at', type: 'datetime', nullable: true },
    // Set when the hook confirms the key was successfully installed on
    // HOSxP's webhook_setting row. Unconfirmed keys are treated as orphans
    // by the onboarding reuse-check — they get revoked on retry so a fresh
    // key can be minted and pushed again, instead of trapping the flow in
    // a "local exists / remote never got it" short-circuit.
    { name: 'pushed_to_hosxp_at', type: 'datetime', nullable: true },
  ],
  indexes: [
    { name: 'idx_wak_key_hash', columns: ['key_hash'], unique: true },
    { name: 'idx_wak_hospital_id', columns: ['hospital_id'] },
    { name: 'idx_wak_is_active', columns: ['is_active'] },
  ],
};
