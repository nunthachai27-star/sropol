// src/types/maternity-ward.ts
export interface MaternityWard { ward: string; name: string; real_bedcount: number | null; }

export interface BedSlot {
  bedno: string;
  roomno: string;
  bed_order: number | null;
  bed_lock: string | null;          // 'Y' | 'N' | null
  bed_status_type_id: number | null;
  room_name: string | null;
  room_display_number: number | null;
}

export interface BedOccupancy {
  an: string;
  hn: string;
  regdate: string;
  regtime: string | null;
  ward: string;
  bedno: string;
  roomno: string;
  bedtype: string | null;
  roomname: string | null;
  pname: string | null;
  fname: string | null;
  lname: string | null;
  birthday: string | null;
  gravida: number | null;
  ga: number | null;
  incharge_doctor_name: string | null;
  last_observation_at: string | null;
  last_cervix_cm: number | null;
}

export interface PartographRow {
  ipt_labour_partograph_id: number;
  ipt_labour_id: number;
  an: string;
  observe_datetime: string;
  hour_no: number | null;
  fetal_heart_rate: number | null;
  amniotic_fluid: string | null;
  moulding: string | null;
  cervical_dilation_cm: number | null;
  descent_of_head: string | null;
  contraction_per_10min: number | null;
  contraction_duration_sec: number | null;
  contraction_strength: string | null;
  oxytocin_uml: number | null;
  oxytocin_drops_min: number | null;
  drugs_iv_fluids: string | null;
  pulse: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  temperature: number | null;
  urine_volume_ml: number | null;
  urine_protein: string | null;
  urine_glucose: string | null;
  urine_acetone: string | null;
  note: string | null;
}

export interface VitalSignRow {
  // Task 42: ipt_pregnancy_vital_sign has no native single-column PK in HOSxP.
  // For CRUD we mint a synthetic surrogate via get_serialnumber(...). Older
  // historical rows fetched via getPatientVitalSigns may not carry it; in that
  // case the CRUD UI keys on array index and edits flow through the upsert
  // service which mints a fresh PK. See upsertVitalSign for details.
  ipt_pregnancy_vital_sign_id?: number;
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
  // Note: ipt_pregnancy_vital_sign has 23 columns; the 14 above are the most-used.
  // The application can spread additional fields via index signature if needed.
  [key: string]: unknown;
}

export interface LabourRecord {
  ipt_labour_id: number;
  an: string;
  g: number | null;
  ga: number | null;
  anc_count: number | null;
  [key: string]: unknown;
}

export interface PregnancyRecord {
  an: string;
  preg_number: number | null;
  ga: number | null;
  anc_complete: string | null;
  labor_date: string | null;
  [key: string]: unknown;
}

export interface LaborRecord {
  laborid: number;
  an: string;
  mother_gvalue: number | null;
  mother_hct: number | null;
  mother_aging: number | null;
  [key: string]: unknown;
}

export interface LabourMedRow {
  labour_medication_id: number;
  an: string;
  icode: string;
  qty: number | null;
  doctor_code: string | null;
  drugusage: string | null;
  medication_note_text: string | null;
}

export interface StageMedRow {
  labour_stage_medication_id: number;
  an: string;
  icode: string;
  med_number: number | null;
  medication_result_text: string | null;
  qty: number | null;
  medication_date: string | null;
  medication_time: string | null;
  staff: string | null;
  medication_note: string | null;
  medication_name?: string;   // joined from s_drugitems
  staff_name?: string;        // joined from opduser
}

export interface ComplicationRow {
  ipt_labour_complication_id: number;
  ipt_labour_id: number;
  labour_complication_id: number | null;
  labour_stage_id: number | null;
  complication_note: string | null;
  complication_name?: string; // joined from labour_complication
}

export interface InfantRow {
  // ipt_newborn fields:
  ipt_newborn_id?: number;
  an: string;
  // ipt_labour_infant fields (joined):
  ipt_labour_infant_id?: number;
  sex: string | null;
  birth_weight: number | null;
  [key: string]: unknown;
}

export interface BedMoveArgs {
  an: string;
  oldWard: string;
  oldBedno: string;
  newWard: string;
  newBedno: string;
  newRoomno: string;
  reason: string;
}

export interface DischargeArgs {
  an: string;
  dchdate: string;   // ISO date
  dchtime: string;   // HH:mm:ss
  dchtype: string;
  dchstts: string;
}
