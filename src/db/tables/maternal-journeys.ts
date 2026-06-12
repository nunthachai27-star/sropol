// maternal_journeys — lifetime pregnancy record (one row per pregnancy per CID).
// Source of truth for care_stage, ancRiskLevel, current_hospital_id.
// Linked to cached_patients via cached_patients.journey_id. See ./README.md.
import type { TableDefinition } from '../table-definition';

export const maternalJourneysTable: TableDefinition = {
  name: 'maternal_journeys',
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'hospital_id', type: 'uuid', references: { table: 'hospitals', column: 'id' } },
    { name: 'current_hospital_id', type: 'uuid', references: { table: 'hospitals', column: 'id' } },
    { name: 'hn', type: 'string', maxLength: 20 },
    { name: 'person_anc_id', type: 'integer', nullable: true },
    { name: 'name', type: 'string', maxLength: 255 },
    { name: 'cid', type: 'string', maxLength: 255 },
    { name: 'cid_hash', type: 'string', maxLength: 64 },
    { name: 'age', type: 'integer' },
    { name: 'gravida', type: 'integer' },
    { name: 'para', type: 'integer', defaultValue: 0 },
    { name: 'lmp', type: 'datetime', nullable: true },
    { name: 'edc', type: 'datetime', nullable: true },
    { name: 'care_stage', type: 'string', maxLength: 20, defaultValue: 'PREGNANCY' },
    { name: 'anc_risk_level', type: 'string', maxLength: 10, defaultValue: 'LOW' },
    { name: 'anc_visit_count', type: 'integer', defaultValue: 0 },
    { name: 'last_anc_date', type: 'datetime', nullable: true },
    { name: 'ga_weeks', type: 'integer', nullable: true },
    { name: 'changwat_code', type: 'string', maxLength: 2, nullable: true },
    { name: 'amphur_code', type: 'string', maxLength: 2, nullable: true },
    { name: 'tambon_code', type: 'string', maxLength: 2, nullable: true },
    // WHO 2016 ANC journey-level data (L2). All optional — populated opportunistically
    // by HOSxP sync / webhook. Results are short codes (POS/NEG/PENDING/UNKNOWN).
    { name: 'blood_group', type: 'string', maxLength: 2, nullable: true },        // A / B / AB / O
    { name: 'rh_factor', type: 'string', maxLength: 3, nullable: true },          // POS / NEG
    { name: 'hbsag_result', type: 'string', maxLength: 10, nullable: true },      // POS / NEG / PENDING (webhook short codes)
    // vdrl_result / hiv_result are fed RAW from HOSxP blood_vdrl/hiv_result via
    // browser-poll (pickLatest, no length cap) — free-text like "Non-reactive
    // (titre 1:1)" / "ตรวจไม่พบเชื้อ" that overflowed varchar(20) and aborted the
    // ANC batch, exactly like urine_protein. TEXT for the same reason; SchemaSync
    // converts the live varchar columns on startup. (hbsag/ogtt above stay short:
    // only the webhook path writes them, with controlled POS/NEG/PENDING codes.)
    { name: 'vdrl_result', type: 'text', nullable: true },
    { name: 'hiv_result', type: 'text', nullable: true },
    { name: 'ogtt_result', type: 'string', maxLength: 10, nullable: true },       // NORMAL / ABNORMAL / PENDING
    // GPAL / GTPAL obstetric history.
    { name: 'term_births', type: 'integer', nullable: true },
    { name: 'preterm_births', type: 'integer', nullable: true },
    { name: 'abortions', type: 'integer', nullable: true },
    { name: 'living_children', type: 'integer', nullable: true },
    // Past medical history free-text summary (HT / DM / thyroid / cardiac / thalassemia / epilepsy).
    { name: 'past_medical_history', type: 'text', nullable: true },

    // ─── RTCOG OB 66-029 (2566) expansion — journey-level ─────────────
    // Thalassemia carrier screening (1st-visit). MCV + DCIP + Hb E; type is
    // one of TRAIT / DISEASE / NORMAL / PENDING. "Disease" tag (HbH,
    // β-thal/HbE, β-thal major) drives an iron-contraindication alert.
    { name: 'mcv_fl', type: 'decimal', nullable: true },
    { name: 'dcip_result', type: 'string', maxLength: 10, nullable: true },      // POS / NEG / PENDING
    { name: 'hb_e_result', type: 'string', maxLength: 10, nullable: true },      // POS / NEG / PENDING
    { name: 'thalassemia_type', type: 'string', maxLength: 20, nullable: true }, // HB_H / BETA_THAL_MAJOR / BETA_THAL_HB_E / TRAIT / NORMAL

    // Cervical cancer screening — Pap or HPV DNA, every 3-5y.
    { name: 'cervical_screen_type', type: 'string', maxLength: 10, nullable: true },   // PAP / HPV / NONE
    { name: 'cervical_screen_result', type: 'string', maxLength: 20, nullable: true }, // NORMAL / ABNORMAL / PENDING
    { name: 'cervical_screen_date', type: 'datetime', nullable: true },

    // Aneuploidy screening (serum markers or cfDNA).
    { name: 'aneuploidy_method', type: 'string', maxLength: 20, nullable: true },      // SERUM_T1 / QUAD_T2 / CFDNA / NONE
    { name: 'aneuploidy_result', type: 'string', maxLength: 20, nullable: true },      // LOW_RISK / HIGH_RISK / PENDING

    // GBS rectovaginal culture at 35-37w.
    { name: 'gbs_result', type: 'string', maxLength: 10, nullable: true },              // POS / NEG / PENDING
    { name: 'gbs_collected_date', type: 'datetime', nullable: true },

    // 2nd-trimester anatomy scan (18-22w) + estimated fetal weight.
    { name: 'anatomy_scan_date', type: 'datetime', nullable: true },
    { name: 'anatomy_scan_result', type: 'string', maxLength: 20, nullable: true },    // NORMAL / ABNORMAL / PENDING
    { name: 'efw_g', type: 'integer', nullable: true },

    // EDC dating provenance — LMP (default), US (Ultrasound), ART (IVF/ICSI).
    { name: 'dating_method', type: 'string', maxLength: 10, nullable: true },

    // RTCOG Section 6 additional HR criteria — persisted so the risk
    // classifier can read them without another round-trip to HOSxP.
    { name: 'proteinuria_24h_mg', type: 'integer', nullable: true },
    { name: 'creatinine_mg_dl', type: 'decimal', nullable: true },
    { name: 'prior_pe_dvt', type: 'boolean', nullable: true },
    { name: 'severe_lung_disease', type: 'boolean', nullable: true },
    { name: 'alloimmunization_cde', type: 'boolean', nullable: true },
    { name: 'bariatric_surgery_hx', type: 'boolean', nullable: true },
    { name: 'teratogen_exposure', type: 'boolean', nullable: true },
    { name: 'congenital_infection', type: 'boolean', nullable: true },

    // GDM early-screen risk factors — JSON array for forward-compat.
    // Example: ["bmi_over_30", "first_degree_dm", "pcos", "prior_macrosomia",
    //          "steroid_use", "prior_igm"].
    { name: 'gdm_risk_factors_json', type: 'json', nullable: true },
    { name: 'registered_at', type: 'datetime' },
    { name: 'stage_changed_at', type: 'datetime' },
    { name: 'synced_at', type: 'datetime' },
    { name: 'created_at', type: 'datetime' },
    { name: 'updated_at', type: 'datetime' },
  ],
  indexes: [
    { name: 'idx_mj_hospital_hn', columns: ['hospital_id', 'hn'] },
    { name: 'idx_mj_care_stage', columns: ['care_stage'] },
    { name: 'idx_mj_anc_risk_level', columns: ['anc_risk_level'] },
    { name: 'idx_mj_cid_hash', columns: ['cid_hash'] },
    { name: 'idx_mj_current_hospital', columns: ['current_hospital_id'] },
    { name: 'idx_mj_location', columns: ['changwat_code', 'amphur_code', 'tambon_code'] },
    { name: 'idx_mj_hospital_stage', columns: ['current_hospital_id', 'care_stage'] },
  ],
};
