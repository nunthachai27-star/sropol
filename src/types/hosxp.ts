// T011: HOSxP source row types — matching actual HOSxP column names

export interface HosxpPatientRow {
  hn: string;
  pname: string;
  fname: string;
  lname: string;
  cid: string;
  birthday: string;
  sex: string;
}

// Patient address (joined from patient + thaiaddress)
export interface HosxpPatientAddressRow {
  hn: string;
  chwpart: string | null; // จังหวัด 2-digit
  amppart: string | null; // อำเภอ 2-digit
  tmbpart: string | null; // ตำบล 2-digit
}

export interface HosxpIptRow {
  an: string;
  hn: string;
  regdate: string;
  regtime: string;
  dchdate: string | null;
  dchtime: string | null;
  ward: string;
  admdoctor: string;
}

export interface HosxpPregnancyRow {
  an: string;
  preg_number: number | null;
  ga: number | null;
  labor_date: string | null;
  anc_complete: string | null;
  child_count: number | null;
  deliver_type: number | null;
}

/** Row from IPT_PREGNANCY_DELIVERIES_SINCE — the per-admission delivery
 *  summary (ipt_pregnancy). Fallback source for the newborn sync when a
 *  site fills the IPD pregnancy record but not ipt_labour_infant. */
export interface HosxpIptPregnancyRow {
  an: string;
  mother_hn: string | null;
  mother_cid?: string | null;
  mother_name?: string | null;
  mother_birthday?: string | null;
  labor_date: string | null;
  child_count: number | null;
  dead_child_count: number | null;
  preg_number: number | null;
  ga: number | null;
}

export interface HosxpVitalSignRow {
  an: string;
  hr: number | null;
  bps: number | null;
  bpd: number | null;
  fetal_heart_sound: string | null;
  cervical_open_size: number | null;
  eff: number | null;
  station: string | null;
  hct: number | null;
  height: number | null;
  bw: number | null;
  temperature: number | null;
  rr: number | null;
  ultrasound_result: string | null;
}

export interface HosxpLaborRow {
  laborid: number;
  an: string;
  mother_gvalue: string | null;
  mother_hct: string | null;
  mother_aging: number | null;
  mother_lmp_date: string | null;
  mother_edc_date: string | null;
  labour_startdate: string | null;
  labour_starttime: string | null;
  labour_finishdate: string | null;
  labour_finishtime: string | null;
  placenta_bloodloss: number | null;
  infant_weight: number | null;
  infant_sex: string | null;
}

export interface HosxpAncRow {
  person_anc_id: number;
  person_id: number;
  blood_hct_result: string | null;
  ga: number | null;
  lmp: string | null;
  edc: string | null;
  preg_no: number | null;
  service_count: number | null;
}

export interface HosxpOpdscreenRow {
  hn: string;
  height: number | null;
  weight: number | null;
}

// --- Maternal Journey HOSxP Source Types ---

export interface HosxpPersonAncRow {
  person_anc_id: number;
  person_id: number;
  hn: string;
  pname: string;
  fname: string;
  lname: string;
  cid: string;
  birthday: string;
  preg_no: number;
  lmp: string | null;
  edc: string | null;
  anc_register_date: string;
}

export interface HosxpAncServiceRow {
  person_anc_service_id: number;
  person_anc_id: number;
  service_date: string;
  anc_service_number: number;
  pa_week: number | null;
  pa_day: number | null;
  fundal_height: number | null;
  bw: number | null;
  bps: number | null;
  bpd: number | null;
  height: number | null;
  fetal_heart_rate: number | null;
  baby_position: string | null;
  baby_lead: string | null;
  pass_quality: string | null;
  doctor_code: string | null;
}

export interface HosxpAncRiskRow {
  person_anc_risk_id: number;
  person_anc_id: number;
  anc_risk_id: number;
}

export interface HosxpAncClassifyingRow {
  person_anc_classifying_id: number;
  person_anc_id: number;
  person_anc_classifying_item_id: number;
  check_value: string;
}

export interface HosxpLabourInfantRow {
  /** Mother identity (patient table via ipt join) — lets the sync create
   *  retrospective journeys for pre-registry deliveries. */
  mother_cid?: string | null;
  mother_name?: string | null;
  mother_birthday?: string | null;
  ipt_labour_infant_id: number;
  ipt_labour_id: number;
  an: string;
  /** 1-based birth order within the delivery. NULLABLE in production HOSxP
   *  (hospitals 10998/11008 ship NULL here) while cached_newborns.infant_number
   *  is NOT NULL — the sync layer MUST default missing values before
   *  persisting (defaultMissingInfantNumbers in services/sync/newborn.ts). */
  infant_number: number | null;
  sex: string | null;
  birth_weight: number | null;
  body_length: number | null;
  head_length: number | null;
  temperature: number | null;
  rr: number | null;
  hr: number | null;
  apgar_score_min1: number | null;
  apgar_score_min5: number | null;
  apgar_score_min10: number | null;
  infant_check_ppv: string | null;
  infant_check_et_tube: string | null;
  infant_check_chest_pump: string | null;
  infant_check_oxygen_box: string | null;
  infant_check_narcan: string | null;
  infant_check_feed_milk: string | null;
  infant_check_vitk: string | null;
  infant_check_eyepaste: string | null;
  infant_check_bcg: string | null;
  infant_check_hepb: string | null;
  infant_check_azt: string | null;
  infant_icd10: string | null;
  infant_hn: string | null;
  infant_an: string | null;
  infant_dchstts: string | null;
  birth_date: string | null;
  birth_time: string | null;
  /** Mother's HN via the ipt join — present on LABOUR_INFANTS_SINCE (the
   *  batch/polling variant); resolves journeys for admissions that predate
   *  the cached_patients window. */
  mother_hn?: string | null;
}

export interface HosxpReferoutRow {
  refer_number: string;
  refer_date: string;
  hn: string;
  refer_hospcode: string;
  icd10: string | null;
  referout_emergency_type_id: number | null;
}
