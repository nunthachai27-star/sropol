// cached_patients — current/recent labor admission (one row per AN per hospital).
// NOT a duplicate of maternal_journeys: this table tracks the *admission*,
// while maternal_journeys tracks the *pregnancy*. See ./README.md for the model.
import type { TableDefinition } from '../table-definition';

export const cachedPatientsTable: TableDefinition = {
  name: 'cached_patients',
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    {
      name: 'hospital_id',
      type: 'uuid',
      references: { table: 'hospitals', column: 'id' },
    },
    { name: 'hn', type: 'string', maxLength: 20 },
    { name: 'an', type: 'string', maxLength: 20 },
    { name: 'name', type: 'string', maxLength: 255 }, // Encrypted (PDPA)
    { name: 'cid', type: 'string', maxLength: 255, nullable: true }, // Encrypted (PDPA)
    { name: 'cid_hash', type: 'string', maxLength: 64, nullable: true }, // SHA-256 hash for cross-hospital matching
    { name: 'age', type: 'integer' },
    { name: 'gravida', type: 'integer', nullable: true },
    { name: 'para', type: 'integer', nullable: true },
    { name: 'abortion', type: 'integer', nullable: true },
    { name: 'living_children', type: 'integer', nullable: true },
    { name: 'preg_no', type: 'integer', nullable: true },
    { name: 'ga_weeks', type: 'integer', nullable: true },
    { name: 'ga_day', type: 'integer', nullable: true },
    { name: 'anc_count', type: 'integer', nullable: true },
    { name: 'admit_date', type: 'datetime' },
    { name: 'height_cm', type: 'decimal', nullable: true },
    { name: 'weight_kg', type: 'decimal', nullable: true },
    { name: 'weight_diff_kg', type: 'decimal', nullable: true },
    { name: 'pre_pregnancy_weight_kg', type: 'decimal', nullable: true },
    { name: 'fundal_height_cm', type: 'decimal', nullable: true },
    { name: 'us_weight_g', type: 'decimal', nullable: true },
    { name: 'hematocrit_pct', type: 'decimal', nullable: true },
    // Admission vitals (snapshot at ipt admission) — distinct from partograph
    // time-series. Lets the UI show "she came in with BP 145/95" without
    // requiring a separate first-row partograph lookup.
    { name: 'bp_systolic_admit', type: 'integer', nullable: true },
    { name: 'bp_diastolic_admit', type: 'integer', nullable: true },
    { name: 'pulse_admit', type: 'integer', nullable: true },
    { name: 'rr_admit', type: 'integer', nullable: true },
    { name: 'temperature_admit', type: 'decimal', nullable: true },
    // Cervical exam at admission — critical for transfer / triage decisions.
    { name: 'cervical_open_cm_admit', type: 'decimal', nullable: true },
    { name: 'effacement_pct_admit', type: 'decimal', nullable: true },
    { name: 'station_admit', type: 'string', maxLength: 10, nullable: true },
    { name: 'labor_status', type: 'string', maxLength: 20, defaultValue: 'ACTIVE' },
    { name: 'delivered_at', type: 'datetime', nullable: true },
    {
      name: 'journey_id',
      type: 'uuid',
      nullable: true,
      references: { table: 'maternal_journeys', column: 'id' },
    },
    { name: 'partograph_severity', type: 'string', maxLength: 10, nullable: true },
    { name: 'partograph_alert_count', type: 'integer', nullable: true },
    // Maternal labor-triage screening summary — a projection of the LATEST
    // valid row in maternal_screening_assessments (source of truth stays the
    // assessment table). GC3: deliberately kept separate from
    // `partograph_severity` above — different domain, different vocabulary
    // (MaternalScreenLocalTier / MaternalEmergencyAcuity vs CdssSeverity) —
    // never reuse partograph_severity for this. All nullable: dormant until
    // Task 6 (store service) and Task 7 (webhook ingest) start writing them.
    { name: 'maternal_screen_local_tier', type: 'string', maxLength: 30, nullable: true },
    { name: 'maternal_screen_emergency_acuity', type: 'string', maxLength: 30, nullable: true },
    // Comma-separated SuspectedMaternalCondition codes (e.g.
    // "ABRUPTIO_PLACENTAE,PLACENTA_PREVIA") rather than JSON — this is a
    // lightweight dashboard-list projection, not the audit record; the
    // assessment row's suspected_conditions_json remains the structured
    // source of truth.
    { name: 'maternal_screen_condition_codes', type: 'string', maxLength: 255, nullable: true },
    { name: 'maternal_screen_assessed_at', type: 'datetime', nullable: true },
    { name: 'maternal_screen_is_complete', type: 'boolean', nullable: true },
    { name: 'maternal_screen_rule_set_version', type: 'string', maxLength: 40, nullable: true },
    { name: 'synced_at', type: 'datetime' },
    { name: 'created_at', type: 'datetime' },
    { name: 'updated_at', type: 'datetime' },
  ],
  indexes: [
    { name: 'idx_cp_hospital_an', columns: ['hospital_id', 'an'], unique: true },
    { name: 'idx_cp_hospital_id', columns: ['hospital_id'] },
    { name: 'idx_cp_hn', columns: ['hn'] },
    { name: 'idx_cp_labor_status', columns: ['labor_status'] },
    { name: 'idx_cp_cid', columns: ['cid'] },
    { name: 'idx_cp_cid_hash', columns: ['cid_hash'] },
    { name: 'idx_cp_journey_id', columns: ['journey_id'] },
    {
      name: 'idx_cp_hospital_status_created',
      columns: ['hospital_id', 'labor_status', 'created_at'],
    },
  ],
};
