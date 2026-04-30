// Per-hospital consult doctor contact list for admin-managed referral support.
import type { TableDefinition } from '../table-definition';

export const hospitalConsultDoctorsTable: TableDefinition = {
  name: 'hospital_consult_doctors',
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    {
      name: 'hospital_id',
      type: 'uuid',
      references: { table: 'hospitals', column: 'id' },
    },
    { name: 'cid', type: 'string', maxLength: 13 },
    { name: 'name', type: 'string', maxLength: 255 },
    { name: 'position', type: 'string', maxLength: 255, nullable: true },
    { name: 'phone_number', type: 'string', maxLength: 50, nullable: true },
    { name: 'is_active', type: 'boolean', defaultValue: true },
    { name: 'created_at', type: 'datetime' },
    { name: 'updated_at', type: 'datetime' },
  ],
  indexes: [
    { name: 'idx_hcd_hospital_id', columns: ['hospital_id'] },
    { name: 'idx_hcd_hospital_cid', columns: ['hospital_id', 'cid'] },
  ],
};
