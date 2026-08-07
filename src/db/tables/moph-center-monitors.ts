// Province-level center-monitoring recipients for MOPH Prompt alerts.
//
// Codex #3: a DB table (not an env var) because these are PDPA-relevant
// operational recipients needing active flags, admin editability, auditability,
// and province scoping. Seeded/managed via the admin route (step 9).
//
// A center-monitor recipient receives an alert "from" the originating hospital
// (the MOPH API stamps the sender hospital from the Bearer session), modeled in
// moph_alert_log as recipient_scope='province_center' with origin_hospital_id.
import type { TableDefinition } from '../table-definition';

export const mophCenterMonitorsTable: TableDefinition = {
  name: 'moph_center_monitors',
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'province', type: 'string', maxLength: 10 },
    { name: 'cid', type: 'string', maxLength: 13 },
    { name: 'name', type: 'string', maxLength: 255 },
    { name: 'position', type: 'string', maxLength: 255, nullable: true },
    { name: 'is_active', type: 'boolean', defaultValue: true },
    { name: 'created_at', type: 'datetime' },
    { name: 'updated_at', type: 'datetime' },
  ],
  indexes: [
    { name: 'idx_mcm_province_cid', unique: true, columns: ['province', 'cid'] },
    { name: 'idx_mcm_province_active', columns: ['province', 'is_active'] },
  ],
};
