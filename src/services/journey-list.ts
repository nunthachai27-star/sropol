// W3: Journey list/detail read service.
//
// Centralises the raw SQL + row→DTO mapping that previously lived inline in the
// journeys route handlers, so the handlers stay thin (parse params → call
// service → NextResponse). All SQL is parameterised and every user-facing name
// is passed through decryptSafe at the response boundary.
import type { DatabaseAdapter } from '@/db/adapter';
import { toIsoString } from '@/lib/dates';
import { decryptSafe } from '@/lib/encryption';
import { CareStage } from '@/types/domain';
import { ancFreshnessCutoffs, ANC_MAX_GA_WEEKS } from '@/config/anc-freshness';
import { ANC_OPS, ancOpsCutoffs } from '@/config/anc-ops';
import type {
  AncOpsCounts,
  JourneyHospitalFacet,
  JourneyListItem,
  JourneyListResponse,
  JourneyRiskCounts,
  JourneyDetailResponse,
  AncVisitEntry,
  AncRiskEntry,
  AncAssessmentCompleteness,
  ReferralListItem,
  NewbornEntry,
} from '@/types/api';

/** Working cohorts for the province ANC board — each maps to one KPI cell.
 *  'ltfu' is special: it swaps the 60-day last-ANC freshness gate for the
 *  60→ltfuWindowDays window so recently-dropped women become a worklist. */
export type JourneyCohort =
  'due_soon' | 'overdue_edc' | 'anc_stale' | 'low_visits' | 'near_term' | 'ltfu';

export type JourneySort = 'due' | 'ga' | 'last_anc' | 'newest';

export interface JourneyListFilters {
  stage?: string;
  riskLevel?: string;
  /** Filters on current_hospital_id (province-wide endpoint only). */
  hospitalId?: string;
  /** Free-text search — HN prefix, decrypted-name contains, or hospital-name
   *  contains (case-insensitive). */
  q?: string;
  /** Narrow the list to one operational cohort (PREGNANCY stage only). */
  cohort?: string;
  /** Row order; defaults to newest-registered first. */
  sort?: string;
  page?: number;
  perPage?: number;
}

interface WhereClause {
  clause: string;
  params: unknown[];
}

// ─── Shared predicate builder ─────────────────────────────────────────────
// Appends the stage / freshness / risk / hospital predicates onto a mandatory
// leading predicate (`base`). Every reference uses the `mj` alias so the same
// clause works for the data query, the count query, and the aggregate query.
function buildJourneyWhere(
  base: string,
  baseParams: unknown[],
  filters: Pick<JourneyListFilters, 'stage' | 'riskLevel' | 'hospitalId' | 'cohort'>,
  now: Date,
): WhereClause {
  let clause = base;
  const params = [...baseParams];

  if (filters.stage) {
    clause += ` AND mj.care_stage = ?`;
    params.push(filters.stage);
    // Freshness gates are only meaningful for the PREGNANCY registry — they
    // drop rows whose owners already delivered or were lost to follow-up.
    // Thresholds live in src/config/anc-freshness.ts; cutoffs are resolved in
    // app code and bound as params so this runs identically on Postgres/SQLite.
    if (filters.stage === CareStage.PREGNANCY) {
      const { edcOnOrAfter, lastAncOnOrAfter } = ancFreshnessCutoffs(now);
      clause += `
        AND (mj.ga_weeks IS NULL OR mj.ga_weeks <= ?)
        AND (mj.edc IS NULL OR mj.edc >= ?)`;
      params.push(ANC_MAX_GA_WEEKS, edcOnOrAfter);
      if (filters.cohort === 'ltfu') {
        // LTFU worklist: swap the last-ANC freshness gate for the window just
        // beyond it, so silently-dropped women become visible and recoverable.
        const { ltfuFloor } = ancOpsCutoffs(now);
        clause += `
        AND mj.last_anc_date IS NOT NULL AND mj.last_anc_date < ? AND mj.last_anc_date >= ?`;
        params.push(lastAncOnOrAfter, ltfuFloor);
      } else {
        clause += `
        AND (mj.last_anc_date IS NULL OR mj.last_anc_date >= ?)`;
        params.push(lastAncOnOrAfter);
      }
    }
  }
  if (filters.riskLevel) {
    clause += ` AND mj.anc_risk_level = ?`;
    params.push(filters.riskLevel);
  }
  if (filters.hospitalId) {
    clause += ` AND mj.current_hospital_id = ?`;
    params.push(filters.hospitalId);
  }
  if (filters.cohort && filters.cohort !== 'ltfu') {
    const { dueSoonBefore, staleBefore } = ancOpsCutoffs(now);
    switch (filters.cohort) {
      case 'due_soon':
        clause += ` AND mj.edc IS NOT NULL AND mj.edc <= ?`;
        params.push(dueSoonBefore);
        break;
      case 'overdue_edc':
        clause += ` AND mj.edc IS NOT NULL AND mj.edc < ?`;
        params.push(now.toISOString());
        break;
      case 'anc_stale':
        clause += ` AND mj.last_anc_date IS NOT NULL AND mj.last_anc_date < ?`;
        params.push(staleBefore);
        break;
      case 'low_visits':
        clause += ` AND mj.anc_visit_count < ? AND mj.ga_weeks >= ?`;
        params.push(ANC_OPS.minVisits, ANC_OPS.minVisitsGaWeeks);
        break;
      case 'near_term':
        clause += ` AND mj.ga_weeks >= ?`;
        params.push(ANC_OPS.nearTermGaWeeks);
        break;
    }
  }

  return { clause, params };
}

/** Row order for the registry. 'due' and 'last_anc' put the actionable end
 *  first; unknown values sort where they are least misleading. */
function buildOrderBy(sort?: string): string {
  switch (sort) {
    case 'due':
      return `ORDER BY CASE WHEN mj.edc IS NULL THEN 1 ELSE 0 END, mj.edc ASC`;
    case 'ga':
      return `ORDER BY CASE WHEN mj.ga_weeks IS NULL THEN 1 ELSE 0 END, mj.ga_weeks DESC`;
    case 'last_anc':
      // Never-visited rows first (most urgent to chase), then oldest visit.
      return `ORDER BY CASE WHEN mj.last_anc_date IS NULL THEN 0 ELSE 1 END, mj.last_anc_date ASC`;
    default:
      return `ORDER BY mj.created_at DESC`;
  }
}

const DATA_SELECT = `SELECT mj.*, h.name as hospital_name, h.hcode
  FROM maternal_journeys mj JOIN hospitals h ON h.id = mj.hospital_id`;
const COUNT_SELECT = `SELECT COUNT(*) as total
  FROM maternal_journeys mj JOIN hospitals h ON h.id = mj.hospital_id`;

const GESTATION_DAYS = 280;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Live GA: prefer the synced ga_weeks; otherwise derive from EDC (40 weeks
 *  minus time-to-EDC). Keeps GA current between syncs and fills the ~14% of
 *  registry rows where HOSxP sends EDC but no GA. Returns null outside a
 *  plausible 0–44 week window. */
export function effectiveGaWeeks(
  gaWeeks: number | null,
  edc: string | null,
  now: Date = new Date(),
): number | null {
  if (gaWeeks != null) return gaWeeks;
  if (!edc) return null;
  const gaDays = GESTATION_DAYS - Math.round((new Date(edc).getTime() - now.getTime()) / DAY_MS);
  const weeks = Math.floor(gaDays / 7);
  return weeks >= 0 && weeks <= 44 ? weeks : null;
}

function mapJourneyListItem(r: Record<string, unknown>, decryptedName?: string): JourneyListItem {
  return {
    id: r.id as string,
    hn: r.hn as string,
    name: decryptedName ?? decryptSafe(r.name as string),
    age: r.age as number,
    gravida: r.gravida as number,
    para: r.para as number,
    gaWeeks: effectiveGaWeeks(r.ga_weeks as number | null, r.edc as string | null),
    lmp: toIsoString(r.lmp as string | Date | null),
    edc: toIsoString(r.edc as string | Date | null),
    careStage: r.care_stage as string,
    ancRiskLevel: r.anc_risk_level as string,
    ancVisitCount: r.anc_visit_count as number,
    lastAncDate: toIsoString(r.last_anc_date as string | Date | null),
    hospitalName: r.hospital_name as string,
    hcode: r.hcode as string,
    registeredAt: toIsoString(r.registered_at as string | Date) ?? '',
  };
}

function normalizePaging(filters: JourneyListFilters): { page: number; perPage: number } {
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const perPage = filters.perPage && filters.perPage > 0 ? filters.perPage : 20;
  return { page, perPage };
}

// DB-wide totals by ANC risk level over the stage+freshness(+hospital) set.
// Intentionally excludes the risk_level filter (we break down by it) and the
// q search, so the KPI strip shows true totals rather than the current view.
async function computeRiskCounts(
  db: DatabaseAdapter,
  base: string,
  baseParams: unknown[],
  filters: JourneyListFilters,
  now: Date,
): Promise<JourneyRiskCounts> {
  const { clause, params } = buildJourneyWhere(
    base,
    baseParams,
    { stage: filters.stage, hospitalId: filters.hospitalId },
    now,
  );
  const rows = await db.query<{ anc_risk_level: string; cnt: number }>(
    `SELECT mj.anc_risk_level, COUNT(*) as cnt
       FROM maternal_journeys mj JOIN hospitals h ON h.id = mj.hospital_id
      WHERE ${clause}
      GROUP BY mj.anc_risk_level`,
    params,
  );

  const counts: JourneyRiskCounts = { low: 0, hr1: 0, hr2: 0, hr3: 0, total: 0 };
  for (const r of rows) {
    const cnt = Number(r.cnt) || 0;
    counts.total += cnt;
    switch (r.anc_risk_level) {
      case 'LOW':
        counts.low = cnt;
        break;
      case 'HR1':
        counts.hr1 = cnt;
        break;
      case 'HR2':
        counts.hr2 = cnt;
        break;
      case 'HR3':
        counts.hr3 = cnt;
        break;
    }
  }
  return counts;
}

/** Province-wide ANC board counts (risk breakdown + ops cohorts) for the
 *  dashboard continuum strip — same numbers the pregnancies board shows. */
export async function getAncBoardCounts(
  db: DatabaseAdapter,
  now: Date = new Date(),
): Promise<{ risk: JourneyRiskCounts; ops: AncOpsCounts }> {
  const filters: JourneyListFilters = { stage: CareStage.PREGNANCY };
  return {
    risk: await computeRiskCounts(db, '1=1', [], filters, now),
    ops: await computeOpsCounts(db, filters, now),
  };
}

/**
 * Province-wide journey list for GET /api/journeys.
 * Supports stage (+freshness), risk_level, hospital_id, pagination, and a `q`
 * search. Always returns a DB-wide `counts` breakdown for the KPI strip.
 */
export async function listJourneys(
  db: DatabaseAdapter,
  filters: JourneyListFilters,
): Promise<JourneyListResponse> {
  const { page, perPage } = normalizePaging(filters);
  const now = new Date();
  const q = filters.q?.trim();

  const base = '1=1';
  const baseParams: unknown[] = [];
  const { clause, params } = buildJourneyWhere(base, baseParams, filters, now);

  let journeys: JourneyListItem[];
  let total: number;

  const orderBy = buildOrderBy(filters.sort);

  if (q) {
    // Names are encrypted at rest, so the name half of the search cannot run
    // in SQL. Fetch the full base-filtered set, decrypt, match (HN prefix OR
    // name contains OR hospital-name contains), then paginate in memory — the
    // match must happen before paging.
    const rows = await db.query<Record<string, unknown>>(
      `${DATA_SELECT} WHERE ${clause} ${orderBy}`,
      params,
    );
    const qLower = q.toLowerCase();
    const matched = rows
      .map((row) => ({ row, name: decryptSafe(row.name as string) }))
      .filter(
        ({ row, name }) =>
          String(row.hn ?? '')
            .toLowerCase()
            .startsWith(qLower) ||
          name.toLowerCase().includes(qLower) ||
          String(row.hospital_name ?? '')
            .toLowerCase()
            .includes(qLower),
      );
    total = matched.length;
    journeys = matched
      .slice((page - 1) * perPage, page * perPage)
      .map(({ row, name }) => mapJourneyListItem(row, name));
  } else {
    const countRows = await db.query<{ total: number }>(`${COUNT_SELECT} WHERE ${clause}`, params);
    total = Number(countRows[0]?.total) || 0;
    const rows = await db.query<Record<string, unknown>>(
      `${DATA_SELECT} WHERE ${clause} ${orderBy} LIMIT ? OFFSET ?`,
      [...params, perPage, (page - 1) * perPage],
    );
    journeys = rows.map((row) => mapJourneyListItem(row));
  }

  const counts = await computeRiskCounts(db, base, baseParams, filters, now);

  // Operational cohorts + hospital facet are PREGNANCY-board concerns.
  let opsCounts: AncOpsCounts | undefined;
  let hospitalCounts: JourneyHospitalFacet[] | undefined;
  if (filters.stage === CareStage.PREGNANCY) {
    opsCounts = await computeOpsCounts(db, filters, now);
    hospitalCounts = await computeHospitalCounts(db, filters, now);
  }

  return {
    journeys,
    pagination: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    counts,
    ...(opsCounts ? { opsCounts } : {}),
    ...(hospitalCounts ? { hospitalCounts } : {}),
  };
}

// Fixed-cohort KPIs over the gated PREGNANCY set — independent of the
// risk/q/cohort filters (same stability contract as computeRiskCounts).
// SUM(CASE ...) is portable across SQLite and Postgres; NULL ga_weeks rows
// never satisfy the GA comparisons, so they are conservatively excluded.
async function computeOpsCounts(
  db: DatabaseAdapter,
  filters: JourneyListFilters,
  now: Date,
): Promise<AncOpsCounts> {
  const { clause, params } = buildJourneyWhere(
    '1=1',
    [],
    { stage: CareStage.PREGNANCY, hospitalId: filters.hospitalId },
    now,
  );
  const { dueSoonBefore, staleBefore } = ancOpsCutoffs(now);

  const rows = await db.query<Record<string, unknown>>(
    `SELECT
      SUM(CASE WHEN mj.edc IS NOT NULL AND mj.edc <= ? THEN 1 ELSE 0 END) as due_soon,
      SUM(CASE WHEN mj.edc IS NOT NULL AND mj.edc < ? THEN 1 ELSE 0 END) as overdue_edc,
      SUM(CASE WHEN mj.last_anc_date IS NOT NULL AND mj.last_anc_date < ? THEN 1 ELSE 0 END) as anc_stale,
      SUM(CASE WHEN mj.anc_visit_count < ? AND mj.ga_weeks >= ? THEN 1 ELSE 0 END) as low_visits,
      SUM(CASE WHEN mj.ga_weeks >= ? THEN 1 ELSE 0 END) as near_term
    FROM maternal_journeys mj JOIN hospitals h ON h.id = mj.hospital_id
    WHERE ${clause}`,
    [
      dueSoonBefore,
      now.toISOString(),
      staleBefore,
      ANC_OPS.minVisits,
      ANC_OPS.minVisitsGaWeeks,
      ANC_OPS.nearTermGaWeeks,
      ...params,
    ],
  );

  // LTFU lives outside the normal gate, so it needs its own where-clause.
  const ltfu = buildJourneyWhere(
    '1=1',
    [],
    { stage: CareStage.PREGNANCY, hospitalId: filters.hospitalId, cohort: 'ltfu' },
    now,
  );
  const ltfuRows = await db.query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt
       FROM maternal_journeys mj JOIN hospitals h ON h.id = mj.hospital_id
      WHERE ${ltfu.clause}`,
    ltfu.params,
  );

  const r = rows[0] ?? {};
  return {
    dueSoon: Number(r.due_soon) || 0,
    overdueEdc: Number(r.overdue_edc) || 0,
    ancStale: Number(r.anc_stale) || 0,
    lowVisits: Number(r.low_visits) || 0,
    nearTerm: Number(r.near_term) || 0,
    ltfu: Number(ltfuRows[0]?.cnt) || 0,
  };
}

// Hospitals present in the gated set with counts — excludes the hospitalId
// filter (it is the dimension being faceted) and the risk/q/cohort filters.
async function computeHospitalCounts(
  db: DatabaseAdapter,
  filters: JourneyListFilters,
  now: Date,
): Promise<JourneyHospitalFacet[]> {
  const { clause, params } = buildJourneyWhere('1=1', [], { stage: filters.stage }, now);
  const rows = await db.query<Record<string, unknown>>(
    `SELECT mj.current_hospital_id as id, ch.name as name, COUNT(*) as cnt
       FROM maternal_journeys mj
       JOIN hospitals h ON h.id = mj.hospital_id
       JOIN hospitals ch ON ch.id = mj.current_hospital_id
      WHERE ${clause}
      GROUP BY mj.current_hospital_id, ch.name
      ORDER BY cnt DESC, ch.name`,
    params,
  );
  return rows.map((r) => ({
    id: r.id as string,
    name: (r.name as string) ?? 'ไม่ทราบ',
    count: Number(r.cnt) || 0,
  }));
}

/**
 * Per-hospital journey list for GET /api/hospitals/[hcode]/journeys.
 * Returns null when the hcode is unknown (route maps to 404). Includes a
 * DB-wide `counts` risk breakdown over the hospital+stage set (independent of
 * pagination and the riskLevel filter) so KPI strips never derive totals from
 * a capped row list.
 */
export async function listHospitalJourneys(
  db: DatabaseAdapter,
  hcode: string,
  filters: JourneyListFilters,
): Promise<JourneyListResponse | null> {
  const hospitals = await db.query<{ id: string }>(`SELECT id FROM hospitals WHERE hcode = ?`, [
    hcode,
  ]);
  if (hospitals.length === 0) return null;
  const hospitalId = hospitals[0].id;

  const { page, perPage } = normalizePaging(filters);
  const now = new Date();
  const { clause, params } = buildJourneyWhere(
    'mj.current_hospital_id = ?',
    [hospitalId],
    { stage: filters.stage, riskLevel: filters.riskLevel },
    now,
  );

  const countRows = await db.query<{ total: number }>(`${COUNT_SELECT} WHERE ${clause}`, params);
  const total = Number(countRows[0]?.total) || 0;

  const rows = await db.query<Record<string, unknown>>(
    `${DATA_SELECT} WHERE ${clause} ${buildOrderBy(filters.sort)} LIMIT ? OFFSET ?`,
    [...params, perPage, (page - 1) * perPage],
  );
  const journeys = rows.map((row) => mapJourneyListItem(row));

  const counts = await computeRiskCounts(db, '1=1', [], { stage: filters.stage, hospitalId }, now);

  return {
    journeys,
    pagination: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    counts,
  };
}

// ─── Detail helpers ───────────────────────────────────────────────────────

// Tolerant parser — HOSxP / webhook may store this as a JSON string (Postgres)
// or an already-deserialized array (SQLite json column). Returns null on garbage.
function parseDangerSigns(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string');
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((s): s is string => typeof s === 'string')
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

// Generic JSON-or-object passthrough — used for RTCOG additions that store
// structured data (vaccines_given_json, psychosocial_screen_json, etc).
function parseJson<T = unknown>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Parse `cached_anc_risks.risk_factors` into the assessment-completeness
 * shape the POLLING path (T3) writes: `{missingRequired: string[],
 * assessmentIncomplete: boolean}`. WHO containment T6.
 *
 * Returns null for every "no reliable completeness signal" case, all
 * deliberately collapsed to the same UI outcome (no marker):
 *   - absent/null (no screening row, or the column is null)
 *   - unparseable JSON (malformed string)
 *   - legacy `{}` rows written before T3 existed
 *   - the WEBHOOK path's items-based shape (`{itemIds: [...]}`) — webhook
 *     evidence is items-based, not completeness-based; this is expected,
 *     not a bug (see WebhookAncResult JSDoc).
 * Tolerant of both already-parsed pg JSONB objects and raw JSON strings.
 */
export function parseAncAssessment(raw: unknown): AncAssessmentCompleteness | null {
  const parsed = parseJson<Record<string, unknown>>(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  const { missingRequired, assessmentIncomplete } = parsed;
  if (!Array.isArray(missingRequired) || typeof assessmentIncomplete !== 'boolean') return null;
  return {
    incomplete: assessmentIncomplete,
    missingRequired: missingRequired.filter((s): s is string => typeof s === 'string'),
  };
}

/** Referrals attached to one journey, hospital names resolved — shared by
 *  the journey detail and the labor patient detail. */
export async function getJourneyReferrals(
  db: DatabaseAdapter,
  journeyId: string,
): Promise<ReferralListItem[]> {
  const refRows = await db.query<Record<string, unknown>>(
    `SELECT cr.*, fh.name as from_name, th.name as to_name
     FROM cached_referrals cr
     JOIN hospitals fh ON fh.id = cr.from_hospital_id
     JOIN hospitals th ON th.id = cr.to_hospital_id
     WHERE cr.journey_id = ?
     ORDER BY cr.initiated_at DESC`,
    [journeyId],
  );
  return refRows.map((ref) => ({
    id: ref.id as string,
    journeyId: ref.journey_id as string,
    referNumber: (ref.refer_number as string | null) ?? null,
    fromHospital: ref.from_name as string,
    toHospital: ref.to_name as string,
    status: ref.status as string,
    reason: ref.reason as string,
    diagnosisCode: (ref.diagnosis_code as string | null) ?? null,
    urgencyLevel: ref.urgency_level as string,
    initiatedAt: toIsoString(ref.initiated_at as string | Date) ?? '',
    arrivedAt: toIsoString(ref.arrived_at as string | Date | null),
  }));
}

/** Newborn records for one journey — shared by journey + patient details. */
export async function getJourneyNewborns(
  db: DatabaseAdapter,
  journeyId: string,
): Promise<NewbornEntry[]> {
  const nbRows = await db.query<Record<string, unknown>>(
    `SELECT * FROM cached_newborns WHERE journey_id = ? ORDER BY infant_number`,
    [journeyId],
  );
  return nbRows.map((nb) => ({
    infantNumber: nb.infant_number as number,
    sex: nb.sex as string | null,
    birthWeightG: nb.birth_weight_g as number | null,
    apgar1min: nb.apgar_1min as number | null,
    apgar5min: nb.apgar_5min as number | null,
    bornAt: toIsoString(nb.born_at as string | Date) ?? '',
  }));
}

/**
 * Full journey detail for GET /api/journeys/[journeyId].
 * Returns null when the journey is not found (route maps to 404).
 */
export async function getJourneyDetail(
  db: DatabaseAdapter,
  journeyId: string,
): Promise<JourneyDetailResponse | null> {
  // Journey + hospital info + latest known maternal height (labor-side, if the
  // journey has crossed to a cached_patients record). LEFT JOIN on
  // current_hospital_id + COALESCE so a stale/NULL current_hospital_id doesn't
  // 404 the whole detail page; falls back to the registering hospital.
  const journeyRows = await db.query<Record<string, unknown>>(
    `SELECT mj.*, h.name as hospital_name, h.hcode,
            COALESCE(ch.name, h.name) as current_hospital_name,
            COALESCE(ch.hcode, h.hcode) as current_hcode,
            (SELECT cp.height_cm FROM cached_patients cp
               WHERE cp.journey_id = mj.id AND cp.height_cm IS NOT NULL
               ORDER BY cp.updated_at DESC LIMIT 1) as height_cm
     FROM maternal_journeys mj
     JOIN hospitals h ON h.id = mj.hospital_id
     LEFT JOIN hospitals ch ON ch.id = mj.current_hospital_id
     WHERE mj.id = ?`,
    [journeyId],
  );

  if (journeyRows.length === 0) return null;
  const r = journeyRows[0];

  // ANC visits — LEFT JOIN hospitals so each visit can show where it happened
  // (referred patients attend ANC across hospitals). Secondary sort by
  // visit_number stabilises ties on visit_date.
  const visitRows = await db.query<Record<string, unknown>>(
    `SELECT cv.*, vh.name AS visit_hospital_name, vh.hcode AS visit_hcode
       FROM cached_anc_visits cv
       LEFT JOIN hospitals vh ON vh.id = cv.hospital_id
      WHERE cv.journey_id = ?
      ORDER BY cv.visit_date, cv.visit_number`,
    [journeyId],
  );
  const ancVisits: AncVisitEntry[] = visitRows.map((v) => ({
    visitDate: toIsoString(v.visit_date as string | Date) ?? '',
    visitNumber: v.visit_number as number,
    hospitalName: (v.visit_hospital_name as string | null) ?? null,
    hcode: (v.visit_hcode as string | null) ?? null,
    gaWeeks: v.ga_weeks as number | null,
    fundalHeightCm: v.fundal_height_cm as number | null,
    weightKg: v.weight_kg as number | null,
    bpSystolic: v.bp_systolic as number | null,
    bpDiastolic: v.bp_diastolic as number | null,
    fetalHr: v.fetal_hr as number | null,
    presentation: (v.presentation as string | null) ?? null,
    engagement: (v.engagement as string | null) ?? null,
    passQuality: v.pass_quality == null ? null : !!v.pass_quality,
    urineProtein: (v.urine_protein as string | null) ?? null,
    urineGlucose: (v.urine_glucose as string | null) ?? null,
    hbGDl: v.hb_g_dl == null ? null : Number(v.hb_g_dl),
    hctPct: v.hct_pct == null ? null : Number(v.hct_pct),
    ttDoseNo: v.tt_dose_no as number | null,
    ironFolicGiven: v.iron_folic_given == null ? null : !!v.iron_folic_given,
    calciumGiven: v.calcium_given == null ? null : !!v.calcium_given,
    dangerSigns: parseDangerSigns(v.danger_signs_json),
    fetalMovementOk: v.fetal_movement_ok == null ? null : !!v.fetal_movement_ok,
    vaccinesGiven: parseJson<AncVisitEntry['vaccinesGiven']>(v.vaccines_given_json) ?? null,
    urineKetone: (v.urine_ketone as string | null) ?? null,
    urineCultureResult: (v.urine_culture_result as string | null) ?? null,
    iodineGiven: v.iodine_given == null ? null : !!v.iodine_given,
    multivitaminGiven: v.multivitamin_given == null ? null : !!v.multivitamin_given,
    vitaminDIu: (v.vitamin_d_iu as number | null) ?? null,
    nstResult: (v.nst_result as AncVisitEntry['nstResult']) ?? null,
    bppScore: (v.bpp_score as number | null) ?? null,
    umbilicalDopplerResult:
      (v.umbilical_doppler_result as AncVisitEntry['umbilicalDopplerResult']) ?? null,
    psychosocialScreen:
      parseJson<AncVisitEntry['psychosocialScreen']>(v.psychosocial_screen_json) ?? null,
  }));

  // Latest risk. Tolerant parse — pg returns JSONB already-parsed; SQLite
  // returns TEXT, on which strict JSON.parse of an array literal throws.
  const riskRows = await db.query<Record<string, unknown>>(
    `SELECT * FROM cached_anc_risks WHERE journey_id = ? ORDER BY screened_at DESC LIMIT 1`,
    [journeyId],
  );
  const latestRisk: AncRiskEntry | null =
    riskRows.length > 0
      ? {
          riskLevel: riskRows[0].risk_level as string,
          triggeredRules: parseJson<string[]>(riskRows[0].triggered_rules) ?? [],
          screenedAt: toIsoString(riskRows[0].screened_at as string | Date) ?? '',
          recommendedFacility: riskRows[0].recommended_facility as string | null,
        }
      : null;
  // WHO containment T6 — see parseAncAssessment JSDoc for the null cases.
  const ancAssessment = riskRows.length > 0 ? parseAncAssessment(riskRows[0].risk_factors) : null;

  const referrals = await getJourneyReferrals(db, journeyId);
  const newborns = await getJourneyNewborns(db, journeyId);

  // Latest linked labor admission — lets the journey page cross-link to the
  // labor detail (/patients/[hcode]-[an]) once the woman is admitted.
  const laborRows = await db.query<Record<string, unknown>>(
    `SELECT cp.an, lh.hcode, cp.labor_status, cp.admit_date
       FROM cached_patients cp
       JOIN hospitals lh ON lh.id = cp.hospital_id
      WHERE cp.journey_id = ?
      ORDER BY cp.admit_date DESC
      LIMIT 1`,
    [journeyId],
  );
  const laborAdmission =
    laborRows.length > 0
      ? {
          an: laborRows[0].an as string,
          hcode: laborRows[0].hcode as string,
          laborStatus: laborRows[0].labor_status as string,
          // pg returns timestamptz columns as Date objects, SQLite as
          // strings — normalize to ISO so the API shape stays a string.
          admitDate: toIsoString(laborRows[0].admit_date as string | Date) ?? '',
        }
      : null;

  return {
    journey: {
      id: r.id as string,
      hn: r.hn as string,
      name: decryptSafe(r.name as string),
      age: r.age as number,
      gravida: r.gravida as number,
      para: r.para as number,
      gaWeeks: r.ga_weeks as number | null,
      lmp: toIsoString(r.lmp as string | Date | null),
      edc: toIsoString(r.edc as string | Date | null),
      careStage: r.care_stage as string,
      ancRiskLevel: r.anc_risk_level as string,
      ancVisitCount: r.anc_visit_count as number,
      lastAncDate: toIsoString(r.last_anc_date as string | Date | null),
      hospitalName: r.hospital_name as string,
      hcode: r.hcode as string,
      registeredAt: toIsoString(r.registered_at as string | Date) ?? '',
      currentHospitalName: r.current_hospital_name as string,
      currentHcode: r.current_hcode as string,
      heightCm: r.height_cm as number | null,
      bloodGroup: (r.blood_group as string | null) ?? null,
      rhFactor: (r.rh_factor as string | null) ?? null,
      hbsagResult: (r.hbsag_result as string | null) ?? null,
      vdrlResult: (r.vdrl_result as string | null) ?? null,
      hivResult: (r.hiv_result as string | null) ?? null,
      ogttResult: (r.ogtt_result as string | null) ?? null,
      termBirths: r.term_births as number | null,
      pretermBirths: r.preterm_births as number | null,
      abortions: r.abortions as number | null,
      livingChildren: r.living_children as number | null,
      pastMedicalHistory: (r.past_medical_history as string | null) ?? null,
      mcvFl: r.mcv_fl == null ? null : Number(r.mcv_fl),
      dcipResult: (r.dcip_result as 'POS' | 'NEG' | 'PENDING' | null) ?? null,
      hbEResult: (r.hb_e_result as 'POS' | 'NEG' | 'PENDING' | null) ?? null,
      thalassemiaType:
        (r.thalassemia_type as
          'HB_H' | 'BETA_THAL_MAJOR' | 'BETA_THAL_HB_E' | 'TRAIT' | 'NORMAL' | null) ?? null,
      cervicalScreenType: (r.cervical_screen_type as 'PAP' | 'HPV' | 'NONE' | null) ?? null,
      cervicalScreenResult:
        (r.cervical_screen_result as 'NORMAL' | 'ABNORMAL' | 'PENDING' | null) ?? null,
      cervicalScreenDate: (r.cervical_screen_date as string | null) ?? null,
      aneuploidyMethod:
        (r.aneuploidy_method as 'SERUM_T1' | 'QUAD_T2' | 'CFDNA' | 'NONE' | null) ?? null,
      aneuploidyResult:
        (r.aneuploidy_result as 'LOW_RISK' | 'HIGH_RISK' | 'PENDING' | null) ?? null,
      gbsResult: (r.gbs_result as 'POS' | 'NEG' | 'PENDING' | null) ?? null,
      gbsCollectedDate: (r.gbs_collected_date as string | null) ?? null,
      anatomyScanDate: (r.anatomy_scan_date as string | null) ?? null,
      anatomyScanResult:
        (r.anatomy_scan_result as 'NORMAL' | 'ABNORMAL' | 'PENDING' | null) ?? null,
      efwG: (r.efw_g as number | null) ?? null,
      datingMethod: (r.dating_method as 'LMP' | 'US' | 'ART' | null) ?? null,
      proteinuria24hMg: (r.proteinuria_24h_mg as number | null) ?? null,
      creatinineMgDl: r.creatinine_mg_dl == null ? null : Number(r.creatinine_mg_dl),
      priorPeDvt: r.prior_pe_dvt == null ? null : !!r.prior_pe_dvt,
      severeLungDisease: r.severe_lung_disease == null ? null : !!r.severe_lung_disease,
      alloimmunizationCde: r.alloimmunization_cde == null ? null : !!r.alloimmunization_cde,
      bariatricSurgeryHx: r.bariatric_surgery_hx == null ? null : !!r.bariatric_surgery_hx,
      teratogenExposure: r.teratogen_exposure == null ? null : !!r.teratogen_exposure,
      congenitalInfection: r.congenital_infection == null ? null : !!r.congenital_infection,
      gdmRiskFactors: parseJson<string[]>(r.gdm_risk_factors_json) ?? null,
      syncedAt: (r.synced_at as string | null) ?? null,
    },
    ancVisits,
    latestRisk,
    ancAssessment,
    referrals,
    newborns,
    laborAdmission,
  };
}
