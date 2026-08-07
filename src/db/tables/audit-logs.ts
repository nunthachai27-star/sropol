// T030: audit_logs table definition — append-only (no UPDATE/DELETE)
import type { TableDefinition } from '../table-definition';

export const auditLogsTable: TableDefinition = {
  name: 'audit_logs',
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    // Soft, nullable correlation token (the BMS session id) — NOT a FK to
    // users(id). BMS-session actors have no users row, so a hard FK made every
    // audit INSERT fail (audit_logs_user_id_fkey). The actor's human-readable
    // identity is snapshotted inline below instead. See
    // src/db/migrations/audit-logs-actor.ts for the one-shot prod migration
    // that drops the pre-existing FK + NOT NULL (schema-sync can't ALTER).
    { name: 'user_id', type: 'uuid', nullable: true },
    // Actor identity snapshot (immutable at write time) — the "who" for PDPA.
    { name: 'user_name', type: 'string', maxLength: 255, nullable: true },
    { name: 'user_role', type: 'string', maxLength: 20, nullable: true },
    { name: 'hospital_code', type: 'string', maxLength: 10, nullable: true },
    { name: 'action', type: 'string', maxLength: 50 },
    { name: 'resource_type', type: 'string', maxLength: 50 },
    { name: 'resource_id', type: 'string', maxLength: 50, nullable: true },
    { name: 'ip_address', type: 'string', maxLength: 45, nullable: true },
    { name: 'user_agent', type: 'string', maxLength: 500, nullable: true },
    { name: 'metadata', type: 'json', nullable: true },
    { name: 'created_at', type: 'datetime' },
  ],
  indexes: [
    { name: 'idx_al_user_created', columns: ['user_id', 'created_at'] },
    { name: 'idx_al_resource', columns: ['resource_type', 'resource_id'] },
    { name: 'idx_al_created_at', columns: ['created_at'] },
  ],
};
