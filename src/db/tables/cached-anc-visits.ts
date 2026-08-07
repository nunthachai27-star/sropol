import type { TableDefinition } from '../table-definition';

export const cachedAncVisitsTable: TableDefinition = {
  name: 'cached_anc_visits',
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'journey_id', type: 'uuid', references: { table: 'maternal_journeys', column: 'id' } },
    // Hospital where THIS specific visit was recorded — distinct from the
    // journey's registering or current hospital, because referred-out
    // patients can attend ANC visits at multiple hospitals across the
    // province. Nullable for legacy rows; backfilled at startup from
    // maternal_journeys.current_hospital_id.
    {
      name: 'hospital_id',
      type: 'uuid',
      nullable: true,
      references: { table: 'hospitals', column: 'id' },
    },
    { name: 'visit_date', type: 'datetime' },
    { name: 'visit_number', type: 'integer' },
    { name: 'ga_weeks', type: 'integer', nullable: true },
    { name: 'ga_days', type: 'integer', nullable: true },
    { name: 'fundal_height_cm', type: 'decimal', nullable: true },
    { name: 'weight_kg', type: 'decimal', nullable: true },
    { name: 'bp_systolic', type: 'integer', nullable: true },
    { name: 'bp_diastolic', type: 'integer', nullable: true },
    { name: 'fetal_hr', type: 'integer', nullable: true },
    { name: 'presentation', type: 'string', maxLength: 50, nullable: true },
    { name: 'engagement', type: 'string', maxLength: 50, nullable: true },
    { name: 'pass_quality', type: 'boolean', nullable: true },
    { name: 'provider_code', type: 'string', maxLength: 20, nullable: true },
    // WHO 2016 ANC data elements (L2). Urine results are FREE TEXT from HOSxP
    // (person_anc.albumin/sugar — e.g. "trace albumin", Thai phrases); never
    // truncate clinical evidence. Existing DBs widened by
    // migrations/widen-anc-result-columns.ts.
    { name: 'urine_protein', type: 'text', nullable: true }, // '-', 'trace', '+', … + free text
    { name: 'urine_glucose', type: 'text', nullable: true },
    { name: 'hb_g_dl', type: 'decimal', nullable: true },
    { name: 'hct_pct', type: 'decimal', nullable: true },
    { name: 'tt_dose_no', type: 'integer', nullable: true }, // tetanus toxoid dose number 0-5
    { name: 'iron_folic_given', type: 'boolean', nullable: true },
    { name: 'calcium_given', type: 'boolean', nullable: true },
    { name: 'danger_signs_json', type: 'json', nullable: true }, // ['bleeding','severe_headache',...]
    { name: 'fetal_movement_ok', type: 'boolean', nullable: true }, // T3 — asks woman if movements felt normal

    // ─── RTCOG OB 66-029 (2566) expansion — per-visit ─────────────────
    // Immunization: structured replacement for tt_dose_no so we can record
    // Tdap/dT/Flu/COVID distinctly (RTCOG wants Tdap every pregnancy 27–36w).
    // Shape: [{ type: 'TT'|'DT'|'TDAP'|'INFLUENZA'|'COVID', dose?: number,
    //          given_at_ga?: number }]. tt_dose_no is kept for backward compat.
    { name: 'vaccines_given_json', type: 'json', nullable: true },

    // Urinalysis additions (free text — see urine_protein note above).
    { name: 'urine_ketone', type: 'text', nullable: true }, // '-','trace','+',… + free text
    { name: 'urine_culture_result', type: 'text', nullable: true }, // free text ("no growth in 48 hours")

    // Full RTCOG supplementation checklist.
    { name: 'iodine_given', type: 'boolean', nullable: true },
    { name: 'multivitamin_given', type: 'boolean', nullable: true },
    { name: 'vitamin_d_iu', type: 'integer', nullable: true },

    // T3 fetal wellbeing (≥28w) — all nullable, only captured when performed.
    { name: 'nst_result', type: 'string', maxLength: 20, nullable: true }, // REACTIVE / NON_REACTIVE / PENDING
    { name: 'bpp_score', type: 'integer', nullable: true }, // 0-10
    { name: 'umbilical_doppler_result', type: 'string', maxLength: 20, nullable: true }, // NORMAL / ABNORMAL

    // Psychosocial + behavioral screen (booking visit typically).
    // Shape: { alcohol?: boolean, smoking?: boolean, illicit_drugs?: boolean,
    //          depression_phq?: number, domestic_violence?: boolean }.
    { name: 'psychosocial_screen_json', type: 'json', nullable: true },

    { name: 'synced_at', type: 'datetime' },
    { name: 'created_at', type: 'datetime' },
  ],
  indexes: [
    { name: 'idx_cav_journey_date', columns: ['journey_id', 'visit_date'], unique: true },
    { name: 'idx_cav_journey_id', columns: ['journey_id'] },
  ],
};
