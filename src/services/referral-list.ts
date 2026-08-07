// Provincial referral list read service.
//
// Centralises the SQL + row→DTO mapping for GET /api/dashboard/referrals/list
// so the route handler stays thin (parse params → call service → NextResponse),
// mirroring journey-list.ts. All SQL is parameterised; time cutoffs are
// resolved in app code and bound as params so the same query runs on both
// Postgres and SQLite. Patient names are decrypted at this boundary
// (decryptSafe) and masked client-side at render (maskName).
import type { DatabaseAdapter } from '@/db/adapter';
import { toIsoString } from '@/lib/dates';
import { decryptSafe } from '@/lib/encryption';
import { bangkokStartOfToday } from '@/lib/bangkok-time';
import { referralSlaCutoffs } from '@/config/referral-sla';
import type {
  ProvincialReferralListItem,
  ReferralDetail,
  ReferralInsightsResponse,
  ReferralListResponse,
  ReferralOpsCounts,
  ReferralStatusCounts,
} from '@/types/api';

export interface ReferralListFilters {
  status?: string;
  urgency?: string;
  fromHospitalId?: string;
  toHospitalId?: string;
  /** Time window on initiated_at: 'today' (Bangkok midnight), '7d', '30d'. */
  range?: string;
  /** Free-text search — refer number contains, HN prefix, or decrypted patient
   *  name contains (case-insensitive). */
  q?: string;
  /** Only INITIATED referrals older than REFERRAL_SLA.overdueAfterHours. */
  overdue?: boolean;
  page?: number;
  perPage?: number;
}

const TERMINAL_STATUSES = `('ARRIVED', 'REJECTED')`;

const DATA_SELECT = `SELECT cr.*,
    fh.name as from_hospital_name,
    th.name as to_hospital_name,
    mj.name as patient_name,
    mj.hn as patient_hn,
    mj.ga_weeks as patient_ga_weeks,
    mj.anc_risk_level as patient_anc_risk_level
  FROM cached_referrals cr
  LEFT JOIN hospitals fh ON fh.id = cr.from_hospital_id
  LEFT JOIN hospitals th ON th.id = cr.to_hospital_id
  LEFT JOIN maternal_journeys mj ON mj.id = cr.journey_id`;

const COUNT_SELECT = `SELECT COUNT(*) as total
  FROM cached_referrals cr
  LEFT JOIN maternal_journeys mj ON mj.id = cr.journey_id`;

interface WhereClause {
  clause: string;
  params: unknown[];
}

function buildReferralWhere(filters: ReferralListFilters, now: Date): WhereClause {
  let clause = '1=1';
  const params: unknown[] = [];

  if (filters.status) {
    clause += ` AND cr.status = ?`;
    params.push(filters.status);
  }
  if (filters.urgency) {
    clause += ` AND cr.urgency_level = ?`;
    params.push(filters.urgency);
  }
  if (filters.fromHospitalId) {
    clause += ` AND cr.from_hospital_id = ?`;
    params.push(filters.fromHospitalId);
  }
  if (filters.toHospitalId) {
    clause += ` AND cr.to_hospital_id = ?`;
    params.push(filters.toHospitalId);
  }
  if (filters.range) {
    const cutoff = rangeCutoff(filters.range, now);
    if (cutoff) {
      clause += ` AND cr.initiated_at >= ?`;
      params.push(cutoff);
    }
  }
  if (filters.overdue) {
    const { overdueBefore } = referralSlaCutoffs(now);
    clause += ` AND cr.status = 'INITIATED' AND cr.initiated_at < ?`;
    params.push(overdueBefore);
  }

  return { clause, params };
}

function rangeCutoff(range: string, now: Date): string | null {
  switch (range) {
    case 'today':
      return bangkokStartOfToday(now).toISOString();
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 3600_000).toISOString();
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 3600_000).toISOString();
    default:
      return null;
  }
}

// Active emergencies initiated within the pin window sort above everything
// else; inside each group, newest first. The pin cutoff is bound as a param.
const ORDER_BY = `ORDER BY CASE
    WHEN cr.urgency_level = 'EMERGENCY'
     AND cr.status NOT IN ${TERMINAL_STATUSES}
     AND cr.initiated_at >= ?
    THEN 0 ELSE 1 END,
  cr.initiated_at DESC`;

function mapReferralListItem(
  r: Record<string, unknown>,
  decryptedName?: string,
): ProvincialReferralListItem {
  return {
    id: r.id as string,
    journeyId: r.journey_id as string,
    referNumber: (r.refer_number as string | null) ?? null,
    fromHospital: (r.from_hospital_name as string) ?? 'ไม่ทราบ',
    toHospital: (r.to_hospital_name as string) ?? 'ไม่ทราบ',
    status: r.status as string,
    reason: r.reason as string,
    diagnosisCode: (r.diagnosis_code as string | null) ?? null,
    urgencyLevel: r.urgency_level as string,
    initiatedAt: toIsoString(r.initiated_at as string | Date) ?? '',
    arrivedAt: toIsoString(r.arrived_at as string | Date | null),
    patientName: decryptedName ?? decryptName(r.patient_name),
    hn: (r.patient_hn as string | null) ?? '',
    gaWeeks: r.patient_ga_weeks == null ? null : Number(r.patient_ga_weeks),
    ancRiskLevel: (r.patient_anc_risk_level as string | null) ?? 'LOW',
  };
}

function decryptName(value: unknown): string {
  if (!value) return 'ไม่ทราบชื่อ';
  return decryptSafe(value as string);
}

// DB-wide totals by status. Intentionally excludes every list filter so the
// KPI strip shows true totals rather than the current view.
async function computeStatusCounts(db: DatabaseAdapter): Promise<ReferralStatusCounts> {
  const rows = await db.query<{ status: string; cnt: number }>(
    `SELECT cr.status, COUNT(*) as cnt FROM cached_referrals cr GROUP BY cr.status`,
    [],
  );
  const counts: ReferralStatusCounts = {
    initiated: 0,
    accepted: 0,
    inTransit: 0,
    arrived: 0,
    rejected: 0,
    total: 0,
  };
  for (const r of rows) {
    const cnt = Number(r.cnt) || 0;
    counts.total += cnt;
    switch (r.status) {
      case 'INITIATED':
        counts.initiated = cnt;
        break;
      case 'ACCEPTED':
        counts.accepted = cnt;
        break;
      case 'IN_TRANSIT':
        counts.inTransit = cnt;
        break;
      case 'ARRIVED':
        counts.arrived = cnt;
        break;
      case 'REJECTED':
        counts.rejected = cnt;
        break;
    }
  }
  return counts;
}

// Fixed-window operational KPIs, always over the whole table. SUM(CASE ...)
// is portable across SQLite and Postgres.
async function computeOpsCounts(db: DatabaseAdapter, now: Date): Promise<ReferralOpsCounts> {
  const todayStart = bangkokStartOfToday(now).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString();
  const { overdueBefore } = referralSlaCutoffs(now);

  const rows = await db.query<Record<string, unknown>>(
    `SELECT
      SUM(CASE WHEN cr.initiated_at >= ? THEN 1 ELSE 0 END) as today,
      SUM(CASE WHEN cr.initiated_at >= ? THEN 1 ELSE 0 END) as last7d,
      SUM(CASE WHEN cr.urgency_level = 'EMERGENCY'
            AND cr.status NOT IN ${TERMINAL_STATUSES} THEN 1 ELSE 0 END) as emergency_active,
      SUM(CASE WHEN mj.anc_risk_level IS NOT NULL
            AND mj.anc_risk_level <> 'LOW' THEN 1 ELSE 0 END) as high_risk,
      SUM(CASE WHEN cr.status = 'INITIATED'
            AND cr.initiated_at < ? THEN 1 ELSE 0 END) as overdue
    FROM cached_referrals cr
    LEFT JOIN maternal_journeys mj ON mj.id = cr.journey_id`,
    [todayStart, sevenDaysAgo, overdueBefore],
  );
  const r = rows[0] ?? {};
  return {
    today: Number(r.today) || 0,
    last7d: Number(r.last7d) || 0,
    emergencyActive: Number(r.emergency_active) || 0,
    highRisk: Number(r.high_risk) || 0,
    overdue: Number(r.overdue) || 0,
  };
}

/** Province-wide referral ops KPIs for the dashboard continuum strip —
 *  same numbers the referrals board shows. */
export async function getReferralOpsCounts(
  db: DatabaseAdapter,
  now: Date = new Date(),
): Promise<ReferralOpsCounts> {
  return computeOpsCounts(db, now);
}

const DAY_MS = 24 * 3600_000;

/** Bangkok calendar date (YYYY-MM-DD) for an instant. */
function bangkokDateString(ms: number): string {
  return new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);
}

/**
 * Aggregates for the board's insights panel: top from→to corridors, 7-day
 * volume (Bangkok days, bucketed in JS for SQLite/Postgres portability), and
 * destination hospitals for the TO filter dropdown.
 */
export async function getReferralInsights(
  db: DatabaseAdapter,
  now: Date = new Date(),
): Promise<ReferralInsightsResponse> {
  const corridorRows = await db.query<Record<string, unknown>>(
    `SELECT cr.from_hospital_id, cr.to_hospital_id,
        fh.name as from_name, th.name as to_name, COUNT(*) as cnt
      FROM cached_referrals cr
      LEFT JOIN hospitals fh ON fh.id = cr.from_hospital_id
      LEFT JOIN hospitals th ON th.id = cr.to_hospital_id
      GROUP BY cr.from_hospital_id, cr.to_hospital_id, fh.name, th.name
      ORDER BY cnt DESC
      LIMIT 6`,
    [],
  );

  const destinationRows = await db.query<Record<string, unknown>>(
    `SELECT cr.to_hospital_id as id, th.name as name, COUNT(*) as cnt
      FROM cached_referrals cr
      LEFT JOIN hospitals th ON th.id = cr.to_hospital_id
      GROUP BY cr.to_hospital_id, th.name
      ORDER BY cnt DESC`,
    [],
  );

  const windowStart = bangkokStartOfToday(now).getTime() - 6 * DAY_MS;
  const dailyRows = await db.query<{ initiated_at: string }>(
    `SELECT cr.initiated_at FROM cached_referrals cr WHERE cr.initiated_at >= ?`,
    [new Date(windowStart).toISOString()],
  );
  const daily = Array.from({ length: 7 }, (_, i) => ({
    date: bangkokDateString(windowStart + i * DAY_MS),
    count: 0,
  }));
  for (const row of dailyRows) {
    const idx = Math.floor((new Date(row.initiated_at).getTime() - windowStart) / DAY_MS);
    if (idx >= 0 && idx < 7) daily[idx].count += 1;
  }

  return {
    corridors: corridorRows.map((r) => ({
      fromHospitalId: r.from_hospital_id as string,
      fromHospital: (r.from_name as string) ?? 'ไม่ทราบ',
      toHospitalId: r.to_hospital_id as string,
      toHospital: (r.to_name as string) ?? 'ไม่ทราบ',
      count: Number(r.cnt) || 0,
    })),
    daily,
    destinations: destinationRows.map((r) => ({
      id: r.id as string,
      name: (r.name as string) ?? 'ไม่ทราบ',
      count: Number(r.cnt) || 0,
    })),
  };
}

/**
 * Single referral with every lifecycle milestone for the detail dialog.
 * Returns null when the id is unknown (route maps to 404).
 */
export async function getReferralDetail(
  db: DatabaseAdapter,
  id: string,
): Promise<ReferralDetail | null> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT cr.*,
        fh.name as from_hospital_name,
        th.name as to_hospital_name,
        ah.name as alt_hospital_name,
        mj.name as patient_name,
        mj.hn as patient_hn,
        mj.ga_weeks as patient_ga_weeks,
        mj.anc_risk_level as patient_anc_risk_level
      FROM cached_referrals cr
      LEFT JOIN hospitals fh ON fh.id = cr.from_hospital_id
      LEFT JOIN hospitals th ON th.id = cr.to_hospital_id
      LEFT JOIN hospitals ah ON ah.id = cr.suggested_alternative_id
      LEFT JOIN maternal_journeys mj ON mj.id = cr.journey_id
      WHERE cr.id = ?`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;

  return {
    ...mapReferralListItem(r),
    rejectionReason: (r.rejection_reason as string | null) ?? null,
    transportMode: (r.transport_mode as string | null) ?? null,
    acceptedAt: toIsoString(r.accepted_at as string | Date | null),
    departedAt: toIsoString(r.departed_at as string | Date | null),
    rejectedAt: toIsoString(r.rejected_at as string | Date | null),
    suggestedAlternativeHospital: (r.alt_hospital_name as string | null) ?? null,
  };
}

/**
 * Province-wide referral list for GET /api/dashboard/referrals/list.
 * Always returns DB-wide `statusCounts` + `opsCounts` for the KPI strips.
 */
export async function listReferrals(
  db: DatabaseAdapter,
  filters: ReferralListFilters,
  now: Date = new Date(),
): Promise<ReferralListResponse> {
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const perPage = filters.perPage && filters.perPage > 0 ? filters.perPage : 20;
  const q = filters.q?.trim();

  const { clause, params } = buildReferralWhere(filters, now);
  const { emergencyPinAfter } = referralSlaCutoffs(now);

  let referrals: ProvincialReferralListItem[];
  let total: number;

  if (q) {
    // Patient names are encrypted at rest, so the name half of the search
    // cannot run in SQL. Fetch the base-filtered set, decrypt, match, then
    // paginate in memory — same approach as journey-list.ts.
    const rows = await db.query<Record<string, unknown>>(
      `${DATA_SELECT} WHERE ${clause} ${ORDER_BY}`,
      [...params, emergencyPinAfter],
    );
    const qLower = q.toLowerCase();
    const matched = rows
      .map((row) => ({ row, name: decryptName(row.patient_name) }))
      .filter(
        ({ row, name }) =>
          String(row.refer_number ?? '')
            .toLowerCase()
            .includes(qLower) ||
          String(row.patient_hn ?? '')
            .toLowerCase()
            .startsWith(qLower) ||
          name.toLowerCase().includes(qLower),
      );
    total = matched.length;
    referrals = matched
      .slice((page - 1) * perPage, page * perPage)
      .map(({ row, name }) => mapReferralListItem(row, name));
  } else {
    const countRows = await db.query<{ total: number }>(`${COUNT_SELECT} WHERE ${clause}`, params);
    total = Number(countRows[0]?.total) || 0;
    const rows = await db.query<Record<string, unknown>>(
      `${DATA_SELECT} WHERE ${clause} ${ORDER_BY} LIMIT ? OFFSET ?`,
      [...params, emergencyPinAfter, perPage, (page - 1) * perPage],
    );
    referrals = rows.map((row) => mapReferralListItem(row));
  }

  const statusCounts = await computeStatusCounts(db);
  const opsCounts = await computeOpsCounts(db, now);

  return {
    referrals,
    pagination: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    statusCounts,
    opsCounts,
  };
}
