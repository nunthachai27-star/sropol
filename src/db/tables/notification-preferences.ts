// src/db/tables/notification-preferences.ts
// Per-user MOPH LINE risk-alert opt-in (spec 2026-08-05-notification-optin-design).
// PDPA-safe: no plaintext name/full CID — only the 13-digit CID that maps to
// recipient_cid, scoped to the hospital the user belongs to.
import type { TableDefinition } from '../table-definition';

export const notificationPreferencesTable: TableDefinition = {
  name: 'notification_preferences',
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'user_cid', type: 'string', maxLength: 13 },
    { name: 'hospital_code', type: 'string', maxLength: 10 },
    { name: 'moph_line_enabled', type: 'boolean', defaultValue: true },
    { name: 'created_at', type: 'datetime' },
    { name: 'updated_at', type: 'datetime' },
  ],
  indexes: [
    { name: 'idx_np_unique_user_hospital', columns: ['user_cid', 'hospital_code'], unique: true },
    { name: 'idx_np_hospital_enabled', columns: ['hospital_code', 'moph_line_enabled'] },
  ],
};
