// maternal_screening_assessments — immutable maternal labor-triage screening
// events (Phase 2, dormant persistence schema — see
// docs/superpowers/plans/2026-07-16-maternal-screening.md, Task 5).
// Append-only clinical audit trail: a correction inserts a NEW row with
// `supersedes_id` pointing at the row it corrects; existing rows are never
// mutated (GC6). This task only defines the schema so SchemaSync creates it —
// nothing writes to this table yet (Task 6 wires the transactional store).
//
// Text columns use generous maxLength per the 2026-07-16 ANC field-width
// incident (see src/db/tables/maternal-journeys.ts comment + widen-anc-
// result-columns migration) — under-sizing a code-width column against
// free-text/webhook-sourced input caused a production "value too long"
// failure; do not repeat that mistake here even though these columns are
// meant to hold short enum-like codes today.
import type { TableDefinition } from '../table-definition';

export const maternalScreeningAssessmentsTable: TableDefinition = {
  name: 'maternal_screening_assessments',
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    // Required (NOT NULL): every assessment is scoped to exactly one labor
    // admission row. This mirrors cpd_scores.patient_id — a required FK to
    // cached_patients — rather than cached_patients.journey_id, which is
    // nullable because an admission need not yet be linked to a pregnancy
    // journey. A screening assessment with no admission has no meaning.
    {
      name: 'labor_admission_id',
      type: 'uuid',
      references: { table: 'cached_patients', column: 'id' },
    },
    { name: 'hospital_id', type: 'uuid', references: { table: 'hospitals', column: 'id' } },
    // Nullable — mirrors cached_patients.journey_id: the admission (and
    // therefore its screenings) is not guaranteed to already be linked to a
    // maternal_journeys row at assessment time.
    {
      name: 'journey_id',
      type: 'uuid',
      nullable: true,
      references: { table: 'maternal_journeys', column: 'id' },
    },
    { name: 'source_system', type: 'string', maxLength: 40 }, // HOSXP / WEBHOOK / MANUAL_UI / ...
    { name: 'source_pk', type: 'string', maxLength: 150, nullable: true },
    { name: 'assessed_at', type: 'datetime' },
    // Actor identity snapshotted inline, non-FK (GC6 / audit_logs pattern) —
    // deliberately does NOT join to `users`, so the row survives account
    // renames/deactivation and never blocks on user-table churn.
    { name: 'assessed_by', type: 'string', maxLength: 150, nullable: true },
    { name: 'input_json', type: 'json' }, // immutable normalized MaternalScreenInput snapshot
    { name: 'local_tier', type: 'string', maxLength: 30 }, // MaternalScreenLocalTier
    { name: 'emergency_acuity', type: 'string', maxLength: 30 }, // MaternalEmergencyAcuity
    { name: 'is_complete', type: 'boolean' },
    { name: 'suspected_conditions_json', type: 'json' }, // SuspectedMaternalCondition[]
    { name: 'matches_json', type: 'json' }, // matched rule ids + evidence (MaternalScreenMatch[])
    { name: 'missing_fields_json', type: 'json' },
    { name: 'rule_set_version', type: 'string', maxLength: 40 },
    // Correction chain: a correction inserts a NEW row pointing back at the
    // row it supersedes; the original is never mutated (GC6). Self-
    // referencing FK is safe here because SchemaSync emits ONE CREATE TABLE
    // statement for a new table — Postgres resolves a REFERENCES clause that
    // points at the table currently being created without needing a
    // follow-up ALTER TABLE ADD CONSTRAINT step. Verified in the
    // integration test alongside this file.
    {
      name: 'supersedes_id',
      type: 'uuid',
      nullable: true,
      references: { table: 'maternal_screening_assessments', column: 'id' },
    },
    { name: 'created_at', type: 'datetime' },
  ],
  indexes: [
    // Idempotency key (spec §8.1). TableDefinition/SchemaSync's
    // IndexDefinition has no WHERE-clause / partial-index support, so a
    // literal "partial unique index that allows multiple NULL source_pk
    // rows" is not expressible in this repo today. It doesn't need to be:
    // a PLAIN Postgres UNIQUE index already gives that exact behavior,
    // because standard SQL never treats NULL as equal to NULL — even inside
    // a composite unique index — so any number of rows with NULL
    // `source_pk` can coexist for the same (hospital_id, source_system)
    // pair (e.g. MANUAL_UI entries with no source primary key), while two
    // rows sharing the same non-null (hospital_id, source_system,
    // source_pk) are rejected at the DB level. Task 6's store service still
    // owns idempotent-upsert semantics end-to-end; this index is defense in
    // depth, not a substitute for it.
    {
      name: 'idx_msa_hospital_source_pk',
      columns: ['hospital_id', 'source_system', 'source_pk'],
      unique: true,
    },
    { name: 'idx_msa_admission_assessed', columns: ['labor_admission_id', 'assessed_at'] },
    {
      name: 'idx_msa_hospital_acuity_assessed',
      columns: ['hospital_id', 'emergency_acuity', 'assessed_at'],
    },
  ],
};
