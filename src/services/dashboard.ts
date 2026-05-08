// T048: Dashboard service — province dashboard data from local cache
//
// Every aggregate query in this module filters by hospitals.is_active so that
// disabling a hospital from /admin (or a soft-delete via the trash button)
// removes it from every dashboard widget — labor KPI, ANC alert count,
// referral inbox, trends, high-risk list. Without this filter, a deactivated
// hospital's stale cached_patients / maternal_journeys rows continue to
// inflate the province totals (which is why hcode 00000 contributed 132
// "active labor" cases even after the admin disabled it).
//
// We don't physically delete those cached rows when a hospital is
// deactivated (FK cascade is non-trivial across 9 tables, and a re-enable
// must be lossless), so the dashboard layer is the right place to honor the
// flag — one subquery, applied everywhere.
import type { DatabaseAdapter } from '@/db/adapter';
import type {
  DashboardHospital,
  DashboardSummary,
  HighRiskPatient,
  DashboardStageKPIs,
  DashboardAlerts,
  DashboardTrends,
  ShiftStats,
  CdssSeverity,
} from '@/types/api';
import type { ConnectionStatus, HospitalLevel } from '@/types/domain';
import { decryptSafe } from '@/lib/encryption';
import { SYNC_FAILURE_STATUSES } from '@/config/sync-status';

// Reusable subquery — every cached_*/maternal_journeys aggregate joins this
// against the relevant hospital_id column to honor the operational
// is_active flag. Inlined as a literal so we don't need parameterized IN
// lists (PGlite + node-postgres handle the planner-cached subquery well).
const ACTIVE_HOSPITAL_IDS_SQL = '(SELECT id FROM hospitals WHERE is_active = true)';

interface DashboardRow {
  hcode: string;
  name: string;
  level: string;
  connection_status: string;
  last_sync_at: string | null;
  is_active: number;
  province_code: string | null;
  district_code: string | null;
  lat: number | string | null;
  lon: number | string | null;
  // Joined from hospital_bms_config — null when never onboarded.
  has_bms_config: number | boolean | null;
  last_authenticity_status: string | null;
  data_purged_at: string | null;
}

// SYNC_FAILURE_STATUSES is now defined in src/config/sync-status.ts so the
// admin map (`/admin`) and the dashboard map (`/`) share the same BLOCKED
// rule set — preventing the "same hospital shows two different dot colors
// on the two pages" inconsistency.

interface PatientCountRow {
  hospital_id: string;
  hcode: string;
  risk_level: string | null;
  count: number;
}

export interface DashboardResult {
  hospitals: DashboardHospital[];
  summary: DashboardSummary;
  updatedAt: string;
}

export async function getProvinceDashboard(db: DatabaseAdapter): Promise<DashboardResult> {
  // Get all active hospitals + their BMS sync verdict so the map and the
  // hospital list can render BLOCKED separately from OFFLINE. LEFT JOIN so
  // never-onboarded hospitals (no hospital_bms_config row) still appear.
  const hospitals = await db.query<DashboardRow>(
    `SELECT h.hcode, h.name, h.level, h.connection_status, h.last_sync_at,
            h.is_active, h.province_code, h.district_code, h.lat, h.lon,
            CASE WHEN hbc.id IS NULL THEN false ELSE true END AS has_bms_config,
            hbc.last_authenticity_status, hbc.data_purged_at
     FROM hospitals h
     LEFT JOIN hospital_bms_config hbc ON hbc.hospital_id = h.id
     WHERE h.is_active = true
     ORDER BY h.name`,
  );

  // Get patient counts per hospital grouped by risk level
  // SQLite-compatible: no LATERAL join, use subquery
  const counts = await db.query<PatientCountRow>(`
    SELECT h.id as hospital_id, h.hcode,
      (SELECT cs.risk_level FROM cpd_scores cs
       WHERE cs.patient_id = cp.id
       ORDER BY cs.calculated_at DESC LIMIT 1) as risk_level,
      COUNT(cp.id) as count
    FROM hospitals h
    LEFT JOIN cached_patients cp ON cp.hospital_id = h.id AND cp.labor_status = 'ACTIVE'
    WHERE h.is_active = true
    GROUP BY h.id, h.hcode, risk_level
  `);

  // Build result
  const hospitalMap = new Map<string, DashboardHospital>();

  for (const h of hospitals) {
    // PGlite returns DECIMAL columns as strings. Coerce lat/lon once here so
    // downstream consumers (map, mobile clients) get numbers.
    const lat = h.lat === null ? null : Number(h.lat);
    const lon = h.lon === null ? null : Number(h.lon);
    // Sync verdict precedence:
    //   1. data_purged_at non-null → BLOCKED ('purged_pending_reonboard'),
    //      even if the authenticity probe later wrote 'authentic' (it
    //      shouldn't, since the cooldown blocks polling, but be explicit).
    //   2. last_authenticity_status in failure set → BLOCKED.
    //   3. No BMS config row at all → NEVER_SYNCED.
    //   4. last_sync_at null but has config → NEVER_SYNCED (onboarded but
    //      first cycle hasn't completed).
    //   5. Otherwise OK.
    const hasConfig = h.has_bms_config === true || h.has_bms_config === 1;
    const status = h.last_authenticity_status;
    let syncStatus: 'OK' | 'BLOCKED' | 'NEVER_SYNCED' = 'OK';
    let syncBlockedReason: string | null = null;
    if (h.data_purged_at) {
      syncStatus = 'BLOCKED';
      syncBlockedReason = 'purged_pending_reonboard';
    } else if (status && SYNC_FAILURE_STATUSES.has(status)) {
      syncStatus = 'BLOCKED';
      syncBlockedReason = status;
    } else if (!hasConfig) {
      syncStatus = 'NEVER_SYNCED';
    } else if (!h.last_sync_at) {
      syncStatus = 'NEVER_SYNCED';
    }
    hospitalMap.set(h.hcode, {
      hcode: h.hcode,
      name: h.name,
      level: h.level as HospitalLevel,
      connectionStatus: h.connection_status as ConnectionStatus,
      lastSyncAt: h.last_sync_at,
      provinceCode: h.province_code,
      districtCode: h.district_code,
      lat: lat !== null && Number.isFinite(lat) ? lat : null,
      lon: lon !== null && Number.isFinite(lon) ? lon : null,
      counts: { low: 0, medium: 0, high: 0, total: 0 },
      ancCounts: { total: 0, hr3: 0 },
      syncStatus,
      syncBlockedReason,
    });
  }

  // ANC registry counts — pregnancy-stage journeys per current hospital, with
  // HR3 broken out. Honors is_active via the JOIN on hospitals.
  const ancRows = await db.query<{
    hcode: string;
    total: number;
    hr3: number;
  }>(`
    SELECT h.hcode,
           COUNT(*) AS total,
           SUM(CASE WHEN mj.anc_risk_level = 'HR3' THEN 1 ELSE 0 END) AS hr3
    FROM maternal_journeys mj
    JOIN hospitals h ON h.id = mj.current_hospital_id
    WHERE h.is_active = true
      AND mj.care_stage = 'PREGNANCY'
    GROUP BY h.hcode
  `);
  for (const r of ancRows) {
    const hospital = hospitalMap.get(r.hcode);
    if (!hospital) continue;
    hospital.ancCounts.total = Number(r.total) || 0;
    hospital.ancCounts.hr3 = Number(r.hr3) || 0;
  }

  for (const row of counts) {
    const hospital = hospitalMap.get(row.hcode);
    if (!hospital || row.count === 0) continue;

    if (row.risk_level === 'LOW') hospital.counts.low += row.count;
    else if (row.risk_level === 'MEDIUM') hospital.counts.medium += row.count;
    else if (row.risk_level === 'HIGH') hospital.counts.high += row.count;

    // Patients without CPD scores count as total but not in any risk bucket
    hospital.counts.total += row.count;
  }

  const hospitalList = Array.from(hospitalMap.values());
  const summary = getSummaryTotals(hospitalList);

  return {
    hospitals: hospitalList,
    summary,
    updatedAt: new Date().toISOString(),
  };
}

export function getSummaryTotals(hospitals: DashboardHospital[]): DashboardSummary {
  let totalLow = 0;
  let totalMedium = 0;
  let totalHigh = 0;
  let totalActive = 0;

  for (const h of hospitals) {
    totalLow += h.counts.low;
    totalMedium += h.counts.medium;
    totalHigh += h.counts.high;
    totalActive += h.counts.total;
  }

  return { totalLow, totalMedium, totalHigh, totalActive };
}

interface HighRiskRow {
  an: string;
  hn: string;
  name: string;
  age: number | null;
  ga_weeks: number | null;
  cpd_score: number;
  risk_level: string;
  hospital_name: string;
  hcode: string;
  admit_date: string | null;
  last_vital_at: string | null;
  partograph_severity: string | null;
  partograph_alert_count: number | null;
}

export async function getHighRiskPatients(
  db: DatabaseAdapter,
  limit: number = 20,
): Promise<HighRiskPatient[]> {
  const rows = await db.query<HighRiskRow>(`
    SELECT
      cp.an,
      cp.hn,
      cp.name,
      cp.age,
      cp.ga_weeks,
      cs.score AS cpd_score,
      cs.risk_level,
      h.name AS hospital_name,
      h.hcode,
      cp.admit_date,
      cp.partograph_severity,
      cp.partograph_alert_count,
      (SELECT MAX(cv.measured_at) FROM cached_vital_signs cv WHERE cv.patient_id = cp.id) AS last_vital_at
    FROM cached_patients cp
    INNER JOIN cpd_scores cs ON cs.patient_id = cp.id
      AND cs.id = (
        SELECT cs2.id FROM cpd_scores cs2
        WHERE cs2.patient_id = cp.id
        ORDER BY cs2.calculated_at DESC LIMIT 1
      )
    INNER JOIN hospitals h ON h.id = cp.hospital_id
    WHERE cp.labor_status = 'ACTIVE'
      AND cs.risk_level IN ('HIGH', 'MEDIUM')
      AND h.is_active = true
    ORDER BY cs.score DESC
    LIMIT ?
  `, [limit]);

  return rows.map((row) => ({
    an: row.an,
    hn: row.hn,
    name: decryptSafe(row.name),
    age: row.age,
    gaWeeks: row.ga_weeks,
    cpdScore: row.cpd_score,
    riskLevel: row.risk_level,
    hospital: row.hospital_name,
    hcode: row.hcode,
    admitDate: row.admit_date,
    lastVitalAt: row.last_vital_at,
    partographSeverity: (row.partograph_severity as CdssSeverity | null) ?? null,
    partographAlertCount: row.partograph_alert_count ?? null,
  }));
}

export async function getHospitalPatientList(
  db: DatabaseAdapter,
  hcode: string,
  filters: {
    status?: string;
    riskLevel?: string;
    page?: number;
    perPage?: number;
    dateFrom?: string;
    dateTo?: string;
  } = {},
) {
  const { status = 'active', riskLevel, page = 1, perPage = 20, dateFrom, dateTo } = filters;
  const offset = (page - 1) * perPage;

  // Get hospital ID + meta. The detail page renders the hospital header
  // (name, level, connection status) from this response — without surfacing
  // these fields here, the page silently fell back to `รหัส ${hcode}` even
  // when the hospital exists.
  const hospitals = await db.query<{
    id: string;
    name: string;
    level: string;
    connection_status: string;
    last_sync_at: string | null;
  }>(
    'SELECT id, name, level, connection_status, last_sync_at FROM hospitals WHERE hcode = ?',
    [hcode],
  );
  if (hospitals.length === 0) {
    return {
      hospital: null,
      patients: [],
      pagination: { total: 0, page, perPage, totalPages: 0 },
    };
  }

  const hospitalRow = hospitals[0];
  const hospitalId = hospitalRow.id;
  const hospital = {
    name: hospitalRow.name,
    level: hospitalRow.level,
    connectionStatus: hospitalRow.connection_status,
    lastSyncAt: hospitalRow.last_sync_at,
  };

  let whereClause = 'WHERE cp.hospital_id = ?';
  const params: unknown[] = [hospitalId];

  if (status !== 'all') {
    whereClause += ' AND cp.labor_status = ?';
    params.push(status.toUpperCase());
  }

  if (dateFrom) {
    whereClause += ' AND cp.admit_date >= ?';
    params.push(dateFrom);
  }

  if (dateTo) {
    // Append T23:59:59.999Z to include the entire day when only a date string is provided
    const dateToValue = dateTo.length === 10 ? `${dateTo}T23:59:59.999Z` : dateTo;
    whereClause += ' AND cp.admit_date <= ?';
    params.push(dateToValue);
  }

  // Count total
  const countResult = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM cached_patients cp ${whereClause}`,
    params,
  );
  const total = countResult[0].count;

  // Get patients with latest CPD score. partograph_severity and
  // partograph_alert_count are written by upsertPartographObservations()
  // and surfaced here so the patient list can render a severity dot
  // without an extra fetch.
  const rows = await db.query<Record<string, unknown> & {
    partograph_severity: string | null;
    partograph_alert_count: number | null;
  }>(
    `SELECT cp.*,
      cp.partograph_severity,
      cp.partograph_alert_count,
      (SELECT cs.score FROM cpd_scores cs WHERE cs.patient_id = cp.id ORDER BY cs.calculated_at DESC LIMIT 1) as cpd_score,
      (SELECT cs.risk_level FROM cpd_scores cs WHERE cs.patient_id = cp.id ORDER BY cs.calculated_at DESC LIMIT 1) as cpd_risk_level,
      (SELECT cs.recommendation FROM cpd_scores cs WHERE cs.patient_id = cp.id ORDER BY cs.calculated_at DESC LIMIT 1) as cpd_recommendation
    FROM cached_patients cp
    ${whereClause}
    ORDER BY cp.admit_date DESC
    LIMIT ? OFFSET ?`,
    [...params, perPage, offset],
  );

  const patients = rows.map((r) => ({
    ...r,
    name: decryptSafe(typeof r.name === 'string' ? r.name : ''),
    partographSeverity: (r.partograph_severity as CdssSeverity | null) ?? null,
    partographAlertCount: r.partograph_alert_count ?? null,
  }));

  return {
    hospital,
    patients,
    pagination: {
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    },
  };
}

// T14: Stage KPIs — pregnancy/labor/delivered counts by risk level
export async function getStageKPIs(db: DatabaseAdapter): Promise<DashboardStageKPIs> {
  // Pregnancy counts by ANC risk level
  const pregnancyCounts = await db.query<{ anc_risk_level: string; count: number }>(
    `SELECT anc_risk_level, COUNT(*) as count FROM maternal_journeys
     WHERE care_stage = 'PREGNANCY'
       AND (hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL}
            OR current_hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL})
     GROUP BY anc_risk_level`,
  );

  const pregnancy = { total: 0, low: 0, hr1: 0, hr2: 0, hr3: 0 };
  for (const row of pregnancyCounts) {
    const c = Number(row.count);
    pregnancy.total += c;
    if (row.anc_risk_level === 'LOW') pregnancy.low = c;
    else if (row.anc_risk_level === 'HR1') pregnancy.hr1 = c;
    else if (row.anc_risk_level === 'HR2') pregnancy.hr2 = c;
    else if (row.anc_risk_level === 'HR3') pregnancy.hr3 = c;
  }

  // Labor counts by CPD risk level (from existing cpd_scores)
  const laborCounts = await db.query<{ risk_level: string; count: number }>(
    `SELECT cs.risk_level, COUNT(*) as count
     FROM cached_patients cp
     JOIN cpd_scores cs ON cs.patient_id = cp.id
       AND cs.id = (SELECT cs2.id FROM cpd_scores cs2 WHERE cs2.patient_id = cp.id ORDER BY cs2.calculated_at DESC LIMIT 1)
     WHERE cp.labor_status = 'ACTIVE'
       AND cp.hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL}
     GROUP BY cs.risk_level`,
  );

  const labor = { total: 0, low: 0, medium: 0, high: 0 };
  for (const row of laborCounts) {
    const c = Number(row.count);
    labor.total += c;
    if (row.risk_level === 'LOW') labor.low = c;
    else if (row.risk_level === 'MEDIUM') labor.medium = c;
    else if (row.risk_level === 'HIGH') labor.high = c;
  }

  // Delivered counts (this month) with outcome flags
  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);
  firstOfMonth.setHours(0, 0, 0, 0);
  const monthStart = firstOfMonth.toISOString();

  const deliveredRows = await db.query<{ total: number; abnormal: number; low_apgar: number; lbw: number }>(
    `SELECT COUNT(*) as total,
            SUM(CASE WHEN cn.apgar_1min < 7 OR cn.birth_weight_g < 2500 THEN 1 ELSE 0 END) as abnormal,
            SUM(CASE WHEN cn.apgar_1min < 7 THEN 1 ELSE 0 END) as low_apgar,
            SUM(CASE WHEN cn.birth_weight_g < 2500 THEN 1 ELSE 0 END) as lbw
     FROM cached_newborns cn
     JOIN maternal_journeys mj ON mj.id = cn.journey_id
     WHERE mj.care_stage = 'DELIVERED'
       AND cn.born_at >= ?
       AND (mj.hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL}
            OR mj.current_hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL})`,
    [monthStart],
  );

  const dr = deliveredRows[0] || { total: 0, abnormal: 0, low_apgar: 0, lbw: 0 };
  const totalDelivered = Number(dr.total) || 0;
  const abnormal = Number(dr.abnormal) || 0;
  const lowApgar = Number(dr.low_apgar) || 0;
  const lbw = Number(dr.lbw) || 0;

  return {
    pregnancy,
    labor,
    delivered: {
      total: totalDelivered,
      normal: totalDelivered - abnormal,
      lowApgar,
      lbw,
    },
  };
}

// T14: Dashboard alerts — referral alerts, overdue ANC, in-transit referrals
export async function getDashboardAlerts(db: DatabaseAdapter): Promise<DashboardAlerts> {
  // Referral alerts: pending referrals (INITIATED or ACCEPTED)
  const refAlerts = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM cached_referrals
     WHERE status IN ('INITIATED', 'ACCEPTED')
       AND (from_hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL}
            OR to_hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL})`,
  );

  // Overdue ANC: pregnancies where last_anc_date is > 28 days ago
  // Uses date string comparison — works in both SQLite and PostgreSQL
  const twentyEightDaysAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();
  const overdueAnc = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM maternal_journeys
     WHERE care_stage = 'PREGNANCY'
       AND last_anc_date IS NOT NULL
       AND last_anc_date < ?
       AND (hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL}
            OR current_hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL})`,
    [twentyEightDaysAgo],
  );

  // In-transit referrals
  const inTransit = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM cached_referrals
     WHERE status = 'IN_TRANSIT'
       AND (from_hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL}
            OR to_hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL})`,
  );

  return {
    referralAlerts: Number(refAlerts[0]?.count) || 0,
    overdueAnc: Number(overdueAnc[0]?.count) || 0,
    inTransitReferrals: Number(inTransit[0]?.count) || 0,
  };
}

// ─── Trends ─────────────────────────────────────────────────────────────
// Temporal signals for the redesigned dashboard (2026-04-21 brief §5):
// 24h admission pulse, admissions today vs. 7-day average, new admits by
// risk tier, and current/previous shift counts.
//
// SQL stays cross-dialect (SQLite + PostgreSQL) by passing ISO strings and
// doing hourly bucketing in JS rather than relying on strftime/EXTRACT.

const BANGKOK_TZ = 'Asia/Bangkok';

/**
 * Returns the Bangkok hour boundary at or before the given instant.
 * Example: 2026-04-21T15:42:07+07:00 → 2026-04-21T15:00:00+07:00.
 */
function bangkokHourFloor(date: Date): Date {
  const d = new Date(date);
  d.setUTCMilliseconds(0);
  d.setUTCSeconds(0);
  d.setUTCMinutes(0);
  // Round DOWN in Bangkok tz; since offset is fixed +07:00, an hour in UTC
  // aligns with an hour in Bangkok.
  return d;
}

/** Returns the start of today in Asia/Bangkok, expressed as UTC. */
function bangkokStartOfToday(now: Date = new Date()): Date {
  // Bangkok is UTC+7, no DST. Compute by shifting now() forward 7h, taking
  // the UTC date at that shifted point, and then shifting back.
  const shifted = new Date(now.getTime() + 7 * 3600 * 1000);
  const shiftedMidnightUtc = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
  );
  return new Date(shiftedMidnightUtc.getTime() - 7 * 3600 * 1000);
}

/** Returns the Bangkok hour-of-day (0–23) for an ISO timestamp. */
function bangkokHourOfDay(iso: string): number {
  const d = new Date(iso);
  // Bangkok UTC+7, no DST.
  return (d.getUTCHours() + 7) % 24;
}

interface ShiftWindow {
  label: string;
  windowStart: Date;
  windowEnd: Date;
}

/**
 * Resolves the current + previous hospital shift windows based on Bangkok time.
 * Thai hospital convention: เวรเช้า 07:00–15:00, เวรบ่าย 15:00–22:00,
 * เวรดึก 22:00–07:00 (spans midnight).
 */
function resolveShifts(now: Date = new Date()): { current: ShiftWindow; previous: ShiftWindow } {
  // Determine Bangkok-local time components from the UTC instant.
  const bkk = new Date(now.getTime() + 7 * 3600 * 1000);
  const bkkHour = bkk.getUTCHours();
  const bkkDate = new Date(
    Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate()),
  );

  // Build candidate windows around today (and yesterday, for previous).
  const mkWindow = (dayOffset: number, startH: number, endH: number, label: string): ShiftWindow => {
    const start = new Date(bkkDate.getTime() + dayOffset * 86400_000 + startH * 3600_000 - 7 * 3600_000);
    const end = new Date(bkkDate.getTime() + dayOffset * 86400_000 + endH * 3600_000 - 7 * 3600_000);
    return { label, windowStart: start, windowEnd: end };
  };

  // Shifts for "today" and flanking days.
  const yest = {
    morning: mkWindow(-1, 7, 15, 'เวรเช้า 07:00-15:00'),
    afternoon: mkWindow(-1, 15, 22, 'เวรบ่าย 15:00-22:00'),
    night: mkWindow(-1, 22, 24 + 7, 'เวรดึก 22:00-07:00'),
  };
  const today = {
    morning: mkWindow(0, 7, 15, 'เวรเช้า 07:00-15:00'),
    afternoon: mkWindow(0, 15, 22, 'เวรบ่าย 15:00-22:00'),
    night: mkWindow(0, 22, 24 + 7, 'เวรดึก 22:00-07:00'),
  };

  // Current shift picker.
  let current: ShiftWindow;
  let previous: ShiftWindow;
  if (bkkHour >= 7 && bkkHour < 15) {
    current = today.morning;
    previous = yest.night;
  } else if (bkkHour >= 15 && bkkHour < 22) {
    current = today.afternoon;
    previous = today.morning;
  } else if (bkkHour >= 22) {
    current = today.night;
    previous = today.afternoon;
  } else {
    // 00:00–07:00 is the tail of last night's เวรดึก (which started yesterday 22:00).
    current = yest.night;
    previous = yest.afternoon;
  }
  return { current, previous };
}

async function countAdmitsInWindow(
  db: DatabaseAdapter,
  startIso: string,
  endIso: string,
): Promise<number> {
  const r = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM cached_patients
     WHERE admit_date >= ? AND admit_date < ?
       AND hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL}`,
    [startIso, endIso],
  );
  return Number(r[0]?.count) || 0;
}

async function countDeliveredInWindow(
  db: DatabaseAdapter,
  startIso: string,
  endIso: string,
): Promise<number> {
  const r = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM cached_patients
     WHERE delivered_at IS NOT NULL AND delivered_at >= ? AND delivered_at < ?
       AND hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL}`,
    [startIso, endIso],
  );
  return Number(r[0]?.count) || 0;
}

async function countReferralsInWindow(
  db: DatabaseAdapter,
  startIso: string,
  endIso: string,
): Promise<number> {
  // cached_referrals stores the initial dispatch at `initiated_at` (the
  // moment a hospital starts the referral). Count referrals initiated
  // within the window as the "referred this shift" signal.
  const r = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM cached_referrals
     WHERE initiated_at IS NOT NULL AND initiated_at >= ? AND initiated_at < ?
       AND (from_hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL}
            OR to_hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL})`,
    [startIso, endIso],
  );
  return Number(r[0]?.count) || 0;
}

export async function getTrends(
  db: DatabaseAdapter,
  now: Date = new Date(),
): Promise<DashboardTrends> {
  // ─── 24h admission pulse (hourly) ────────────────────────────────────
  const nowHour = bangkokHourFloor(now);
  const start24h = new Date(nowHour.getTime() - 23 * 3600_000);
  const admitsLast24h = await db.query<{ admit_date: string }>(
    `SELECT admit_date FROM cached_patients
     WHERE admit_date >= ?
       AND hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL}`,
    [start24h.toISOString()],
  );
  const bucket = Array<number>(24).fill(0);
  for (const row of admitsLast24h) {
    if (!row.admit_date) continue;
    const d = new Date(row.admit_date);
    const hoursAgo = Math.floor((nowHour.getTime() - bangkokHourFloor(d).getTime()) / 3600_000);
    const idx = 23 - hoursAgo;
    if (idx >= 0 && idx < 24) bucket[idx] += 1;
  }

  // ─── Today vs 7-day avg ──────────────────────────────────────────────
  const startToday = bangkokStartOfToday(now);
  const start7d = new Date(startToday.getTime() - 7 * 86400_000);
  const admissionsToday = await countAdmitsInWindow(
    db,
    startToday.toISOString(),
    now.toISOString(),
  );
  const admissions7d = await countAdmitsInWindow(
    db,
    start7d.toISOString(),
    startToday.toISOString(),
  );
  const admissions7dAvg = Math.round((admissions7d / 7) * 10) / 10;

  // ─── New admits by current risk tier (last 24h) ─────────────────────
  const newByRiskRows = await db.query<{ risk_level: string | null; count: number }>(
    `SELECT
       (SELECT cs.risk_level FROM cpd_scores cs
        WHERE cs.patient_id = cp.id
        ORDER BY cs.calculated_at DESC LIMIT 1) as risk_level,
       COUNT(*) as count
     FROM cached_patients cp
     WHERE cp.admit_date >= ?
       AND cp.hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL}
     GROUP BY risk_level`,
    [start24h.toISOString()],
  );
  const newByRisk24h = { high: 0, medium: 0, low: 0, total: 0 };
  for (const row of newByRiskRows) {
    const c = Number(row.count) || 0;
    newByRisk24h.total += c;
    if (row.risk_level === 'HIGH') newByRisk24h.high += c;
    else if (row.risk_level === 'MEDIUM') newByRisk24h.medium += c;
    else if (row.risk_level === 'LOW') newByRisk24h.low += c;
  }

  // ─── Current + previous shift counts ────────────────────────────────
  const shifts = resolveShifts(now);
  const toStats = async (w: ShiftWindow, clampEndAtNow: boolean): Promise<ShiftStats> => {
    const endCap = clampEndAtNow && w.windowEnd > now ? now : w.windowEnd;
    const startIso = w.windowStart.toISOString();
    const endIso = endCap.toISOString();
    const [admissions, delivered, referred] = await Promise.all([
      countAdmitsInWindow(db, startIso, endIso),
      countDeliveredInWindow(db, startIso, endIso),
      countReferralsInWindow(db, startIso, endIso),
    ]);
    return {
      label: w.label,
      windowStart: startIso,
      windowEnd: endCap.toISOString(),
      admissions,
      delivered,
      referred,
    };
  };
  const [currentShift, previousShift] = await Promise.all([
    toStats(shifts.current, true),
    toStats(shifts.previous, false),
  ]);

  return {
    admissions24h: bucket,
    admissionsToday,
    admissions7dAvg,
    newByRisk24h,
    currentShift,
    previousShift,
  };
}
