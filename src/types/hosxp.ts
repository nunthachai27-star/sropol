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
  ipt_labour_infant_id: number;
  ipt_labour_id: number;
  an: string;
  infant_number: number;
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
}

export interface HosxpReferoutRow {
  refer_number: string;
  refer_date: string;
  hn: string;
  refer_hospcode: string;
  icd10: string | null;
  referout_emergency_type_id: number | null;
}
