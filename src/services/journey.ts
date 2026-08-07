// T006: Journey lifecycle service — create, transition, and query maternal journeys
import { randomUUID } from 'crypto';
import type { DatabaseAdapter } from '@/db/adapter';
import { CareStage, AncRiskLevel } from '@/types/domain';
import type { MaternalJourney } from '@/types/domain';

export interface CreateJourneyInput {
  hospitalId: string;
  hn: string;
  personAncId: number | null;
  name: string;
  cid: string;
  cidHash: string;
  age: number;
  gravida: number;
  para: number;
  lmp: string | null;
  edc: string | null;
  ancRiskLevel: AncRiskLevel;
}

export async function createJourney(
  db: DatabaseAdapter,
  input: CreateJourneyInput,
): Promise<MaternalJourney> {
  const id = randomUUID();
  const now = new Date().toISOString();

  await db.execute(
    `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, person_anc_id, name, cid, cid_hash, age, gravida, para, lmp, edc, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    [
      id,
      input.hospitalId,
      input.hospitalId,
      input.hn,
      input.personAncId,
      input.name,
      input.cid,
      input.cidHash,
      input.age,
      input.gravida,
      input.para,
      input.lmp,
      input.edc,
      CareStage.PREGNANCY,
      input.ancRiskLevel,
      now,
      now,
      now,
      now,
      now,
    ],
  );

  return {
    id,
    hospitalId: input.hospitalId,
    currentHospitalId: input.hospitalId,
    hn: input.hn,
    personAncId: input.personAncId,
    name: input.name,
    cid: input.cid,
    cidHash: input.cidHash,
    age: input.age,
    gravida: input.gravida,
    para: input.para,
    lmp: input.lmp,
    edc: input.edc,
    careStage: CareStage.PREGNANCY,
    ancRiskLevel: input.ancRiskLevel,
    ancVisitCount: 0,
    lastAncDate: null,
    gaWeeks: null,
    changwatCode: null,
    amphurCode: null,
    tambonCode: null,
    registeredAt: new Date(now),
    stageChangedAt: new Date(now),
    syncedAt: new Date(now),
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
}

// Primary lookup: find the most recent journey by CID hash (cross-hospital)
// CID is the true patient identifier — same person, same CID, any hospital
// Returns the latest journey regardless of stage — one CID can have multiple
// pregnancies, so we always return the most recent one. The caller decides
// whether to create a new journey (e.g., when pregNo/lmp indicate a new pregnancy).
export async function getActiveJourneyByCid(
  db: DatabaseAdapter,
  cidHash: string,
): Promise<MaternalJourney | null> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM maternal_journeys WHERE cid_hash = ? ORDER BY created_at DESC LIMIT 1`,
    [cidHash],
  );
  if (rows.length === 0) return null;
  return mapRowToJourney(rows[0]);
}

// Fallback lookup: find by HN + hospital (for legacy/HOSxP data without CID)
export async function getJourneyByHn(
  db: DatabaseAdapter,
  hn: string,
  hospitalId: string,
): Promise<MaternalJourney | null> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM maternal_journeys WHERE hn = ? AND hospital_id = ? AND care_stage IN ('PREGNANCY', 'LABOR') ORDER BY created_at DESC LIMIT 1`,
    [hn, hospitalId],
  );
  if (rows.length === 0) return null;
  return mapRowToJourney(rows[0]);
}

export async function transitionToLabor(db: DatabaseAdapter, journeyId: string): Promise<void> {
  const now = new Date().toISOString();
  // Idempotent: linkJourneyToLabor runs on every sync cycle (~30 s); avoid
  // re-stamping stage_changed_at on a journey already in LABOR (same
  // dashboard-KPI rationale as transitionToDelivered below).
  await db.execute(
    `UPDATE maternal_journeys SET care_stage = ?, stage_changed_at = ?, updated_at = ?
      WHERE id = ? AND care_stage <> ?`,
    [CareStage.LABOR, now, now, journeyId, CareStage.LABOR],
  );
}

export async function transitionToDelivered(db: DatabaseAdapter, journeyId: string): Promise<void> {
  const now = new Date().toISOString();
  // Idempotent: the newborn sync calls this on every birth attach (including
  // backfilled historical births). Re-stamping stage_changed_at on an
  // already-DELIVERED journey pushed months-old deliveries into the
  // "delivered this month" dashboard KPI.
  await db.execute(
    `UPDATE maternal_journeys SET care_stage = ?, stage_changed_at = ?, updated_at = ?
      WHERE id = ? AND care_stage <> ?`,
    [CareStage.DELIVERED, now, now, journeyId, CareStage.DELIVERED],
  );
}

export interface JourneyFilter {
  stage?: CareStage;
  riskLevel?: AncRiskLevel;
}

export async function getActiveJourneys(
  db: DatabaseAdapter,
  hospitalId: string,
  filter: JourneyFilter = {},
): Promise<MaternalJourney[]> {
  let sql = `SELECT * FROM maternal_journeys WHERE current_hospital_id = ?`;
  const params: unknown[] = [hospitalId];

  if (filter.stage) {
    sql += ` AND care_stage = ?`;
    params.push(filter.stage);
  }
  if (filter.riskLevel) {
    sql += ` AND anc_risk_level = ?`;
    params.push(filter.riskLevel);
  }

  sql += ` ORDER BY created_at DESC`;

  const rows = await db.query<Record<string, unknown>>(sql, params);
  return rows.map(mapRowToJourney);
}

export async function getJourneyById(
  db: DatabaseAdapter,
  journeyId: string,
): Promise<MaternalJourney | null> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM maternal_journeys WHERE id = ?`,
    [journeyId],
  );
  if (rows.length === 0) return null;
  return mapRowToJourney(rows[0]);
}

function mapRowToJourney(row: Record<string, unknown>): MaternalJourney {
  return {
    id: row.id as string,
    hospitalId: row.hospital_id as string,
    currentHospitalId: row.current_hospital_id as string,
    hn: row.hn as string,
    personAncId: row.person_anc_id as number | null,
    name: row.name as string,
    cid: (row.cid as string) ?? '',
    cidHash: (row.cid_hash as string) ?? '',
    age: row.age as number,
    gravida: row.gravida as number,
    para: row.para as number,
    lmp: row.lmp as string | null,
    edc: row.edc as string | null,
    careStage: row.care_stage as CareStage,
    ancRiskLevel: row.anc_risk_level as AncRiskLevel,
    ancVisitCount: row.anc_visit_count as number,
    lastAncDate: row.last_anc_date as string | null,
    gaWeeks: row.ga_weeks as number | null,
    changwatCode: row.changwat_code as string | null,
    amphurCode: row.amphur_code as string | null,
    tambonCode: row.tambon_code as string | null,
    registeredAt: new Date(row.registered_at as string),
    stageChangedAt: new Date(row.stage_changed_at as string),
    syncedAt: new Date(row.synced_at as string),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}
