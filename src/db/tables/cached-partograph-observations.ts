// T3: cached_partograph_observations table definition
// One row per partograph observation (per timestamp) for a labor patient.
// Mirrors the WHO partograph schema (22 clinical fields) plus source/audit.
import type { TableDefinition } from '../table-definition';

export const cachedPartographObservationsTable: TableDefinition = {
  name: 'cached_partograph_observations',
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    {
      name: 'patient_id',
      type: 'uuid',
      references: { table: 'cached_patients', column: 'id' },
    },
    {
      name: 'hospital_id',
      type: 'uuid',
      references: { table: 'hospitals', column: 'id' },
    },

    { name: 'source_system', type: 'string', maxLength: 16 },
    { name: 'source_pk', type: 'string', maxLength: 64 },

    { name: 'observe_datetime', type: 'datetime' },
    { name: 'hour_no', type: 'integer', nullable: true },

    { name: 'fetal_heart_rate', type: 'integer', nullable: true },
    { name: 'amniotic_fluid', type: 'string', maxLength: 20, nullable: true },
    { name: 'amniotic_type_id', type: 'integer', nullable: true },
    { name: 'amniotic_type_name', type: 'string', maxLength: 250, nullable: true },
    { name: 'moulding', type: 'string', maxLength: 10, nullable: true },

    { name: 'cervical_dilation_cm', type: 'decimal', nullable: true },
    { name: 'descent_of_head', type: 'string', maxLength: 10, nullable: true },

    { name: 'contraction_per_10min', type: 'integer', nullable: true },
    { name: 'contraction_duration_sec', type: 'integer', nullable: true },
    { name: 'contraction_strength', type: 'string', maxLength: 10, nullable: true },

    { name: 'oxytocin_uml', type: 'decimal', nullable: true },
    { name: 'oxytocin_drops_min', type: 'integer', nullable: true },
    { name: 'drugs_iv_fluids', type: 'string', maxLength: 250, nullable: true },

    { name: 'pulse', type: 'integer', nullable: true },
    { name: 'bp_systolic', type: 'integer', nullable: true },
    { name: 'bp_diastolic', type: 'integer', nullable: true },
    { name: 'temperature', type: 'decimal', nullable: true },

    { name: 'urine_volume_ml', type: 'integer', nullable: true },
    { name: 'urine_protein', type: 'string', maxLength: 10, nullable: true },
    { name: 'urine_glucose', type: 'string', maxLength: 10, nullable: true },
    { name: 'urine_acetone', type: 'string', maxLength: 10, nullable: true },

    { name: 'note', type: 'string', maxLength: 3000, nullable: true },
    { name: 'entry_staff', type: 'string', maxLength: 25, nullable: true },
    { name: 'entry_datetime', type: 'datetime', nullable: true },

    { name: 'synced_at', type: 'datetime' },
    { name: 'created_at', type: 'datetime' },
    { name: 'updated_at', type: 'datetime' },
  ],
  indexes: [
    {
      name: 'uniq_cpo_source',
      columns: ['hospital_id', 'source_system', 'source_pk'],
      unique: true,
    },
    {
      name: 'idx_cpo_patient',
      columns: ['patient_id', 'observe_datetime'],
      unique: false,
    },
  ],
};
