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
             os.bps, os.bpd, os.height,
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
             os.bps, os.bpd, os.height,
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

// Partograph observations for currently-admitted labour patients.
// Joins ipt_labour_partograph (raw observations) to labour_amniotic_type
// for the human-readable amniotic-fluid label, and gates on ipt.dchdate IS NULL
// so we only sync rows for patients still in the labour ward. Ordering by
// (an, observe_datetime) makes the subsequent CDSS analyzers' chronological
// scan deterministic.
export const PARTOGRAPH_OBSERVATIONS: SqlQueryTemplate = {
  postgresql: `
    SELECT lp.ipt_labour_partograph_id,
           lp.ipt_labour_id,
           lp.an,
           lp.observe_datetime,
           lp.hour_no,
           lp.fetal_heart_rate,
           lp.amniotic_fluid,
           lp.labour_amniotic_type_id,
           lat.labour_amniotic_type_name AS amniotic_type_name,
           lp.moulding,
           lp.cervical_dilation_cm,
           lp.descent_of_head,
           lp.contraction_per_10min,
           lp.contraction_duration_sec,
           lp.contraction_strength,
           lp.oxytocin_uml,
           lp.oxytocin_drops_min,
           lp.drugs_iv_fluids,
           lp.pulse,
           lp.bp_systolic,
           lp.bp_diastolic,
           lp.temperature,
           lp.urine_volume_ml,
           lp.urine_protein,
           lp.urine_glucose,
           lp.urine_acetone,
           lp.note,
           lp.entry_staff,
           lp.entry_datetime
      FROM ipt_labour_partograph lp
      LEFT JOIN labour_amniotic_type lat
             ON lat.labour_amniotic_type_id = lp.labour_amniotic_type_id
      JOIN ipt i ON i.an = lp.an
     WHERE i.dchdate IS NULL
     ORDER BY lp.an, lp.observe_datetime`,
  mysql: `
    SELECT lp.ipt_labour_partograph_id,
           lp.ipt_labour_id,
           lp.an,
           lp.observe_datetime,
           lp.hour_no,
           lp.fetal_heart_rate,
           lp.amniotic_fluid,
           lp.labour_amniotic_type_id,
           lat.labour_amniotic_type_name AS amniotic_type_name,
           lp.moulding,
           lp.cervical_dilation_cm,
           lp.descent_of_head,
           lp.contraction_per_10min,
           lp.contraction_duration_sec,
           lp.contraction_strength,
           lp.oxytocin_uml,
           lp.oxytocin_drops_min,
           lp.drugs_iv_fluids,
           lp.pulse,
           lp.bp_systolic,
           lp.bp_diastolic,
           lp.temperature,
           lp.urine_volume_ml,
           lp.urine_protein,
           lp.urine_glucose,
           lp.urine_acetone,
           lp.note,
           lp.entry_staff,
           lp.entry_datetime
      FROM ipt_labour_partograph lp
      LEFT JOIN labour_amniotic_type lat
             ON lat.labour_amniotic_type_id = lp.labour_amniotic_type_id
      JOIN ipt i ON i.an = lp.an
     WHERE i.dchdate IS NULL
     ORDER BY lp.an, lp.observe_datetime`,
};

// Patient address (province/district/sub-district) for GIS mapping
// Reads from patient table's chwpart/amppart/tmbpart (2-digit Thai admin codes)
export const PATIENT_ADDRESS: SqlQueryTemplate = {
  postgresql: `
      SELECT p.hn, p.chwpart, p.amppart, p.tmbpart
      FROM patient p
      WHERE p.hn = ANY($1::varchar[])`,
  mysql: `
      SELECT p.hn, p.chwpart, p.amppart, p.tmbpart
      FROM patient p
      WHERE p.hn IN (?)`,
};

// =============================================================================
// Maternity-ward SQL templates (Task 9)
// All 17 templates below back the hospital maternity-ward UI. Each has both
// postgresql and mysql variants, follows portability rules (no NOW/CURDATE,
// no INTERVAL date arithmetic, no backticks, single-quoted string literals),
// and column/table existence has been verified against the live HOSxP schema.
// =============================================================================

// IMPORTANT — placeholder syntax: BMS `/api/sql` does NOT substitute `?` or
// `$N` placeholders. It accepts ONLY Pascal-style `:name` placeholders, with
// params provided as `{name: {value: <val>, value_type: 'string'|...}}`.
// (Verified live: `?` → 42000 syntax error; `$N` → "Unknown column $1";
// `:name` with typed params → 200 OK.) Both dialect variants below are
// therefore identical because the BMS substitution layer is dialect-agnostic.
// The {postgresql,mysql} structure is kept for future queries that may need
// dialect-specific function syntax (date arithmetic, etc.) — for now both
// hold the same string.

// List of maternity wards available at the hospital
export const MATERNITY_WARDS: SqlQueryTemplate = {
  postgresql: `SELECT ward, name, real_bedcount FROM ward WHERE is_maternity_ward = 'Y' AND ward_active = 'Y' ORDER BY name`,
  mysql: `SELECT ward, name, real_bedcount FROM ward WHERE is_maternity_ward = 'Y' AND ward_active = 'Y' ORDER BY name`,
};

// Bed inventory for a ward (rooms + beds, regardless of occupancy)
export const WARD_BEDS_INVENTORY: SqlQueryTemplate = {
  postgresql: `SELECT b.bedno, b.roomno, b.bed_order, b.bed_lock, b.bed_status_type_id, r.name AS room_name, r.display_number AS room_display_number FROM bedno b JOIN roomno r ON r.roomno = b.roomno WHERE r.ward = :ward ORDER BY r.display_number, b.bed_order, b.bedno`,
  mysql: `SELECT b.bedno, b.roomno, b.bed_order, b.bed_lock, b.bed_status_type_id, r.name AS room_name, r.display_number AS room_display_number FROM bedno b JOIN roomno r ON r.roomno = b.roomno WHERE r.ward = :ward ORDER BY r.display_number, b.bed_order, b.bedno`,
};

// Bed occupancy snapshot for a ward (active admissions joined to bed assignment +
// patient demographics + most-recent partograph observation)
export const WARD_BEDS_OCCUPANCY: SqlQueryTemplate = {
  postgresql: `SELECT i.an, i.hn, i.regdate, i.regtime, i.ward,
       iptadm.bedno, iptadm.roomno, iptadm.bedtype,
       roomno.name AS roomname,
       p.pname, p.fname, p.lname, p.birthday, p.blood_grp,
       il.g AS gravida, il.ga,
       di.name AS incharge_doctor_name,
       (SELECT COUNT(*) FROM opd_allergy WHERE hn = i.hn) AS allergy_count,
       (SELECT MAX(observe_datetime) FROM ipt_labour_partograph
         WHERE an = i.an) AS last_observation_at,
       (SELECT cervical_dilation_cm FROM ipt_labour_partograph
         WHERE an = i.an ORDER BY observe_datetime DESC LIMIT 1) AS last_cervix_cm
  FROM ipt i
  JOIN iptadm ON iptadm.an = i.an
  LEFT JOIN patient p ON p.hn = i.hn
  LEFT JOIN ipt_labour il ON il.an = i.an
  LEFT JOIN doctor di ON di.code = i.incharge_doctor
  LEFT JOIN roomno ON roomno.roomno = iptadm.roomno
 WHERE i.ward = :ward AND i.confirm_discharge = 'N'
 ORDER BY iptadm.bedno`,
  mysql: `SELECT i.an, i.hn, i.regdate, i.regtime, i.ward,
       iptadm.bedno, iptadm.roomno, iptadm.bedtype,
       roomno.name AS roomname,
       p.pname, p.fname, p.lname, p.birthday, p.blood_grp,
       il.g AS gravida, il.ga,
       di.name AS incharge_doctor_name,
       (SELECT COUNT(*) FROM opd_allergy WHERE hn = i.hn) AS allergy_count,
       (SELECT MAX(observe_datetime) FROM ipt_labour_partograph
         WHERE an = i.an) AS last_observation_at,
       (SELECT cervical_dilation_cm FROM ipt_labour_partograph
         WHERE an = i.an ORDER BY observe_datetime DESC LIMIT 1) AS last_cervix_cm
  FROM ipt i
  JOIN iptadm ON iptadm.an = i.an
  LEFT JOIN patient p ON p.hn = i.hn
  LEFT JOIN ipt_labour il ON il.an = i.an
  LEFT JOIN doctor di ON di.code = i.incharge_doctor
  LEFT JOIN roomno ON roomno.roomno = iptadm.roomno
 WHERE i.ward = :ward AND i.confirm_discharge = 'N'
 ORDER BY iptadm.bedno`,
};

// Bed occupancy snapshot (clinical-density variant) — same scope as
// WARD_BEDS_OCCUPANCY but joins the LATEST ipt_labour_partograph row + LATEST
// ipd_nurse_note row per AN, surfacing every field the dense bed-tile UI needs
// (vitals, labour progress, contractions, FHR, interventions, last assessment,
// allergy/blood-type identifier flags).
//
// **Source map** — confirmed against HOSxP Delphi entry forms + project memory:
//   * `ipd_nurse_note`            → BP / T / P / RR / SpO2 / pain
//                                   (= the floor-nurse's standard observations)
//   * `ipt_labour_partograph`     → cervix / station / FHR / contractions /
//                                   oxytocin / IV fluids / amniotic fluid
//                                   (= partograph time-series)
//   * `opd_allergy`               → patient drug-allergy registry — used for
//                                   the NKDA / ALLERGY pill on the bed tile
//                                   (count > 0 ⇒ ALLERGY, else NKDA).
//   * `patient.blood_grp`         → blood-group flag (A / B / AB / O).
// Don't pull standard vitals from `ipt_pregnancy_vital_sign`; that table is
// labour-context only and is not where IPD nurses log every-shift observations.
// Don't pull allergy info from `person.allergy` free-text — `opd_allergy` is
// the structured registry HOSxP itself reads.
//
// Latest-row strategy: each LEFT JOIN resolves to the PK of the most recent
// row via a single ordered subquery, then the JOIN itself is a PK lookup. This
// avoids one-correlated-subquery-per-column (16+ scans per ipt row) and keeps
// the query within the constitution-VI 2-second SQL budget for 12-bed wards.
// Both PostgreSQL and MySQL execute this pattern with proper indexes on
// (an, observe_datetime) and (an, note_date, note_time). Allergy uses a
// COUNT subquery (returns int) rather than EXISTS so the result type is
// dialect-portable without CASE/BOOL conversions.
export const WARD_BEDS_OCCUPANCY_FULL: SqlQueryTemplate = {
  postgresql: `SELECT i.an, i.hn, i.regdate, i.regtime, i.ward,
       iptadm.bedno, iptadm.roomno, iptadm.bedtype,
       roomno.name AS roomname,
       p.pname, p.fname, p.lname, p.birthday, p.blood_grp,
       il.g AS gravida, il.ga,
       di.name AS incharge_doctor_name,
       (SELECT COUNT(*) FROM opd_allergy WHERE hn = i.hn) AS allergy_count,
       latest_lp.observe_datetime    AS last_observation_at,
       latest_lp.cervical_dilation_cm AS last_cervix_cm,
       latest_lp.descent_of_head     AS last_station,
       latest_lp.fetal_heart_rate    AS last_fhr,
       latest_lp.contraction_per_10min   AS last_contr_freq,
       latest_lp.contraction_duration_sec AS last_contr_duration,
       latest_lp.contraction_strength AS last_contr_strength,
       latest_lp.oxytocin_uml        AS last_oxytocin_uml,
       latest_lp.oxytocin_drops_min  AS last_oxytocin_drops,
       latest_lp.drugs_iv_fluids     AS last_iv_fluids,
       latest_lp.amniotic_fluid      AS last_amniotic,
       latest_nn.bp_systolic         AS last_bp_sys,
       latest_nn.bp_diastolic        AS last_bp_dia,
       latest_nn.temperature         AS last_temp,
       latest_nn.pulse               AS last_pulse,
       latest_nn.respiratory_rate    AS last_rr,
       COALESCE(latest_nn.spo2_ra, latest_nn.spo2_o2) AS last_spo2,
       latest_nn.pain_score          AS last_pain,
       latest_nn.note_date           AS last_assess_date,
       latest_nn.note_time           AS last_assess_time,
       latest_nn.doctor_code         AS last_assess_staff
  FROM ipt i
  JOIN iptadm ON iptadm.an = i.an
  LEFT JOIN patient p ON p.hn = i.hn
  LEFT JOIN ipt_labour il ON il.an = i.an
  LEFT JOIN doctor di ON di.code = i.incharge_doctor
  LEFT JOIN roomno ON roomno.roomno = iptadm.roomno
  LEFT JOIN ipt_labour_partograph latest_lp
    ON latest_lp.ipt_labour_partograph_id = (
      SELECT ipt_labour_partograph_id FROM ipt_labour_partograph
       WHERE an = i.an
       ORDER BY observe_datetime DESC, ipt_labour_partograph_id DESC
       LIMIT 1)
  LEFT JOIN ipd_nurse_note latest_nn
    ON latest_nn.nurse_note_id = (
      SELECT nurse_note_id FROM ipd_nurse_note
       WHERE an = i.an
       ORDER BY note_date DESC, note_time DESC, nurse_note_id DESC
       LIMIT 1)
 WHERE i.ward = :ward AND i.confirm_discharge = 'N'
 ORDER BY iptadm.bedno`,
  mysql: `SELECT i.an, i.hn, i.regdate, i.regtime, i.ward,
       iptadm.bedno, iptadm.roomno, iptadm.bedtype,
       roomno.name AS roomname,
       p.pname, p.fname, p.lname, p.birthday, p.blood_grp,
       il.g AS gravida, il.ga,
       di.name AS incharge_doctor_name,
       (SELECT COUNT(*) FROM opd_allergy WHERE hn = i.hn) AS allergy_count,
       latest_lp.observe_datetime    AS last_observation_at,
       latest_lp.cervical_dilation_cm AS last_cervix_cm,
       latest_lp.descent_of_head     AS last_station,
       latest_lp.fetal_heart_rate    AS last_fhr,
       latest_lp.contraction_per_10min   AS last_contr_freq,
       latest_lp.contraction_duration_sec AS last_contr_duration,
       latest_lp.contraction_strength AS last_contr_strength,
       latest_lp.oxytocin_uml        AS last_oxytocin_uml,
       latest_lp.oxytocin_drops_min  AS last_oxytocin_drops,
       latest_lp.drugs_iv_fluids     AS last_iv_fluids,
       latest_lp.amniotic_fluid      AS last_amniotic,
       latest_nn.bp_systolic         AS last_bp_sys,
       latest_nn.bp_diastolic        AS last_bp_dia,
       latest_nn.temperature         AS last_temp,
       latest_nn.pulse               AS last_pulse,
       latest_nn.respiratory_rate    AS last_rr,
       COALESCE(latest_nn.spo2_ra, latest_nn.spo2_o2) AS last_spo2,
       latest_nn.pain_score          AS last_pain,
       latest_nn.note_date           AS last_assess_date,
       latest_nn.note_time           AS last_assess_time,
       latest_nn.doctor_code         AS last_assess_staff
  FROM ipt i
  JOIN iptadm ON iptadm.an = i.an
  LEFT JOIN patient p ON p.hn = i.hn
  LEFT JOIN ipt_labour il ON il.an = i.an
  LEFT JOIN doctor di ON di.code = i.incharge_doctor
  LEFT JOIN roomno ON roomno.roomno = iptadm.roomno
  LEFT JOIN ipt_labour_partograph latest_lp
    ON latest_lp.ipt_labour_partograph_id = (
      SELECT ipt_labour_partograph_id FROM ipt_labour_partograph
       WHERE an = i.an
       ORDER BY observe_datetime DESC, ipt_labour_partograph_id DESC
       LIMIT 1)
  LEFT JOIN ipd_nurse_note latest_nn
    ON latest_nn.nurse_note_id = (
      SELECT nurse_note_id FROM ipd_nurse_note
       WHERE an = i.an
       ORDER BY note_date DESC, note_time DESC, nurse_note_id DESC
       LIMIT 1)
 WHERE i.ward = :ward AND i.confirm_discharge = 'N'
 ORDER BY iptadm.bedno`,
};

// All partograph observations for a single admission (chronological)
export const PATIENT_PARTOGRAPH_BY_AN: SqlQueryTemplate = {
  postgresql: `SELECT * FROM ipt_labour_partograph WHERE an = :an ORDER BY observe_datetime`,
  mysql: `SELECT * FROM ipt_labour_partograph WHERE an = :an ORDER BY observe_datetime`,
};

// Pregnancy vital-sign rows for a single admission
export const PATIENT_VITAL_SIGNS_BY_AN: SqlQueryTemplate = {
  postgresql: `SELECT * FROM ipt_pregnancy_vital_sign WHERE an = :an`,
  mysql: `SELECT * FROM ipt_pregnancy_vital_sign WHERE an = :an`,
};

// IPD nurse-note rows for a single admission — the comprehensive vital-sign
// chart source (70+ columns) ported from HOSxPIPDPatientAdmitNurseNoteEntry
// Form. Real HOSxP table is `ipd_nurse_note`, PK `nurse_note_id` (confirmed
// against the Delphi DoSaveData SQL). Ordered chronologically so the chart's
// x-axis renders left-to-right.
export const PATIENT_NURSE_NOTES_BY_AN: SqlQueryTemplate = {
  postgresql: `SELECT * FROM ipd_nurse_note WHERE an = :an ORDER BY note_date, note_time`,
  mysql: `SELECT * FROM ipd_nurse_note WHERE an = :an ORDER BY note_date, note_time`,
};

// Pre-labour summary record (ipt_labour) for a single admission
export const PATIENT_LABOUR_BY_AN: SqlQueryTemplate = {
  postgresql: `SELECT * FROM ipt_labour WHERE an = :an`,
  mysql: `SELECT * FROM ipt_labour WHERE an = :an`,
};

// Pregnancy summary record (ipt_pregnancy) for a single admission
export const PATIENT_PREGNANCY_BY_AN: SqlQueryTemplate = {
  postgresql: `SELECT * FROM ipt_pregnancy WHERE an = :an`,
  mysql: `SELECT * FROM ipt_pregnancy WHERE an = :an`,
};

// Labor stage record (labor table) for a single admission
export const PATIENT_LABOR_BY_AN: SqlQueryTemplate = {
  postgresql: `SELECT * FROM labor WHERE an = :an`,
  mysql: `SELECT * FROM labor WHERE an = :an`,
};

// Labour-medication rows (free-text meds) for a single admission
export const PATIENT_LABOUR_MED_BY_AN: SqlQueryTemplate = {
  postgresql: `SELECT * FROM labour_medication WHERE an = :an`,
  mysql: `SELECT * FROM labour_medication WHERE an = :an`,
};

// Stage-medication rows (delivery-room meds keyed to drug master) with friendly
// medication + staff names joined in
export const PATIENT_STAGE_MED_BY_AN: SqlQueryTemplate = {
  postgresql: `SELECT lsm.*, CONCAT(s.name, ' ', s.strength, ' ', s.units) AS medication_name, o.name AS staff_name FROM labour_stage_medication lsm LEFT JOIN s_drugitems s ON s.icode = lsm.icode LEFT JOIN opduser o ON o.loginname = lsm.staff WHERE lsm.an = :an ORDER BY lsm.medication_date, lsm.medication_time`,
  mysql: `SELECT lsm.*, CONCAT(s.name, ' ', s.strength, ' ', s.units) AS medication_name, o.name AS staff_name FROM labour_stage_medication lsm LEFT JOIN s_drugitems s ON s.icode = lsm.icode LEFT JOIN opduser o ON o.loginname = lsm.staff WHERE lsm.an = :an ORDER BY lsm.medication_date, lsm.medication_time`,
};

// Labour complications keyed by ipt_labour_id (NOT an), joined to lookup name
export const PATIENT_COMPLICATIONS_BY_LABOUR_ID: SqlQueryTemplate = {
  postgresql: `SELECT lc.*, lcl.name AS complication_name FROM ipt_labour_complication lc LEFT JOIN labour_complication lcl ON lcl.labour_complication_id = lc.labour_complication_id WHERE lc.ipt_labour_id = :ipt_labour_id`,
  mysql: `SELECT lc.*, lcl.name AS complication_name FROM ipt_labour_complication lc LEFT JOIN labour_complication lcl ON lcl.labour_complication_id = lc.labour_complication_id WHERE lc.ipt_labour_id = :ipt_labour_id`,
};

// Newborn + ipt_labour_infant join for a single admission
export const PATIENT_INFANTS_BY_AN: SqlQueryTemplate = {
  postgresql: `SELECT n.*, li.* FROM ipt_newborn n LEFT JOIN ipt_labour_infant li ON li.an = n.an WHERE n.an = :an`,
  mysql: `SELECT n.*, li.* FROM ipt_newborn n LEFT JOIN ipt_labour_infant li ON li.an = n.an WHERE n.an = :an`,
};

// Lookup: bed-move reason values
export const BED_MOVE_REASONS: SqlQueryTemplate = {
  postgresql: `SELECT reason FROM iptbedmove_reason ORDER BY reason`,
  mysql: `SELECT reason FROM iptbedmove_reason ORDER BY reason`,
};

// Lookup: drug master autocomplete (typeahead) — caller passes 'name%' or '%name%'
export const DRUG_LOOKUP: SqlQueryTemplate = {
  postgresql: `SELECT icode, CONCAT(name, ' ', strength, ' ', units) AS label FROM s_drugitems WHERE name LIKE :q ORDER BY name LIMIT 50`,
  mysql: `SELECT icode, CONCAT(name, ' ', strength, ' ', units) AS label FROM s_drugitems WHERE name LIKE :q ORDER BY name LIMIT 50`,
};

// Lookup: labour-complication codes
export const LABOUR_COMPLICATION_LOOKUP: SqlQueryTemplate = {
  postgresql: `SELECT labour_complication_id, name FROM labour_complication ORDER BY name`,
  mysql: `SELECT labour_complication_id, name FROM labour_complication ORDER BY name`,
};

// Lookup: discharge-type codes
export const DCH_TYPE_LOOKUP: SqlQueryTemplate = {
  postgresql: `SELECT dchtype, name FROM dchtype ORDER BY name`,
  mysql: `SELECT dchtype, name FROM dchtype ORDER BY name`,
};

// Lookup: discharge-status codes
export const DCH_STTS_LOOKUP: SqlQueryTemplate = {
  postgresql: `SELECT dchstts, name FROM dchstts ORDER BY name`,
  mysql: `SELECT dchstts, name FROM dchstts ORDER BY name`,
};
