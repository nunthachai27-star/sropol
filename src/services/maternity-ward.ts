'use client';
import { executeSql } from '@/lib/bms-browser-client';
import {
  MATERNITY_WARDS,
  PATIENT_PARTOGRAPH_BY_AN,
  PATIENT_VITAL_SIGNS_BY_AN,
  WARD_BEDS_INVENTORY,
  WARD_BEDS_OCCUPANCY,
  getQuery,
  type DatabaseDialect,
} from '@/config/hosxp-queries';
import type { ConnectionConfig } from '@/types/bms-browser';
import type {
  BedOccupancy,
  BedSlot,
  MaternityWard,
  PartographRow,
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
