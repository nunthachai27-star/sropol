// T082: Newborn service — birth outcome tracking and neonatal KPIs
import { randomUUID } from 'crypto';
import type { DatabaseAdapter } from '@/db/adapter';
import type { CachedNewborn } from '@/types/domain';
import { decryptSafe } from '@/lib/encryption';
import { bangkokMonthKey, bangkokStartOfMonth } from '@/lib/bangkok-time';
import { NEWBORN_THRESHOLDS } from '@/config/newborn';
import type {
  OutcomeHospitalRow,
  OutcomeTrendPoint,
  OutcomesResponse,
  RecentBirthEntry,
} from '@/types/api';

export interface UpsertNewbornInput {
  journeyId: string;
  infantNumber: number;
  sex?: string;
  birthWeightG?: number;
  bodyLengthCm?: number;
  headCircumCm?: number;
  temperature?: number;
  heartRate?: number;
  respiratoryRate?: number;
  apgar1min?: number;
  apgar5min?: number;
  apgar10min?: number;
  resuscitation: Record<string, boolean>;
  vaccinations: Record<string, boolean>;
  infantIcd10?: string;
  infantHn?: string;
  infantAn?: string;
  dischargeStatus?: string;
  bornAt: string;
}

export async function upsertNewborn(
  db: DatabaseAdapter,
  input: UpsertNewbornInput,
): Promise<CachedNewborn> {
  const now = new Date().toISOString();
  const resuscJson = JSON.stringify(input.resuscitation);
  const vaccJson = JSON.stringify(input.vaccinations);

  // Check if record exists
  const existing = await db.query<Record<string, unknown>>(
    `SELECT id FROM cached_newborns WHERE journey_id = ? AND infant_number = ?`,
    [input.journeyId, input.infantNumber],
  );

  if (existing.length > 0) {
    // Update existing record
    await db.execute(
      `UPDATE cached_newborns SET
        sex = ?, birth_weight_g = ?, body_length_cm = ?, head_circum_cm = ?,
        temperature = ?, heart_rate = ?, respiratory_rate = ?,
        apgar_1min = ?, apgar_5min = ?, apgar_10min = ?,
        resuscitation = ?, vaccinations = ?,
        infant_icd10 = ?, infant_hn = ?, infant_an = ?,
        discharge_status = ?, born_at = ?, synced_at = ?
       WHERE journey_id = ? AND infant_number = ?`,
      [
        input.sex ?? null,
        input.birthWeightG ?? null,
        input.bodyLengthCm ?? null,
        input.headCircumCm ?? null,
        input.temperature ?? null,
        input.heartRate ?? null,
        input.respiratoryRate ?? null,
        input.apgar1min ?? null,
        input.apgar5min ?? null,
        input.apgar10min ?? null,
        resuscJson,
        vaccJson,
        input.infantIcd10 ?? null,
        input.infantHn ?? null,
        input.infantAn ?? null,
        input.dischargeStatus ?? null,
        input.bornAt,
        now,
        input.journeyId,
        input.infantNumber,
      ],
    );
  } else {
    // Insert new record
    const id = randomUUID();
    await db.execute(
      `INSERT INTO cached_newborns (
        id, journey_id, infant_number, sex,
        birth_weight_g, body_length_cm, head_circum_cm,
        temperature, heart_rate, respiratory_rate,
        apgar_1min, apgar_5min, apgar_10min,
        resuscitation, vaccinations,
        infant_icd10, infant_hn, infant_an, discharge_status,
        born_at, synced_at, created_at
       ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
       )`,
      [
        id,
        input.journeyId,
        input.infantNumber,
        input.sex ?? null,
        input.birthWeightG ?? null,
        input.bodyLengthCm ?? null,
        input.headCircumCm ?? null,
        input.temperature ?? null,
        input.heartRate ?? null,
        input.respiratoryRate ?? null,
        input.apgar1min ?? null,
        input.apgar5min ?? null,
        input.apgar10min ?? null,
        resuscJson,
        vaccJson,
        input.infantIcd10 ?? null,
        input.infantHn ?? null,
        input.infantAn ?? null,
        input.dischargeStatus ?? null,
        input.bornAt,
        now,
        now,
      ],
    );
  }

  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM cached_newborns WHERE journey_id = ? AND infant_number = ?`,
    [input.journeyId, input.infantNumber],
  );
  return mapRowToNewborn(rows[0]);
}

export interface NewbornKPIs {
  totalBirths: number;
  lbwCount: number;
  /** Percentage 0–100 of births under 2,500 g. */
  lbwRate: number;
  lowApgarCount: number;
  avgBirthWeightG: number;
}

export interface NewbornKPIFilters {
  hospitalId?: string;
  /** Time window on born_at: 'mtd' (Bangkok month-to-date), '30d', 'all'.
   *  Defaults to 'all' (the historical semantics). */
  range?: string;
}

const DAY_MS = 24 * 3600_000;

function rangeCutoffIso(range: string | undefined, now: Date): string | null {
  switch (range) {
    case 'mtd':
      return bangkokStartOfMonth(now).toISOString();
    case '30d':
      return new Date(now.getTime() - 30 * DAY_MS).toISOString();
    default:
      return null;
  }
}

// Shared FROM/WHERE builder so every outcomes aggregate scopes identically.
function newbornWhere(
  filters: NewbornKPIFilters,
  now: Date,
): { joins: string; clause: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let joins = '';
  if (filters.hospitalId) {
    joins = ` JOIN maternal_journeys mj ON mj.id = cn.journey_id`;
    clauses.push(`mj.current_hospital_id = ?`);
    params.push(filters.hospitalId);
  }
  const cutoff = rangeCutoffIso(filters.range, now);
  if (cutoff) {
    clauses.push(`cn.born_at >= ?`);
    params.push(cutoff);
  }
  return { joins, clause: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

export async function getNewbornKPIs(
  db: DatabaseAdapter,
  filters: NewbornKPIFilters = {},
  now: Date = new Date(),
): Promise<NewbornKPIs> {
  // Low-Apgar uses the 5-minute score (apgar_5min), not the 1-minute score:
  // the 5-min Apgar is the standard neonatal outcome predictor and is what the
  // outcomes UI tile labels ("Apgar 5 นาที < 7"). Both HOSxP sync
  // (services/sync/newborn.ts maps apgar_score_min5) and the infant edit UI
  // populate this column, so the KPI reflects real data.
  const { joins, clause, params } = newbornWhere(filters, now);
  const rows = await db.query<Record<string, unknown>>(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN cn.birth_weight_g < ${NEWBORN_THRESHOLDS.lbwGrams} THEN 1 ELSE 0 END) as lbw,
      SUM(CASE WHEN cn.apgar_5min < ${NEWBORN_THRESHOLDS.apgarLowAt5min} THEN 1 ELSE 0 END) as low_apgar,
      AVG(cn.birth_weight_g) as avg_weight
      FROM cached_newborns cn${joins}${clause}`,
    params,
  );
  const row = rows[0];
  const total = Number(row.total) || 0;
  const lbw = Number(row.lbw) || 0;

  return {
    totalBirths: total,
    lbwCount: lbw,
    lbwRate: total > 0 ? (lbw / total) * 100 : 0,
    lowApgarCount: Number(row.low_apgar) || 0,
    avgBirthWeightG: Math.round(Number(row.avg_weight) || 0),
  };
}

function parseFlags(raw: unknown): Record<string, boolean> {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, boolean>;
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object' && raw !== null) return raw as Record<string, boolean>;
  return {};
}

/**
 * Full /outcomes payload: KPI roll-up plus multiples/resuscitated counts,
 * a fixed six-Bangkok-month trend, a per-hospital breakdown (facet — ignores
 * the hospital filter), and the most recent births. Month bucketing happens
 * in JS so the queries stay Postgres/SQLite portable.
 */
export async function getOutcomes(
  db: DatabaseAdapter,
  filters: NewbornKPIFilters = {},
  now: Date = new Date(),
): Promise<OutcomesResponse> {
  const kpis = await getNewbornKPIs(db, filters, now);
  const { joins, clause, params } = newbornWhere(filters, now);

  // Multiples + resuscitated over the same scope. The resuscitation column is
  // JSON text ({"ppv":true,...}); CAST keeps LIKE valid on Postgres json too.
  const extraRows = await db.query<Record<string, unknown>>(
    `SELECT
      SUM(CASE WHEN cn.infant_number > 1 THEN 1 ELSE 0 END) as multiples,
      SUM(CASE WHEN CAST(cn.resuscitation AS TEXT) LIKE '%true%' THEN 1 ELSE 0 END) as resus
      FROM cached_newborns cn${joins}${clause}`,
    params,
  );

  // Trend — fixed six-month window (independent of range; hospital filter
  // applies so the chart follows the selected hospital).
  const shifted = new Date(now.getTime() + 7 * 3600_000);
  const monthKeys: string[] = [];
  for (let i = 5; i >= 0; i--) {
    monthKeys.push(
      new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - i, 1))
        .toISOString()
        .slice(0, 7),
    );
  }
  const windowStartIso = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - 5, 1) - 7 * 3600_000,
  ).toISOString();
  const trendFilters: NewbornKPIFilters = { hospitalId: filters.hospitalId };
  const tw = newbornWhere(trendFilters, now);
  const trendRows = await db.query<{ born_at: string; birth_weight_g: number | null }>(
    `SELECT cn.born_at, cn.birth_weight_g FROM cached_newborns cn${tw.joins}${
      tw.clause ? `${tw.clause} AND` : ' WHERE'
    } cn.born_at >= ?`,
    [...tw.params, windowStartIso],
  );
  const trendByMonth = new Map<string, OutcomeTrendPoint>(
    monthKeys.map((m) => [m, { month: m, births: 0, lbw: 0 }]),
  );
  for (const r of trendRows) {
    const bucket = trendByMonth.get(bangkokMonthKey(r.born_at));
    if (!bucket) continue;
    bucket.births += 1;
    if (r.birth_weight_g != null && Number(r.birth_weight_g) < NEWBORN_THRESHOLDS.lbwGrams) bucket.lbw += 1;
  }
  const trend = monthKeys.map((m) => trendByMonth.get(m)!);

  // Per-hospital breakdown — range applies, hospital filter intentionally
  // does not (it is the dimension being faceted).
  const hw = newbornWhere({ range: filters.range }, now);
  const hospitalRows = await db.query<Record<string, unknown>>(
    `SELECT h.id, h.hcode, h.name,
        COUNT(*) as births,
        SUM(CASE WHEN cn.birth_weight_g < ${NEWBORN_THRESHOLDS.lbwGrams} THEN 1 ELSE 0 END) as lbw,
        SUM(CASE WHEN cn.apgar_5min < ${NEWBORN_THRESHOLDS.apgarLowAt5min} THEN 1 ELSE 0 END) as low_apgar
      FROM cached_newborns cn
      JOIN maternal_journeys mj ON mj.id = cn.journey_id
      JOIN hospitals h ON h.id = mj.current_hospital_id${hw.clause}
      GROUP BY h.id, h.hcode, h.name
      ORDER BY births DESC, h.name`,
    hw.params,
  );
  const byHospital: OutcomeHospitalRow[] = hospitalRows.map((r) => ({
    id: r.id as string,
    hcode: r.hcode as string,
    name: r.name as string,
    births: Number(r.births) || 0,
    lbw: Number(r.lbw) || 0,
    lowApgar: Number(r.low_apgar) || 0,
  }));

  // Recent births — newest first, mother name decrypted at this boundary
  // (masked at render), row links back to the journey.
  const rw = newbornWhere(filters, now);
  const recentJoins = rw.joins || ` JOIN maternal_journeys mj ON mj.id = cn.journey_id`;
  const recentRows = await db.query<Record<string, unknown>>(
    `SELECT cn.id, cn.journey_id, cn.infant_number, cn.sex, cn.birth_weight_g,
        cn.apgar_1min, cn.apgar_5min, cn.resuscitation, cn.born_at,
        mj.name as mother_name, h.name as hospital_name
      FROM cached_newborns cn${recentJoins}
      JOIN hospitals h ON h.id = mj.current_hospital_id${rw.clause}
      ORDER BY cn.born_at DESC
      LIMIT 20`,
    rw.params,
  );
  const recent: RecentBirthEntry[] = recentRows.map((r) => {
    const flags = parseFlags(r.resuscitation);
    return {
      id: r.id as string,
      journeyId: r.journey_id as string,
      motherName: decryptSafe(r.mother_name as string),
      hospitalName: (r.hospital_name as string) ?? 'ไม่ทราบ',
      infantNumber: Number(r.infant_number) || 1,
      sex: (r.sex as string | null) ?? null,
      birthWeightG: r.birth_weight_g == null ? null : Number(r.birth_weight_g),
      apgar1min: r.apgar_1min == null ? null : Number(r.apgar_1min),
      apgar5min: r.apgar_5min == null ? null : Number(r.apgar_5min),
      resuscitated: Object.values(flags).some(Boolean),
      bornAt: r.born_at as string,
    };
  });

  return {
    ...kpis,
    multiples: Number(extraRows[0]?.multiples) || 0,
    resuscitated: Number(extraRows[0]?.resus) || 0,
    trend,
    byHospital,
    recent,
  };
}

function mapRowToNewborn(row: Record<string, unknown>): CachedNewborn {
  const parseJson = (val: unknown): Record<string, boolean> => {
    if (typeof val === 'string') return JSON.parse(val) as Record<string, boolean>;
    if (typeof val === 'object' && val !== null) return val as Record<string, boolean>;
    return {};
  };

  return {
    id: row.id as string,
    journeyId: row.journey_id as string,
    infantNumber: row.infant_number as number,
    sex: row.sex as string | null,
    birthWeightG: row.birth_weight_g as number | null,
    bodyLengthCm: row.body_length_cm as number | null,
    headCircumCm: row.head_circum_cm as number | null,
    temperature: row.temperature as number | null,
    heartRate: row.heart_rate as number | null,
    respiratoryRate: row.respiratory_rate as number | null,
    apgar1min: row.apgar_1min as number | null,
    apgar5min: row.apgar_5min as number | null,
    apgar10min: row.apgar_10min as number | null,
    resuscitation: parseJson(row.resuscitation),
    vaccinations: parseJson(row.vaccinations),
    infantIcd10: row.infant_icd10 as string | null,
    infantHn: row.infant_hn as string | null,
    infantAn: row.infant_an as string | null,
    dischargeStatus: row.discharge_status as string | null,
    bornAt: new Date(row.born_at as string),
    syncedAt: new Date(row.synced_at as string),
    createdAt: new Date(row.created_at as string),
  };
}
