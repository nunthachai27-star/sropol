// T016: Dual-dialect SQL query templates for HOSxP via BMS Session API
// No hardcoded conditions — all queries are parameterized and configurable

export type DatabaseDialect = 'postgresql' | 'mysql';

export interface SqlQueryTemplate {
  postgresql: string;
  mysql: string;
}

export function getQuery(template: SqlQueryTemplate, dialect: DatabaseDialect): string {
  return template[dialect];
}

// Active patients (admitted, not yet discharged)
// Uses ipt as main table with LEFT JOINs to enrich with pregnancy/labour/patient data
// ipt_pregnancy.anc_complete is CHAR(1) 'Y'/'N' flag, NOT a count
// ipt_labour.anc_count is the actual numeric ANC visit count
export const ACTIVE_LABOR_PATIENTS: SqlQueryTemplate = {
  postgresql: `
    SELECT i.an, i.hn, i.regdate, i.regtime, i.ward,
           p.pname, p.fname, p.lname, p.cid, p.birthday, p.sex,
           COALESCE(il.g, ip.preg_number) AS preg_number,
           COALESCE(il.ga, ip.ga) AS ga,
           il.anc_count,
           ip.anc_complete,
           ip.labor_date
    FROM ipt i
    JOIN patient p ON p.hn = i.hn
    LEFT JOIN ipt_pregnancy ip ON i.an = ip.an
    LEFT JOIN ipt_labour il ON i.an = il.an
    WHERE i.dchdate IS NULL
    ORDER BY i.regdate DESC`,
  mysql: `
    SELECT i.an, i.hn, i.regdate, i.regtime, i.ward,
           p.pname, p.fname, p.lname, p.cid, p.birthday, p.sex,
           COALESCE(il.g, ip.preg_number) AS preg_number,
           COALESCE(il.ga, ip.ga) AS ga,
           il.anc_count,
           ip.anc_complete,
           ip.labor_date
    FROM ipt i
    JOIN patient p ON p.hn = i.hn
    LEFT JOIN ipt_pregnancy ip ON i.an = ip.an
    LEFT JOIN ipt_labour il ON i.an = il.an
    WHERE i.dchdate IS NULL
    ORDER BY i.regdate DESC`,
};

// Pregnancy vital signs for a specific admission (partogram + vitals data)
export const PREGNANCY_VITAL_SIGNS: SqlQueryTemplate = {
  postgresql: `
    SELECT pvs.an, pvs.hr, pvs.bps, pvs.bpd,
           pvs.fetal_heart_sound, pvs.cervical_open_size,
           pvs.eff, pvs.station, pvs.hct, pvs.height, pvs.bw,
           pvs.temperature, pvs.rr, pvs.ultrasound_result
    FROM ipt_pregnancy_vital_sign pvs
    WHERE pvs.an = $1`,
  mysql: `
    SELECT pvs.an, pvs.hr, pvs.bps, pvs.bpd,
           pvs.fetal_heart_sound, pvs.cervical_open_size,
           pvs.eff, pvs.station, pvs.hct, pvs.height, pvs.bw,
           pvs.temperature, pvs.rr, pvs.ultrasound_result
    FROM ipt_pregnancy_vital_sign pvs
    WHERE pvs.an = ?`,
};

// Patient demographics
export const PATIENT_DEMOGRAPHICS: SqlQueryTemplate = {
  postgresql: `
    SELECT p.hn, p.pname, p.fname, p.lname, p.cid, p.birthday, p.sex
    FROM patient p
    WHERE p.hn = $1`,
  mysql: `
    SELECT p.hn, p.pname, p.fname, p.lname, p.cid, p.birthday, p.sex
    FROM patient p
    WHERE p.hn = ?`,
};

// Labor record for an admission
export const LABOR_RECORD: SqlQueryTemplate = {
  postgresql: `
    SELECT l.laborid, l.an, l.mother_gvalue, l.mother_hct,
           l.mother_aging, l.mother_lmp_date, l.mother_edc_date,
           l.labour_startdate, l.labour_starttime,
           l.labour_finishdate, l.labour_finishtime,
           l.placenta_bloodloss, l.infant_weight, l.infant_sex
    FROM labor l
    WHERE l.an = $1`,
  mysql: `
    SELECT l.laborid, l.an, l.mother_gvalue, l.mother_hct,
           l.mother_aging, l.mother_lmp_date, l.mother_edc_date,
           l.labour_startdate, l.labour_starttime,
           l.labour_finishdate, l.labour_finishtime,
           l.placenta_bloodloss, l.infant_weight, l.infant_sex
    FROM labor l
    WHERE l.an = ?`,
};

// ANC data for a patient
export const ANC_DATA: SqlQueryTemplate = {
  postgresql: `
    SELECT pa.person_anc_id, pa.person_id,
           pa.blood_hct_result, pa.ga, pa.lmp, pa.edc,
           pa.preg_no, pa.service_count
    FROM person_anc pa
    WHERE pa.person_id = (
      SELECT p.person_id FROM patient p WHERE p.hn = $1 LIMIT 1
    )
    ORDER BY pa.person_anc_id DESC
    LIMIT 1`,
  mysql: `
    SELECT pa.person_anc_id, pa.person_id,
           pa.blood_hct_result, pa.ga, pa.lmp, pa.edc,
           pa.preg_no, pa.service_count
    FROM person_anc pa
    WHERE pa.person_id = (
      SELECT p.person_id FROM patient p WHERE p.hn = ? LIMIT 1
    )
    ORDER BY pa.person_anc_id DESC
    LIMIT 1`,
};

// Physical examination data (height, weight)
export const OPDSCREEN_DATA: SqlQueryTemplate = {
  postgresql: `
    SELECT os.hn, os.height, os.weight
    FROM opdscreen os
    WHERE os.hn = $1
    ORDER BY os.vstdate DESC
    LIMIT 1`,
  mysql: `
    SELECT os.hn, os.height, os.weight
    FROM opdscreen os
    WHERE os.hn = ?
    ORDER BY os.vstdate DESC
    LIMIT 1`,
};

// Database version check (used by admin test-connection)
export const DATABASE_VERSION: SqlQueryTemplate = {
  postgresql: `SELECT version()`,
  mysql: `SELECT version()`,
};

// Check if key tables exist
export const CHECK_TABLES: SqlQueryTemplate = {
  postgresql: `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('ipt', 'ipt_pregnancy', 'ipt_labour', 'ipt_pregnancy_vital_sign', 'labor', 'patient')`,
  mysql: `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name IN ('ipt', 'ipt_pregnancy', 'ipt_labour', 'ipt_pregnancy_vital_sign', 'labor', 'patient')`,
};

// ANC registered patients (filtered by registration date)
export const ANC_PATIENTS: SqlQueryTemplate = {
  postgresql: `
      SELECT pa.person_anc_id, pa.person_id, pt.hn,
             CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS fullname,
             pt.cid, pt.birthday,
             pa.preg_no, pa.lmp, pa.edc, pa.anc_register_date
      FROM person_anc pa
      JOIN patient pt ON pt.person_id = pa.person_id
      WHERE pa.anc_register_date >= $1
      ORDER BY pa.anc_register_date DESC`,
  mysql: `
      SELECT pa.person_anc_id, pa.person_id, pt.hn,
             CONCAT(pt.pname, pt.fname, ' ', pt.lname) AS fullname,
             pt.cid, pt.birthday,
             pa.preg_no, pa.lmp, pa.edc, pa.anc_register_date
      FROM person_anc pa
      JOIN patient pt ON pt.person_id = pa.person_id
      WHERE pa.anc_register_date >= ?
      ORDER BY pa.anc_register_date DESC`,
};

// ANC visit services for a specific person_anc_id
export const ANC_SERVICES: SqlQueryTemplate = {
  postgresql: `
      SELECT pas.person_anc_service_id, pas.person_anc_id,
             pas.service_date, pas.anc_service_number,
             pas.pa_week, pas.pa_day,
             pas.fundal_height, pas.bw,
             os.bps, os.bpd,
             pas.fetal_heart_rate,
             pas.baby_position, pas.baby_lead,
             pas.pass_quality, pas.doctor_code
      FROM person_anc_service pas
      LEFT JOIN opdscreen os ON os.vn = pas.vn
      WHERE pas.person_anc_id = $1
      ORDER BY pas.service_date`,
  mysql: `
      SELECT pas.person_anc_service_id, pas.person_anc_id,
             pas.service_date, pas.anc_service_number,
             pas.pa_week, pas.pa_day,
             pas.fundal_height, pas.bw,
             os.bps, os.bpd,
             pas.fetal_heart_rate,
             pas.baby_position, pas.baby_lead,
             pas.pass_quality, pas.doctor_code
      FROM person_anc_service pas
      LEFT JOIN opdscreen os ON os.vn = pas.vn
      WHERE pas.person_anc_id = ?
      ORDER BY pas.service_date`,
};

// ANC risk flags for a specific person_anc_id
export const ANC_RISKS: SqlQueryTemplate = {
  postgresql: `
      SELECT par.person_anc_risk_id, par.person_anc_id, par.anc_risk_id
      FROM person_anc_risk par
      WHERE par.person_anc_id = $1`,
  mysql: `
      SELECT par.person_anc_risk_id, par.person_anc_id, par.anc_risk_id
      FROM person_anc_risk par
      WHERE par.person_anc_id = ?`,
};

// ANC classifying items for a specific person_anc_id
export const ANC_CLASSIFYING: SqlQueryTemplate = {
  postgresql: `
      SELECT pac.person_anc_classifying_id, pac.person_anc_id,
             pac.person_anc_classifying_item_id, pac.check_value
      FROM person_anc_classifying pac
      WHERE pac.person_anc_id = $1`,
  mysql: `
      SELECT pac.person_anc_classifying_id, pac.person_anc_id,
             pac.person_anc_classifying_item_id, pac.check_value
      FROM person_anc_classifying pac
      WHERE pac.person_anc_id = ?`,
};

// Infant records for a specific admission number
export const LABOUR_INFANTS: SqlQueryTemplate = {
  postgresql: `
      SELECT li.ipt_labour_infant_id, li.ipt_labour_id, li.an,
             li.infant_number, li.sex, li.birth_weight, li.body_length, li.head_length,
             li.temperature, li.rr, li.hr,
             li.apgar_score_min1, li.apgar_score_min5, li.apgar_score_min10,
             li.infant_check_ppv, li.infant_check_et_tube, li.infant_check_chest_pump,
             li.infant_check_oxygen_box, li.infant_check_narcan,
             li.infant_check_feed_milk, li.infant_check_vitk, li.infant_check_eyepaste,
             li.infant_check_bcg, li.infant_check_hepb, li.infant_check_azt,
             li.infant_icd10, li.infant_hn, li.infant_an, li.infant_dchstts,
             li.birth_date, li.birth_time
      FROM ipt_labour_infant li
      JOIN ipt_labour il ON il.ipt_labour_id = li.ipt_labour_id
      WHERE il.an = $1`,
  mysql: `
      SELECT li.ipt_labour_infant_id, li.ipt_labour_id, li.an,
             li.infant_number, li.sex, li.birth_weight, li.body_length, li.head_length,
             li.temperature, li.rr, li.hr,
             li.apgar_score_min1, li.apgar_score_min5, li.apgar_score_min10,
             li.infant_check_ppv, li.infant_check_et_tube, li.infant_check_chest_pump,
             li.infant_check_oxygen_box, li.infant_check_narcan,
             li.infant_check_feed_milk, li.infant_check_vitk, li.infant_check_eyepaste,
             li.infant_check_bcg, li.infant_check_hepb, li.infant_check_azt,
             li.infant_icd10, li.infant_hn, li.infant_an, li.infant_dchstts,
             li.birth_date, li.birth_time
      FROM ipt_labour_infant li
      JOIN ipt_labour il ON il.ipt_labour_id = li.ipt_labour_id
      WHERE il.an = ?`,
};

export const REFEROUT_PREGNANCY: SqlQueryTemplate = {
  postgresql: `
      SELECT ro.refer_number, ro.refer_date, p.hn,
             ro.refer_hospcode, ro.icd10,
             ro.referout_emergency_type_id
      FROM referout ro
      JOIN ovst o ON o.vn = ro.vn
      JOIN patient p ON p.hn = o.hn
      JOIN ipt_pregnancy ip ON ip.an = (
        SELECT i.an FROM ipt i WHERE i.vn = o.vn LIMIT 1
      )
      WHERE ro.refer_date >= $1
      ORDER BY ro.refer_date DESC`,
  mysql: `
      SELECT ro.refer_number, ro.refer_date, p.hn,
             ro.refer_hospcode, ro.icd10,
             ro.referout_emergency_type_id
      FROM referout ro
      JOIN ovst o ON o.vn = ro.vn
      JOIN patient p ON p.hn = o.hn
      JOIN ipt_pregnancy ip ON ip.an = (
        SELECT i.an FROM ipt i WHERE i.vn = o.vn LIMIT 1
      )
      WHERE ro.refer_date >= ?
      ORDER BY ro.refer_date DESC`,
};
