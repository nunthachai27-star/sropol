// No 'use client' directive — this module is plain TS using fetch and is safe
// to import from both client components and server routes (e.g. the dev smoke
// endpoint that exercises the upsert*() service functions end-to-end).
import {
  executeSql,
  restDelete,
  restInsert,
  restUpdate,
} from '@/lib/bms-browser-client';
import { mintSerial } from '@/lib/bms-serial';
import {
  BED_MOVE_REASONS,
  DRUG_LOOKUP,
  DRUGUSAGE_LOOKUP,
  LABOUR_COMPLICATION_LOOKUP,
  MATERNITY_WARDS,
  PATIENT_COMPLICATIONS_BY_LABOUR_ID,
  PATIENT_INFANTS_BY_AN,
  PATIENT_LABOR_BY_AN,
  PATIENT_LABOUR_BY_AN,
  PATIENT_BED_MOVES_BY_AN,
  PATIENT_LABOUR_MED_BY_AN,
  PATIENT_PARTOGRAPH_BY_AN,
  PATIENT_PREGNANCY_BY_AN,
  PATIENT_NURSE_NOTES_BY_AN,
  PATIENT_STAGE_MED_BY_AN,
  PATIENT_VITAL_SIGNS_BY_AN,
  WARD_BEDS_INVENTORY,
  WARD_BEDS_OCCUPANCY,
  WARD_BEDS_OCCUPANCY_FULL,
  getQuery,
  type DatabaseDialect,
} from '@/config/hosxp-queries';
import type { ConnectionConfig, UserInfo } from '@/types/bms-browser';
import type {
  BedMoveArgs,
  BedMoveRow,
  BedOccupancy,
  BedOccupancyFull,
  BedSlot,
  ComplicationRow,
  DischargeArgs,
  InfantRow,
  LaborRecord,
  LabourMedRow,
  LabourRecord,
  MaternityWard,
  NurseNoteRow,
  PartographRow,
  PregnancyRecord,
  StageMedRow,
  VitalSignRow,
} from '@/types/maternity-ward';

// HOSxP tunnels behind BMS Session API are typically MySQL.
// Until we expose the dialect via the session, default to mysql for the
// browser-side queries. Server-side polling already detects via
// detectDatabaseType(); this client mirror does the same when needed in v2.
const DEFAULT_DIALECT: DatabaseDialect = 'mysql';

export async function listMaternityWards(config: ConnectionConfig): Promise<MaternityWard[]> {
  const sql = getQuery(MATERNITY_WARDS, DEFAULT_DIALECT);
  const r = await executeSql<MaternityWard>(sql, config);
  return r.data;
}

export async function listWardBedsInventory(
  config: ConnectionConfig,
  ward: string,
): Promise<BedSlot[]> {
  const sql = getQuery(WARD_BEDS_INVENTORY, DEFAULT_DIALECT);
  const r = await executeSql<BedSlot>(sql, config, { ward });
  return r.data;
}

export async function listWardBedsOccupancy(
  config: ConnectionConfig,
  ward: string,
): Promise<BedOccupancy[]> {
  const sql = getQuery(WARD_BEDS_OCCUPANCY, DEFAULT_DIALECT);
  const r = await executeSql<BedOccupancy>(sql, config, { ward });
  return r.data;
}

/**
 * Clinical-density variant of {@link listWardBedsOccupancy} backing the v2
 * bed-tile view. Joins the LATEST `ipt_labour_partograph` + LATEST
 * `ipd_nurse_note` per AN so the dense tile renders without per-bed follow-up
 * fetches (which would be 24+ extra queries for a 12-bed ward and break the
 * <2s SQL budget under 200 concurrent users).
 *
 * The query (WARD_BEDS_OCCUPANCY_FULL) and result type (BedOccupancyFull) are
 * a strict superset of the lite variant — the lite hook can keep using the
 * narrower query/type without change.
 */
export async function listWardBedsOccupancyFull(
  config: ConnectionConfig,
  ward: string,
): Promise<BedOccupancyFull[]> {
  const sql = getQuery(WARD_BEDS_OCCUPANCY_FULL, DEFAULT_DIALECT);
  const r = await executeSql<BedOccupancyFull>(sql, config, { ward });
  return r.data;
}

// Task 30: read all partograph observations for a single admission, ordered
// by observe_datetime (ordering happens server-side in PATIENT_PARTOGRAPH_BY_AN).
export async function getPatientPartograph(
  config: ConnectionConfig,
  an: string,
): Promise<PartographRow[]> {
  const sql = getQuery(PATIENT_PARTOGRAPH_BY_AN, DEFAULT_DIALECT);
  const r = await executeSql<PartographRow>(sql, config, { an });
  return r.data;
}

// Task 31: read all pregnancy vital-sign rows for a single admission. Note
// the underlying ipt_pregnancy_vital_sign has no single-column PK, so callers
// must use index-as-key for read-only rendering.
export async function getPatientVitalSigns(
  config: ConnectionConfig,
  an: string,
): Promise<VitalSignRow[]> {
  const sql = getQuery(PATIENT_VITAL_SIGNS_BY_AN, DEFAULT_DIALECT);
  const r = await executeSql<VitalSignRow>(sql, config, { an });
  return r.data;
}

// Task 32: read the single ipt_labour summary row for an admission. Returns
// null when no labour record exists yet (e.g. early admit, or the row was
// deleted upstream).
export async function getPatientLabour(
  config: ConnectionConfig,
  an: string,
): Promise<LabourRecord | null> {
  const sql = getQuery(PATIENT_LABOUR_BY_AN, DEFAULT_DIALECT);
  const r = await executeSql<LabourRecord>(sql, config, { an });
  return r.data[0] ?? null;
}

// Task 32: read the single ipt_pregnancy summary row for an admission.
// Same null semantics as getPatientLabour.
export async function getPatientPregnancy(
  config: ConnectionConfig,
  an: string,
): Promise<PregnancyRecord | null> {
  const sql = getQuery(PATIENT_PREGNANCY_BY_AN, DEFAULT_DIALECT);
  const r = await executeSql<PregnancyRecord>(sql, config, { an });
  return r.data[0] ?? null;
}

// Task 33: read the single legacy `labor` (note: BMS spelling is American)
// row for an admission. Distinct from ipt_labour: the labor table holds the
// delivery-room outcome whereas ipt_labour holds the admission-time summary.
export async function getPatientLabor(
  config: ConnectionConfig,
  an: string,
): Promise<LaborRecord | null> {
  const sql = getQuery(PATIENT_LABOR_BY_AN, DEFAULT_DIALECT);
  const r = await executeSql<LaborRecord>(sql, config, { an });
  return r.data[0] ?? null;
}

// Task 34: read all free-text labour-medication rows for an admission. The
// underlying labour_medication table has a labour_medication_id PK, so the
// caller can use it directly as the React key (unlike vital-signs in Task 31).
export async function getPatientLabourMedications(
  config: ConnectionConfig,
  an: string,
): Promise<LabourMedRow[]> {
  const sql = getQuery(PATIENT_LABOUR_MED_BY_AN, DEFAULT_DIALECT);
  const r = await executeSql<LabourMedRow>(sql, config, { an });
  return r.data;
}

// Task 35: read delivery-room (stage) medication rows for an admission.
// PATIENT_STAGE_MED_BY_AN joins s_drugitems server-side for medication_name
// (the second JOIN to opduser was dropped — BMS Validation rejected it).
// Sorting by (medication_date, medication_time) is done CLIENT-SIDE here
// since the BMS validator also rejects ORDER BY in this query shape.
export async function getPatientStageMedications(
  config: ConnectionConfig,
  an: string,
): Promise<StageMedRow[]> {
  const sql = getQuery(PATIENT_STAGE_MED_BY_AN, DEFAULT_DIALECT);
  const r = await executeSql<StageMedRow>(sql, config, { an });
  // Chronological ascending — older entries at top, newest at bottom.
  // Null dates/times sort last (typical Thai chart convention is
  // "incomplete records appear after the in-order ones").
  return [...r.data].sort((a, b) => {
    const ka = `${a.medication_date ?? '9999-99-99'} ${a.medication_time ?? '99:99:99'}`;
    const kb = `${b.medication_date ?? '9999-99-99'} ${b.medication_time ?? '99:99:99'}`;
    return ka.localeCompare(kb);
  });
}

// Task 36: read labour complications for a given ipt_labour_id (NOT an — the
// underlying ipt_labour_complication table foreign-keys on ipt_labour_id).
// Callers must first resolve the labour record via getPatientLabour.
export async function getPatientComplications(
  config: ConnectionConfig,
  iptLabourId: number,
): Promise<ComplicationRow[]> {
  const sql = getQuery(PATIENT_COMPLICATIONS_BY_LABOUR_ID, DEFAULT_DIALECT);
  const r = await executeSql<ComplicationRow>(sql, config, { ipt_labour_id: iptLabourId });
  return r.data;
}

// Bed-move history for a single admission. Powers the BedTab timeline.
// Sorted client-side (BMS validator rejects ORDER BY in this tunnel).
export async function getPatientBedMoves(
  config: ConnectionConfig,
  an: string,
): Promise<BedMoveRow[]> {
  const sql = getQuery(PATIENT_BED_MOVES_BY_AN, DEFAULT_DIALECT);
  const r = await executeSql<BedMoveRow>(sql, config, { an });
  // Newest first by (movedate, movetime). Treat null as oldest so legacy
  // rows without a timestamp drop to the bottom rather than fight for the
  // top of the list.
  return [...r.data].sort((a, b) => {
    const ka = `${a.movedate ?? ''} ${a.movetime ?? ''}`;
    const kb = `${b.movedate ?? ''} ${b.movetime ?? ''}`;
    return kb.localeCompare(ka);
  });
}

// Task 37: read newborn + ipt_labour_infant join for an admission. The
// underlying join uses ipt_newborn LEFT JOIN ipt_labour_infant on .an, so a
// stillbirth (no infant row) still surfaces the newborn record.
export async function getPatientInfants(
  config: ConnectionConfig,
  an: string,
): Promise<InfantRow[]> {
  const sql = getQuery(PATIENT_INFANTS_BY_AN, DEFAULT_DIALECT);
  const r = await executeSql<InfantRow>(sql, config, { an });
  return r.data;
}

// ─── Task 41: shared CRUD helpers (canonical pattern reused by Tasks 42–50) ───

interface AuditPayload {
  entity: string;
  op: string;
  resourceId: string;
  hcode: string;
  staff?: string;
  fieldsTouched?: string[];
}

/**
 * Fire-and-forget audit POST to /api/hospital/audit-log.
 * Never throws — the audit sink is best-effort by design (see route handler).
 * Intentionally NOT exported: every CRUD service call site must funnel through
 * upsert/delete so the audit trail stays uniform.
 */
function fireAudit(payload: AuditPayload): void {
  void fetch('/api/hospital/audit-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}

// mintSerial moved to '@/lib/bms-serial' — imported at the top.

// Task 41: insert-or-update a single partograph row. Insert path mints a fresh
// PK via get_serialnumber; update path strips the PK from the body since BMS
// /api/rest/{table}/{id} carries it in the URL.
export async function upsertPartograph(
  config: ConnectionConfig,
  userInfo: UserInfo,
  an: string,
  row: Partial<PartographRow>,
  hcode: string,
): Promise<PartographRow> {
  const isNew = row.ipt_labour_partograph_id === undefined;
  if (isNew) {
    const id = await mintSerial(config, 'ipt_labour_partograph', 'ipt_labour_partograph_id');
    const payload = { ...row, ipt_labour_partograph_id: id, an };
    await restInsert('ipt_labour_partograph', payload, config);
    fireAudit({
      entity: 'ipt_labour_partograph',
      op: 'insert',
      resourceId: String(id),
      hcode,
      staff: userInfo.loginname,
    });
    return payload as PartographRow;
  }
  const { ipt_labour_partograph_id, ...fields } = row;
  await restUpdate(
    'ipt_labour_partograph',
    String(ipt_labour_partograph_id),
    fields,
    config,
  );
  fireAudit({
    entity: 'ipt_labour_partograph',
    op: 'update',
    resourceId: String(ipt_labour_partograph_id),
    hcode,
    staff: userInfo.loginname,
    fieldsTouched: Object.keys(fields),
  });
  return row as PartographRow;
}

// Task 41: delete a partograph row by PK and emit an audit entry.
export async function deletePartograph(
  config: ConnectionConfig,
  userInfo: UserInfo,
  id: number,
  hcode: string,
): Promise<void> {
  await restDelete('ipt_labour_partograph', id, config);
  fireAudit({
    entity: 'ipt_labour_partograph',
    op: 'delete',
    resourceId: String(id),
    hcode,
    staff: userInfo.loginname,
  });
}

// ─── Task 42: vital signs CRUD ─────────────────────────────────────────────
// LIMITATION: ipt_pregnancy_vital_sign has no native single-column PK in HOSxP.
// We mint a surrogate via get_serialnumber('ipt_pregnancy_vital_sign_id') for
// inserts; on update we trust the caller to pass back the surrogate observed at
// read time. If the row was inserted by an external system without this column
// populated, the update path will fail — future cleanup is to switch to a
// composite (an, hr_time) UPSERT once BMS exposes one. Document this on the
// row type as well so callers don't assume a stable historical PK.
export async function upsertVitalSign(
  config: ConnectionConfig,
  userInfo: UserInfo,
  an: string,
  row: Partial<VitalSignRow>,
  hcode: string,
): Promise<VitalSignRow> {
  const isNew = row.ipt_pregnancy_vital_sign_id === undefined;
  if (isNew) {
    const id = await mintSerial(config, 'ipt_pregnancy_vital_sign', 'ipt_pregnancy_vital_sign_id');
    const payload = { ...row, ipt_pregnancy_vital_sign_id: id, an };
    await restInsert('ipt_pregnancy_vital_sign', payload, config);
    fireAudit({
      entity: 'ipt_pregnancy_vital_sign',
      op: 'insert',
      resourceId: String(id),
      hcode,
      staff: userInfo.loginname,
    });
    return payload as VitalSignRow;
  }
  const { ipt_pregnancy_vital_sign_id, ...fields } = row;
  await restUpdate(
    'ipt_pregnancy_vital_sign',
    String(ipt_pregnancy_vital_sign_id),
    fields,
    config,
  );
  fireAudit({
    entity: 'ipt_pregnancy_vital_sign',
    op: 'update',
    resourceId: String(ipt_pregnancy_vital_sign_id),
    hcode,
    staff: userInfo.loginname,
    fieldsTouched: Object.keys(fields),
  });
  return row as VitalSignRow;
}

export async function deleteVitalSign(
  config: ConnectionConfig,
  userInfo: UserInfo,
  id: number,
  hcode: string,
): Promise<void> {
  await restDelete('ipt_pregnancy_vital_sign', id, config);
  fireAudit({
    entity: 'ipt_pregnancy_vital_sign',
    op: 'delete',
    resourceId: String(id),
    hcode,
    staff: userInfo.loginname,
  });
}

// ─── IPD nurse-note CRUD ───────────────────────────────────────────────────
// Comprehensive nurse-note chart (ipd_nurse_note, 70+ columns). Port of
// HOSxPIPDPatientAdmitNurseNoteEntryForm. PK is ipd_nurse_note_id and
// is auto-minted via get_serialnumber on insert.
export async function getPatientNurseNotes(
  config: ConnectionConfig,
  an: string,
): Promise<NurseNoteRow[]> {
  const sql = getQuery(PATIENT_NURSE_NOTES_BY_AN, DEFAULT_DIALECT);
  const r = await executeSql<NurseNoteRow>(sql, config, { an });
  return r.data;
}

export async function upsertNurseNote(
  config: ConnectionConfig,
  userInfo: UserInfo,
  an: string,
  row: Partial<NurseNoteRow>,
  hcode: string,
): Promise<NurseNoteRow> {
  const isNew = row.nurse_note_id === undefined;
  if (isNew) {
    const id = await mintSerial(config, 'ipd_nurse_note', 'nurse_note_id');
    const payload = { ...row, nurse_note_id: id, an };
    await restInsert('ipd_nurse_note', payload, config);
    fireAudit({
      entity: 'ipd_nurse_note',
      op: 'insert',
      resourceId: String(id),
      hcode,
      staff: userInfo.loginname,
    });
    return payload as NurseNoteRow;
  }
  const { nurse_note_id, ...fields } = row;
  await restUpdate('ipd_nurse_note', String(nurse_note_id), fields, config);
  fireAudit({
    entity: 'ipd_nurse_note',
    op: 'update',
    resourceId: String(nurse_note_id),
    hcode,
    staff: userInfo.loginname,
    fieldsTouched: Object.keys(fields),
  });
  return row as NurseNoteRow;
}

export async function deleteNurseNote(
  config: ConnectionConfig,
  userInfo: UserInfo,
  id: number,
  hcode: string,
): Promise<void> {
  await restDelete('ipd_nurse_note', id, config);
  fireAudit({
    entity: 'ipd_nurse_note',
    op: 'delete',
    resourceId: String(id),
    hcode,
    staff: userInfo.loginname,
  });
}

// ─── Task 43: pregnancy + labour upsert (1:1 records keyed by AN) ──────────
// Both ipt_pregnancy and ipt_labour are 1:1 with the admission. AN is the
// natural key, so the BMS REST endpoint accepts it as the resource identifier.
//
// **INSERT-or-UPDATE** — the original Task 43 port assumed HOSxP creates these
// rows at admit time and only ever did restUpdate, but the live HOSxP install
// confirmed that's NOT always true (esp. for admissions that didn't enter via
// the maternity workflow). The Delphi precare entry frame uses
// "auto-INSERT with append; otherwise EDIT mode" — replicating that here:
// caller passes `exists` (derived from whether the SWR fetch returned a row)
// and we route to the right verb.
export async function upsertPregnancy(
  config: ConnectionConfig,
  userInfo: UserInfo,
  an: string,
  fields: Partial<PregnancyRecord>,
  hcode: string,
  exists = true,
): Promise<void> {
  if (exists) {
    await restUpdate('ipt_pregnancy', an, fields as Record<string, unknown>, config);
  } else {
    await restInsert('ipt_pregnancy', { an, ...fields } as Record<string, unknown>, config);
  }
  fireAudit({
    entity: 'ipt_pregnancy',
    op: exists ? 'update' : 'insert',
    resourceId: an,
    hcode,
    staff: userInfo.loginname,
    fieldsTouched: Object.keys(fields),
  });
}

export async function upsertLabour(
  config: ConnectionConfig,
  userInfo: UserInfo,
  an: string,
  fields: Partial<LabourRecord>,
  hcode: string,
  exists = true,
): Promise<void> {
  // ipt_labour PK = ipt_labour_id (int). The BMS REST endpoint /api/rest/{table}/{id}
  // requires the surrogate PK in the URL — passing AN here surfaces as
  // "Record not found". The caller must include fields.ipt_labour_id on the
  // update path (typically forwarded from the read-side getPatientLabour result).
  const { ipt_labour_id, ...body } = fields as Partial<LabourRecord> & {
    ipt_labour_id?: number;
  };
  if (exists) {
    if (ipt_labour_id === undefined) {
      throw new Error('upsertLabour: update path requires fields.ipt_labour_id');
    }
    await restUpdate(
      'ipt_labour',
      String(ipt_labour_id),
      body as Record<string, unknown>,
      config,
    );
  } else {
    // ipt_labour_id is the PRI key (auto-increment in MySQL but the BMS
    // REST endpoint won't auto-fill it — sending the body without an id
    // makes the server default to 0 and collide with the existing id=0
    // row, surfacing as #23000 Duplicate entry '0' for key 'PRIMARY'.
    // Mint a fresh serial via get_serialnumber() — same pattern every
    // other insert in this service uses (partograph, vital-sign, etc.).
    const id = await mintSerial(config, 'ipt_labour', 'ipt_labour_id');
    await restInsert(
      'ipt_labour',
      { ipt_labour_id: id, an, ...body } as Record<string, unknown>,
      config,
    );
  }
  fireAudit({
    entity: 'ipt_labour',
    op: exists ? 'update' : 'insert',
    resourceId: ipt_labour_id !== undefined ? String(ipt_labour_id) : an,
    hcode,
    staff: userInfo.loginname,
    fieldsTouched: Object.keys(body),
  });
}

// ─── Task 44: legacy `labor` table upsert (delivery-room outcome) ──────────
// Mirrors upsertLabour but writes to the legacy `labor` table (American spelling).
// One row per AN; AN acts as the BMS REST resource id. INSERT-or-UPDATE
// dispatch via the `exists` parameter — same pattern as upsertLabour.
export async function upsertLabor(
  config: ConnectionConfig,
  userInfo: UserInfo,
  an: string,
  fields: Partial<LaborRecord>,
  hcode: string,
  exists = true,
): Promise<void> {
  // labor PK = laborid (int). Same constraint as upsertLabour above —
  // BMS REST /api/rest/{table}/{id} requires the surrogate PK in the URL.
  const { laborid, ...body } = fields as Partial<LaborRecord> & {
    laborid?: number;
  };
  if (exists) {
    if (laborid === undefined) {
      throw new Error('upsertLabor: update path requires fields.laborid');
    }
    await restUpdate(
      'labor',
      String(laborid),
      body as Record<string, unknown>,
      config,
    );
  } else {
    // labor.laborid is PRI; mint a fresh serial before insert (same
    // duplicate-PK guard as upsertLabour above).
    const id = await mintSerial(config, 'labor', 'laborid');
    await restInsert(
      'labor',
      { laborid: id, an, ...body } as Record<string, unknown>,
      config,
    );
  }
  fireAudit({
    entity: 'labor',
    op: exists ? 'update' : 'insert',
    resourceId: laborid !== undefined ? String(laborid) : an,
    hcode,
    staff: userInfo.loginname,
    fieldsTouched: Object.keys(body),
  });
}

// ─── Task 45: labour_medication CRUD ───────────────────────────────────────
export async function upsertLabourMedication(
  config: ConnectionConfig,
  userInfo: UserInfo,
  an: string,
  row: Partial<LabourMedRow>,
  hcode: string,
): Promise<LabourMedRow> {
  const isNew = row.labour_medication_id === undefined;
  if (isNew) {
    const id = await mintSerial(config, 'labour_medication', 'labour_medication_id');
    const payload = { ...row, labour_medication_id: id, an };
    await restInsert('labour_medication', payload, config);
    fireAudit({
      entity: 'labour_medication',
      op: 'insert',
      resourceId: String(id),
      hcode,
      staff: userInfo.loginname,
    });
    return payload as LabourMedRow;
  }
  const { labour_medication_id, ...fields } = row;
  await restUpdate('labour_medication', String(labour_medication_id), fields, config);
  fireAudit({
    entity: 'labour_medication',
    op: 'update',
    resourceId: String(labour_medication_id),
    hcode,
    staff: userInfo.loginname,
    fieldsTouched: Object.keys(fields),
  });
  return row as LabourMedRow;
}

export async function deleteLabourMedication(
  config: ConnectionConfig,
  userInfo: UserInfo,
  id: number,
  hcode: string,
): Promise<void> {
  await restDelete('labour_medication', id, config);
  fireAudit({
    entity: 'labour_medication',
    op: 'delete',
    resourceId: String(id),
    hcode,
    staff: userInfo.loginname,
  });
}

// ─── Task 46: labour_stage_medication CRUD ─────────────────────────────────
// Although the underlying schema marks labour_stage_medication_id as auto-
// increment, the BMS REST endpoint expects the PK in the body, so we mint via
// get_serialnumber for safety and consistency with the other tabs.
export async function upsertStageMedication(
  config: ConnectionConfig,
  userInfo: UserInfo,
  an: string,
  row: Partial<StageMedRow>,
  hcode: string,
): Promise<StageMedRow> {
  const isNew = row.labour_stage_medication_id === undefined;
  if (isNew) {
    const id = await mintSerial(config, 'labour_stage_medication', 'labour_stage_medication_id');
    const payload = { ...row, labour_stage_medication_id: id, an };
    await restInsert('labour_stage_medication', payload, config);
    fireAudit({
      entity: 'labour_stage_medication',
      op: 'insert',
      resourceId: String(id),
      hcode,
      staff: userInfo.loginname,
    });
    return payload as StageMedRow;
  }
  const { labour_stage_medication_id, ...fields } = row;
  await restUpdate(
    'labour_stage_medication',
    String(labour_stage_medication_id),
    fields,
    config,
  );
  fireAudit({
    entity: 'labour_stage_medication',
    op: 'update',
    resourceId: String(labour_stage_medication_id),
    hcode,
    staff: userInfo.loginname,
    fieldsTouched: Object.keys(fields),
  });
  return row as StageMedRow;
}

export async function deleteStageMedication(
  config: ConnectionConfig,
  userInfo: UserInfo,
  id: number,
  hcode: string,
): Promise<void> {
  await restDelete('labour_stage_medication', id, config);
  fireAudit({
    entity: 'labour_stage_medication',
    op: 'delete',
    resourceId: String(id),
    hcode,
    staff: userInfo.loginname,
  });
}

// ─── Task 47: ipt_labour_complication CRUD ──────────────────────────────────
// Note: this CRUD is keyed by ipt_labour_id, not by an, because the underlying
// table FKs on ipt_labour_id. Callers (the ComplicationsTab) must first resolve
// the labour record via getPatientLabour(an) and pass through ipt_labour_id.
export async function upsertComplication(
  config: ConnectionConfig,
  userInfo: UserInfo,
  iptLabourId: number,
  row: Partial<ComplicationRow>,
  hcode: string,
): Promise<ComplicationRow> {
  const isNew = row.ipt_labour_complication_id === undefined;
  if (isNew) {
    const id = await mintSerial(config, 'ipt_labour_complication', 'ipt_labour_complication_id');
    const payload = { ...row, ipt_labour_complication_id: id, ipt_labour_id: iptLabourId };
    await restInsert('ipt_labour_complication', payload, config);
    fireAudit({
      entity: 'ipt_labour_complication',
      op: 'insert',
      resourceId: String(id),
      hcode,
      staff: userInfo.loginname,
    });
    return payload as ComplicationRow;
  }
  const { ipt_labour_complication_id, ...fields } = row;
  await restUpdate(
    'ipt_labour_complication',
    String(ipt_labour_complication_id),
    fields,
    config,
  );
  fireAudit({
    entity: 'ipt_labour_complication',
    op: 'update',
    resourceId: String(ipt_labour_complication_id),
    hcode,
    staff: userInfo.loginname,
    fieldsTouched: Object.keys(fields),
  });
  return row as ComplicationRow;
}

export async function deleteComplication(
  config: ConnectionConfig,
  userInfo: UserInfo,
  id: number,
  hcode: string,
): Promise<void> {
  await restDelete('ipt_labour_complication', id, config);
  fireAudit({
    entity: 'ipt_labour_complication',
    op: 'delete',
    resourceId: String(id),
    hcode,
    staff: userInfo.loginname,
  });
}

// ─── Task 48: ipt_newborn + ipt_labour_infant CRUD (composite write) ───────
// Two-table write: each infant has a parent ipt_newborn row and a child
// ipt_labour_infant row. For v1 the same fields (sex, birth_weight) are mirrored
// to both tables on save — simplifies the UI without sacrificing correctness for
// the minimal field set. Future versions can split fields once we wire a
// dedicated infant form. Delete tears down child first, then parent (FK order).
export async function upsertNewborn(
  config: ConnectionConfig,
  userInfo: UserInfo,
  an: string,
  row: Partial<InfantRow>,
  hcode: string,
): Promise<InfantRow> {
  const isNew = row.ipt_newborn_id === undefined;
  if (isNew) {
    const id = await mintSerial(config, 'ipt_newborn', 'ipt_newborn_id');
    const payload = { ...row, ipt_newborn_id: id, an };
    await restInsert('ipt_newborn', payload, config);
    fireAudit({
      entity: 'ipt_newborn',
      op: 'insert',
      resourceId: String(id),
      hcode,
      staff: userInfo.loginname,
    });
    return payload as InfantRow;
  }
  const { ipt_newborn_id, ipt_labour_infant_id: _drop, ...fields } = row;
  void _drop;
  await restUpdate('ipt_newborn', String(ipt_newborn_id), fields, config);
  fireAudit({
    entity: 'ipt_newborn',
    op: 'update',
    resourceId: String(ipt_newborn_id),
    hcode,
    staff: userInfo.loginname,
    fieldsTouched: Object.keys(fields),
  });
  return row as InfantRow;
}

export async function upsertLabourInfant(
  config: ConnectionConfig,
  userInfo: UserInfo,
  an: string,
  row: Partial<InfantRow>,
  hcode: string,
): Promise<InfantRow> {
  const isNew = row.ipt_labour_infant_id === undefined;
  if (isNew) {
    const id = await mintSerial(config, 'ipt_labour_infant', 'ipt_labour_infant_id');
    const payload = { ...row, ipt_labour_infant_id: id, an };
    await restInsert('ipt_labour_infant', payload, config);
    fireAudit({
      entity: 'ipt_labour_infant',
      op: 'insert',
      resourceId: String(id),
      hcode,
      staff: userInfo.loginname,
    });
    return payload as InfantRow;
  }
  const { ipt_labour_infant_id, ipt_newborn_id: _drop, ...fields } = row;
  void _drop;
  await restUpdate('ipt_labour_infant', String(ipt_labour_infant_id), fields, config);
  fireAudit({
    entity: 'ipt_labour_infant',
    op: 'update',
    resourceId: String(ipt_labour_infant_id),
    hcode,
    staff: userInfo.loginname,
    fieldsTouched: Object.keys(fields),
  });
  return row as InfantRow;
}

export async function deleteInfant(
  config: ConnectionConfig,
  userInfo: UserInfo,
  iptNewbornId: number,
  iptLabourInfantId: number | undefined,
  hcode: string,
): Promise<void> {
  // FK order: child first (ipt_labour_infant references ipt_newborn).
  if (iptLabourInfantId !== undefined) {
    await restDelete('ipt_labour_infant', iptLabourInfantId, config);
  }
  await restDelete('ipt_newborn', iptNewbornId, config);
  fireAudit({
    entity: 'ipt_newborn',
    op: 'delete',
    resourceId: String(iptNewbornId),
    hcode,
    staff: userInfo.loginname,
  });
}

// ─── Task 51: getBedMoveReasons + movePatientBed (composite iptadm + iptbedmove) ──
// Lookup the configured reason values from iptbedmove_reason. The list is small
// enough to fetch on demand whenever the modal opens; we don't cache between
// opens because admins may add new reasons via HOSxP without restarting clients.
// ─── Drug master lookup (typeahead for medication entry) ─────────────────
// Wraps DRUG_LOOKUP. The query LIKE-matches `name` against the user's typed
// fragment; we wrap it as `%fragment%` so partial matches at any position
// are returned. Server-side LIMIT 50 caps the result so a tap on a single
// letter doesn't ship the whole drug master.
export async function searchDrugs(
  config: ConnectionConfig,
  query: string,
): Promise<Array<{ icode: string; label: string }>> {
  const trimmed = query.trim();
  if (trimmed.length < 1) return [];
  const sql = getQuery(DRUG_LOOKUP, DEFAULT_DIALECT);
  const r = await executeSql<{ icode: string; label: string }>(
    sql,
    config,
    { q: `%${trimmed}%` },
  );
  return r.data;
}

// Labour-complication lookup — full list (small enough to fetch once and
// filter client-side). Returned shape mirrors LABOUR_COMPLICATION_LOOKUP:
// { labour_complication_id, name } where `name` is the aliased
// `labour_complication_name`.
export async function listLabourComplications(
  config: ConnectionConfig,
): Promise<Array<{ labour_complication_id: number; name: string }>> {
  const sql = getQuery(LABOUR_COMPLICATION_LOOKUP, DEFAULT_DIALECT);
  const r = await executeSql<{ labour_complication_id: number; name: string }>(sql, config);
  return r.data;
}

// Drug-usage typeahead — searches `drugusage.shortlist` (the Thai
// instruction text shown in dropdowns) and `drugusage` (the 7-char code).
// Returns { drugusage, shortlist } — caller decides whether to store the
// shortlist text (typical for labour_medication.drugusage which is free-text
// in this kiosk) or the code (canonical HOSxP storage).
export async function searchDrugUsage(
  config: ConnectionConfig,
  query: string,
): Promise<Array<{ drugusage: string; shortlist: string }>> {
  const trimmed = query.trim();
  if (trimmed.length < 1) return [];
  const sql = getQuery(DRUGUSAGE_LOOKUP, DEFAULT_DIALECT);
  const r = await executeSql<{ drugusage: string; shortlist: string }>(
    sql,
    config,
    { q: `%${trimmed}%` },
  );
  return r.data;
}

export async function getBedMoveReasons(config: ConnectionConfig): Promise<string[]> {
  const sql = getQuery(BED_MOVE_REASONS, DEFAULT_DIALECT);
  const r = await executeSql<{ reason: string }>(sql, config);
  return r.data.map((x) => x.reason);
}

// movePatientBed mirrors the HOSxPDMU flow: PUT iptadm.bedno/roomno first so the
// occupancy view flips immediately, then mint a fresh iptbedmove_id and INSERT
// the audit row. Two-step write — if iptadm succeeds and the iptbedmove insert
// fails the bed will appear moved while the audit history is missing the row.
// The caller's UI surfaces a Thai-language inconsistency message in that case
// (matching the Task 50 dischargePatient pattern).
export async function movePatientBed(
  config: ConnectionConfig,
  userInfo: UserInfo,
  hcode: string,
  args: BedMoveArgs,
): Promise<void> {
  // 1. Update iptadm.bedno + roomno for the patient
  await restUpdate(
    'iptadm',
    args.an,
    { bedno: args.newBedno, roomno: args.newRoomno },
    config,
  );
  // 2. Mint a fresh iptbedmove_id
  const id = await mintSerial(config, 'iptbedmove', 'iptbedmove_id');
  // 3. Insert iptbedmove audit row with split date/time + entry_datetime
  const now = new Date();
  const movedate = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const movetime = now.toISOString().slice(11, 19); // HH:mm:ss
  const entry_datetime = now.toISOString().slice(0, 19).replace('T', ' '); // YYYY-MM-DD HH:mm:ss
  await restInsert(
    'iptbedmove',
    {
      iptbedmove_id: id,
      an: args.an,
      oward: args.oldWard,
      obedno: args.oldBedno,
      nward: args.newWard,
      nbedno: args.newBedno,
      nroomno: args.newRoomno,
      movereason: args.reason,
      staff: userInfo.loginname,
      movedate,
      movetime,
      entry_datetime,
    },
    config,
  );
  // 4. Audit (fire-and-forget) — entity is iptadm because that's the row that
  // actually changed; iptbedmove is the immutable audit trail row.
  fireAudit({
    entity: 'iptadm',
    op: 'bed_move',
    resourceId: args.an,
    hcode,
    fieldsTouched: ['bedno', 'roomno'],
    staff: userInfo.loginname,
  });
}

// ─── Task 50: dischargePatient (composite write to ipt + iptadm) ───────────
// Two-step write: ipt holds the discharge facts (dchdate/dchtime/dchtype/dchstts);
// iptadm tracks bed-out timestamps (outdate/outtime). The ipt write must succeed
// first because the iptadm row is downstream — if ipt fails, we surface the
// error and stop. If ipt succeeds and iptadm fails, the caller's UI surfaces a
// Thai message naming the inconsistency. Audit fires once after both writes.
export async function dischargePatient(
  config: ConnectionConfig,
  userInfo: UserInfo,
  hcode: string,
  args: DischargeArgs,
): Promise<void> {
  await restUpdate(
    'ipt',
    args.an,
    {
      dchdate: args.dchdate,
      dchtime: args.dchtime,
      dchtype: args.dchtype,
      dchstts: args.dchstts,
    },
    config,
  );
  await restUpdate(
    'iptadm',
    args.an,
    { outdate: args.dchdate, outtime: args.dchtime },
    config,
  );
  fireAudit({
    entity: 'ipt',
    op: 'discharge',
    resourceId: args.an,
    hcode,
    staff: userInfo.loginname,
    fieldsTouched: ['dchdate', 'dchtime', 'dchtype', 'dchstts'],
  });
}
