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

/**
 * Clinical-density bed occupancy row — superset of {@link BedOccupancy} backed
 * by the WARD_BEDS_OCCUPANCY_FULL query. Adds latest-partograph + latest-
 * nurse-note fields needed for the v2 dense bed tile (vitals, labour progress,
 * contractions, FHR, interventions, last assessment).
 *
 * Vital-sign field SOURCE — see project memory `project_ipd_vital_sign_source`:
 *   * `last_bp_sys/dia, last_temp, last_pulse, last_rr, last_spo2, last_pain` →
 *      `ipd_nurse_note` latest row by (note_date, note_time)
 *   * `last_cervix_cm, last_station, last_fhr, last_contr_*, last_oxytocin_*,
 *      last_iv_fluids, last_amniotic` → `ipt_labour_partograph` latest row
 *
 * Every new field is nullable: a brand-new admission has no nurse-note nor
 * partograph rows, and the bed tile must render gracefully with `—` placeholders.
 */
export interface BedOccupancyFull extends BedOccupancy {
  // Identifier flags (rendered as outlined pills in the bed-tile identity row)
  blood_grp: string | null;        // A / B / AB / O — null when not on file
  allergy_count: number | null;    // 0 → NKDA pill; >0 → ALLERGY pill (red)
  // Latest partograph (labour progress, FHR, contractions, interventions)
  last_station: string | null;
  last_fhr: number | null;
  last_contr_freq: number | null;
  last_contr_duration: number | null;
  last_contr_strength: string | null;
  last_oxytocin_uml: number | null;
  last_oxytocin_drops: number | null;
  last_iv_fluids: string | null;
  last_amniotic: string | null;
  // Latest nurse note (standard IPD vitals + last assessment chronology)
  last_bp_sys: number | null;
  last_bp_dia: number | null;
  last_temp: number | null;
  last_pulse: number | null;
  last_rr: number | null;
  last_spo2: number | null;
  last_pain: number | null;
  last_assess_date: string | null;
  last_assess_time: string | null;
  last_assess_staff: string | null;
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

// `ipd_nurse_note` — the general IPD nurse-note record ported from
// HOSxPIPDPatientAdmitNurseNoteEntryForm (70+ columns). This is the real
// source of the "vital sign chart" that the pulse/temp, RR, BP, fluid I/O
// views in HOSxP read from. PK column is `nurse_note_id` (confirmed against
// the Delphi DoSaveData SQL). `VitalSignRow` above stays in the codebase
// for the pregnancy-specific labor form; everything the maternity drawer's
// Vital Signs tab shows flows through this type instead.
export interface NurseNoteRow {
  nurse_note_id?: number;
  an: string;
  note_date: string | null;
  note_time: string | null;
  // Header / classification
  ipd_nurse_note_time_id: number | null;
  ipd_nurse_note_type_id: number | null;
  ipd_nurse_shift_id: number | null;
  ipd_nurse_eval_range_code: string | null;
  doctor_code: string | null;
  ipd_nurse_patient_type_id: number | null;
  operation_started: string | null;
  // Core vitals
  temperature: number | null;
  pulse: number | null;
  heart_rate: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  ibps: number | null;   // invasive BP sys
  ibpd: number | null;   // invasive BP dia
  imap: number | null;   // invasive MAP
  respiratory_rate: number | null;
  // Extended vitals
  spo2_ra: number | null;
  spo2_o2: number | null;
  etco2: number | null;
  cvp: number | null;
  icp: number | null;
  pvc: number | null;
  pain_score: number | null;
  sedation_score: number | null;
  news2_score: number | null;
  news2_score_type_id: number | null;
  sos_score: number | null;
  consciousness_level_type_id: number | null;
  has_hypercapnic_rf: string | null;      // 'Y'/'N'
  has_oxygen_ventilator: string | null;   // 'Y'/'N'
  // Biometric
  weight: number | null;
  height: number | null;
  bmi: number | null;
  bsa: number | null;
  waist: number | null;
  weight_loss: number | null;
  // Physical exam
  lung_text: string | null;
  heart_text: string | null;
  abdomen_text: string | null;
  fetal_heart_text: string | null;
  // Obstetric
  cervical_open_size: number | null;
  eff: number | null;
  station: string | null;
  labour_sac_type_id: number | null;
  labour_amniotic_type_id: number | null;
  // Fluid intake
  fluid_intake_oral: number | null;
  fluid_intake_parenteral: number | null;
  fluid_intake_1: string | null;   fluid_intake_1_int: number | null;
  fluid_intake_2: string | null;   fluid_intake_2_int: number | null;
  fluid_intake_3: string | null;   fluid_intake_3_int: number | null;
  fluid_intake_4: string | null;   fluid_intake_4_int: number | null;
  fluid_intake_medication1: string | null;  fluid_intake_medication1_int: number | null;
  fluid_intake_medication2: string | null;  fluid_intake_medication2_int: number | null;
  fluid_intake_medication3: string | null;  fluid_intake_medication3_int: number | null;
  // Fluid output
  fluid_output_urine: number | null;
  fluid_output_emesis: number | null;
  fluid_output_drainage: number | null;
  fluid_output_drainage_2: number | null;
  fluid_output_drainage_3: number | null;
  fluid_output_drainage_4: number | null;
  fluid_output_aspiration: number | null;
  fluid_blood_loss: number | null;
  // Stool / Urine counts
  urine_qty: number | null;
  urine_qty_unit: string | null;
  stools_qty: number | null;
  stools_qty_unit: string | null;
  // Text blocks
  ipd_nurse_note_diet_text: string | null;
  medication_text: string | null;
  bottom_note_text: string | null;
  note: string | null;
  // Index signature for any additional nurse-note columns the app may need.
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
  /** Drug-usage CODE (FK to drugusage.drugusage, varchar 7). Stored as code,
   *  NEVER as the human-readable description — picking a chip / lookup row
   *  must commit `drugusage` (the code), not `shortlist` (the description). */
  drugusage: string | null;
  medication_note_text: string | null;
  /** Joined from s_drugitems via the PATIENT_LABOUR_MED_BY_AN query —
   *  CONCAT(name, ' ', strength, ' ', units). Null when the icode has no
   *  matching drug master row (rare; usually means a free-text/legacy code). */
  medication_name?: string | null;
  /** Joined from drugusage.shortlist via PATIENT_LABOUR_MED_BY_AN. Null when
   *  the stored drugusage code has no matching master row (legacy data or
   *  the prior bug that stored the description in this column). */
  drugusage_text?: string | null;
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

/** Discharge-related subset of HOSxP `ipt` row. Used by DischargeTab to
 *  hydrate the form on open so a saved draft (confirm_discharge='N')
 *  shows the same values the operator entered before. Mirrors the columns
 *  dischargePatient writes. */
export interface IptDischargeRow {
  an: string;
  hn: string | null;
  regdate: string | null;
  regtime: string | null;
  dchdate: string | null;
  dchtime: string | null;
  dchtype: string | null;
  dchstts: string | null;
  dch_doctor: string | null;
  ipt_spclty: string | null;
  dch_severe_type_id: number | null;
  followup: string | null;
  confirm_discharge: string | null;
  ipt_severe_type_id: number | null;
}

/** Refer-out row (HOSxP `referout` table). Loaded into the ReferOutDialog
 *  when the dialog opens; INSERT-or-UPDATE keyed by referout_id. The full
 *  schema has 70+ columns; we surface the clinically meaningful subset. */
export interface ReferOutRow {
  referout_id: number;
  vn: string;                // = AN for IPD admissions
  hn?: string | null;
  refer_date: string | null;
  refer_time: string | null;
  refer_hospcode: string | null;
  hospcode: string | null;
  spclty: string | null;
  doctor: string | null;
  refer_cause: number | null;
  refer_type: number | null;
  referout_emergency_type_id: number | null;
  pre_diagnosis: string | null;
  pdx: string | null;
  pmh: string | null;
  hpi: string | null;
  lab_text: string | null;
  treatment_text: string | null;
  request_text: string | null;
  ptstatus_text: string | null;
  with_doctor: string | null;
  with_nurse: string | null;
  with_ambulance: string | null;
  car_registration_no: string | null;
  refer_in_province: string | null;
  refer_in_region: string | null;
  [key: string]: unknown;
}

/** Inputs accepted by upsertReferOut. Matches HOSxP refer_out semantics —
 *  vn = AN for IPD; hospcode and refer_hospcode are stored as the same
 *  value (legacy alias the Delphi form keeps in sync). */
export type ReferOutArgs = {
  referout_id?: number;       // present on UPDATE
  an: string;
  hn?: string | null;
} & Partial<Omit<ReferOutRow, 'referout_id' | 'vn' | 'hn'>>;

/** A single row from iptbedmove with old/new ward names resolved via JOIN.
 *  Powers the BedTab move-history timeline. */
export interface BedMoveRow {
  iptbedmove_id: number;
  movedate: string | null;
  movetime: string | null;
  oward: string | null;
  obedno: string | null;
  nward: string | null;
  nbedno: string | null;
  nroomno: string | null;
  movereason: string | null;
  staff: string | null;
  oward_name?: string | null;
  nward_name?: string | null;
}

export interface DischargeArgs {
  an: string;
  dchdate: string;   // ISO date
  dchtime: string;   // HH:mm:ss
  /** dchtype.dchtype code (varchar 2) — '01' With Approval, '02' Against
   *  Advice, '04' By Transfer, '08'/'09' Dead, etc. Resolve via DCHTYPE_LOOKUP. */
  dchtype: string;
  /** dchstts.dchstts code (varchar 2) — '01' Complete Recovery, '04' Normal
   *  Delivery (canonical for maternity LR), '08'/'09' Dead, etc. */
  dchstts: string;
  /** Optional discharging doctor (HOSxP ipt.dch_doctor). Free-text doctor
   *  code or name. */
  dch_doctor?: string | null;
  /** Specialty at discharge (ipt.ipt_spclty → spclty.spclty, varchar 2).
   *  '03' = สูติกรรม (Obstetrics) — canonical for maternity LR. */
  ipt_spclty?: string | null;
  /** Severity at discharge (ipt.dch_severe_type_id → ipt_severe_type, int).
   *  Optional — typical values are 1..4 (ระดับ 1..4). */
  dch_severe_type_id?: number | null;
  /** Followup-needed flag (ipt.followup, char 1 Y/N). */
  followup?: 'Y' | 'N' | null;
  /** ipt.confirm_discharge (char 1 Y/N). User-controlled toggle bound to a
   *  checkbox in the HOSxP form (cxDBCheckBox1, perm-gated by
   *  IPD_CONFIRM_DISCHARGE:EDIT). 'Y' is what flips the patient out of the
   *  active-ward roster — caller decides when to set it; the service no
   *  longer forces it. Caller is also responsible for matching the
   *  Delphi-form behavior when toggled Y→N (see DischargeTab): clear
   *  dchdate/dchtime/dchtype/dchstts/dch_doctor unless the operator opts
   *  out (HOSxP system variable NO_CLEAR_ADMIT_STATE='Y'). */
  confirm_discharge?: 'Y' | 'N' | null;
}
