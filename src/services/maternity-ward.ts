'use client';
import {
  callFunction,
  executeSql,
  restDelete,
  restInsert,
  restUpdate,
} from '@/lib/bms-browser-client';
import {
  MATERNITY_WARDS,
  PATIENT_COMPLICATIONS_BY_LABOUR_ID,
  PATIENT_INFANTS_BY_AN,
  PATIENT_LABOR_BY_AN,
  PATIENT_LABOUR_BY_AN,
  PATIENT_LABOUR_MED_BY_AN,
  PATIENT_PARTOGRAPH_BY_AN,
  PATIENT_PREGNANCY_BY_AN,
  PATIENT_STAGE_MED_BY_AN,
  PATIENT_VITAL_SIGNS_BY_AN,
  WARD_BEDS_INVENTORY,
  WARD_BEDS_OCCUPANCY,
  getQuery,
  type DatabaseDialect,
} from '@/config/hosxp-queries';
import type { ConnectionConfig, UserInfo } from '@/types/bms-browser';
import type {
  BedOccupancy,
  BedSlot,
  ComplicationRow,
  InfantRow,
  LaborRecord,
  LabourMedRow,
  LabourRecord,
  MaternityWard,
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

// Task 35: read delivery-room (stage) medication rows for an admission. Joined
// to s_drugitems / opduser server-side so the result already carries
// medication_name + staff_name; rows are PK'd by labour_stage_medication_id.
export async function getPatientStageMedications(
  config: ConnectionConfig,
  an: string,
): Promise<StageMedRow[]> {
  const sql = getQuery(PATIENT_STAGE_MED_BY_AN, DEFAULT_DIALECT);
  const r = await executeSql<StageMedRow>(sql, config, { an });
  return r.data;
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

/**
 * Mint a fresh primary-key value via BMS get_serialnumber. The id_field
 * parameter is the column name (e.g. 'ipt_labour_partograph_id'); BMS resolves
 * the underlying sequence/table itself.
 */
async function mintSerial(idField: string, config: ConnectionConfig): Promise<number> {
  const r = await callFunction<{ Value: number }>('get_serialnumber', config, {
    id_field: idField,
  });
  return Number(r.Value);
}

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
    const id = await mintSerial('ipt_labour_partograph_id', config);
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
    const id = await mintSerial('ipt_pregnancy_vital_sign_id', config);
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

// ─── Task 43: pregnancy + labour upsert (1:1 records keyed by AN) ──────────
// Both ipt_pregnancy and ipt_labour are 1:1 with the admission, so the AN itself
// acts as the resource identifier on the BMS REST endpoint. No serial mint
// because we never insert a brand-new pregnancy record from this UI — HOSxP
// creates that row at admit time. We only ever update.
export async function upsertPregnancy(
  config: ConnectionConfig,
  userInfo: UserInfo,
  an: string,
  fields: Partial<PregnancyRecord>,
  hcode: string,
): Promise<void> {
  await restUpdate('ipt_pregnancy', an, fields as Record<string, unknown>, config);
  fireAudit({
    entity: 'ipt_pregnancy',
    op: 'update',
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
): Promise<void> {
  await restUpdate('ipt_labour', an, fields as Record<string, unknown>, config);
  fireAudit({
    entity: 'ipt_labour',
    op: 'update',
    resourceId: an,
    hcode,
    staff: userInfo.loginname,
    fieldsTouched: Object.keys(fields),
  });
}
