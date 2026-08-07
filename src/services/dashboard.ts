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
import { PARTOGRAPH_QUALITY } from '@/config/hospital-network';
import { bangkokStartOfMonth, bangkokStartOfToday } from '@/lib/bangkok-time';
import { referralSlaCutoffs } from '@/config/referral-sla';
import { ancOpsCutoffs } from '@/config/anc-ops';
import { ancFreshnessCutoffs, ANC_MAX_GA_WEEKS } from '@/config/anc-freshness';
import { toIsoString } from '@/lib/dates';
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
import { getHospitalCapability } from '@/config/hospital-capabilities';
import { ANC_RISK_LEVEL_ORDER } from '@/config/anc-risk-rules';
import { AncRiskLevel } from '@/types/domain';
import { isMaternalScreenUiEnabled } from '@/lib/feature-flags';
import type { MaternalScreenLocalTier, MaternalEmergencyAcuity } from '@/types/maternal-screening';
import type { MaternalScreenSummaryItem } from '@/types/api';

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
      lastSyncAt: h.last_sync_at ? new Date(h.last_sync_at).toISOString() : null,
      provinceCode: h.province_code,
      districtCode: h.district_code,
      lat: lat !== null && Number.isFinite(lat) ? lat : null,
      lon: lon !== null && Number.isFinite(lon) ? lon : null,
      counts: { low: 0, medium: 0, high: 0, total: 0 },
      ancCounts: { total: 0, hr3: 0 },
      partographQuality: { laborRecent: 0, withPartograph: 0 },
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

  // Partograph coverage — labor admissions inside the quality window vs how
  // many have at least one charted observation. Cutoff computed in JS and
  // bound as an ISO param (portable across PG + SQLite).
  const partoCutoff = new Date(
    Date.now() - PARTOGRAPH_QUALITY.windowDays * 86_400_000,
  ).toISOString();
  const partoRows = await db.query<{
    hcode: string;
    labor_recent: number;
    with_partograph: number;
  }>(
    `SELECT h.hcode,
            COUNT(*) AS labor_recent,
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM cached_partograph_observations o WHERE o.patient_id = cp.id
            ) THEN 1 ELSE 0 END) AS with_partograph
       FROM cached_patients cp
       JOIN hospitals h ON h.id = cp.hospital_id
      WHERE h.is_active = true AND cp.admit_date >= ?
      GROUP BY h.hcode`,
    [partoCutoff],
  );
  for (const r of partoRows) {
    const hospital = hospitalMap.get(r.hcode);
    if (!hospital) continue;
    hospital.partographQuality.laborRecent = Number(r.labor_recent) || 0;
    hospital.partographQuality.withPartograph = Number(r.with_partograph) || 0;
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
  maternal_screen_local_tier: string | null;
  maternal_screen_emergency_acuity: string | null;
  maternal_screen_is_complete: boolean | null;
  maternal_screen_assessed_at: string | Date | null;
}

/** Raw `cached_patients.maternal_screen_*` values, keyed the same regardless
 *  of source row shape (HighRiskRow columns vs the `SELECT cp.*` spread in
 *  getHospitalPatientList). */
interface MaternalScreenRawFields {
  maternal_screen_local_tier: string | null;
  maternal_screen_emergency_acuity: string | null;
  maternal_screen_is_complete: boolean | null;
  maternal_screen_assessed_at: string | Date | null;
}

interface MaternalScreenProjectedFields {
  maternalScreenLocalTier: MaternalScreenLocalTier | null;
  maternalScreenEmergencyAcuity: MaternalEmergencyAcuity | null;
  maternalScreenIsComplete: boolean | null;
  maternalScreenAssessedAt: string | null;
}

/**
 * GC-W3: server-side flag gate for the maternal-screen axes carried on the
 * cached-path list projections (getHighRiskPatients, getHospitalPatientList
 * — the exact same `cached_patients` columns `partograph_severity` flows
 * through today). `uiEnabled` MUST be resolved once per request by the
 * caller and passed in here — not re-read per row — so a single request
 * can't observe the flag flip mid-response.
 *
 * GC3: `maternal_screen_*` is a distinct vocabulary from
 * `partographSeverity`/`CdssSeverity` — DB values are raw strings, narrowed
 * with an `as` cast (same convention as `partograph_severity` above); an
 * out-of-vocabulary value is passed through as-is rather than thrown on —
 * the UI fallback token handles it (see src/config/maternal-screen-display.ts).
 */
function projectMaternalScreenFields(
  uiEnabled: boolean,
  row: MaternalScreenRawFields,
): MaternalScreenProjectedFields {
  if (!uiEnabled) {
    return {
      maternalScreenLocalTier: null,
      maternalScreenEmergencyAcuity: null,
      maternalScreenIsComplete: null,
      maternalScreenAssessedAt: null,
    };
  }
  return {
    maternalScreenLocalTier:
      (row.maternal_screen_local_tier as MaternalScreenLocalTier | null) ?? null,
    maternalScreenEmergencyAcuity:
      (row.maternal_screen_emergency_acuity as MaternalEmergencyAcuity | null) ?? null,
    maternalScreenIsComplete: row.maternal_screen_is_complete ?? null,
    // pg returns timestamptz columns as Date objects, SQLite/PGlite as
    // strings — toIsoString normalizes both and returns null (not a throw)
    // on an unparseable value, per the service-mapper convention.
    maternalScreenAssessedAt: toIsoString(row.maternal_screen_assessed_at),
  };
}

export async function getHighRiskPatients(
  db: DatabaseAdapter,
  // Safety cap only — the panel's "ALL ACTIVE" tab promises the COMPLETE
  // province labor roster, so the cap must sit far above any real census
  // (historical peak 34–39 concurrent; stale-ACTIVE incidents inflate it
  // further). At 50 it silently truncated the roster the panel claims to
  // show in full.
  limit: number = 500,
): Promise<HighRiskPatient[]> {
  // Flag read once per request (GC-W3), not per row.
  const maternalScreenUiEnabled = isMaternalScreenUiEnabled();

  // The province-wide ACTIVE labor roster, high risk first. LEFT JOIN, not
  // INNER: the panel's "ALL ACTIVE" tab must show LOW-risk and not-yet-scored
  // women too — the old HIGH/MEDIUM pre-filter meant "all active" showed one
  // patient on a calm ward and silently hid unscored admissions.
  const rows = await db.query<HighRiskRow>(
    `
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
      cp.maternal_screen_local_tier,
      cp.maternal_screen_emergency_acuity,
      cp.maternal_screen_is_complete,
      cp.maternal_screen_assessed_at,
      (SELECT MAX(cv.measured_at) FROM cached_vital_signs cv WHERE cv.patient_id = cp.id) AS last_vital_at
    FROM cached_patients cp
    LEFT JOIN cpd_scores cs ON cs.id = (
        SELECT cs2.id FROM cpd_scores cs2
        WHERE cs2.patient_id = cp.id
        ORDER BY cs2.calculated_at DESC LIMIT 1
      )
    INNER JOIN hospitals h ON h.id = cp.hospital_id
    WHERE cp.labor_status = 'ACTIVE'
      AND h.is_active = true
    ORDER BY CASE WHEN cs.score IS NULL THEN 1 ELSE 0 END, cs.score DESC
    LIMIT ?
  `,
    [limit],
  );

  return rows.map((row) => ({
    an: row.an,
    hn: row.hn,
    name: decryptSafe(row.name),
    age: row.age,
    gaWeeks: row.ga_weeks,
    cpdScore: row.cpd_score == null ? 0 : Number(row.cpd_score),
    riskLevel: row.risk_level ?? 'UNSCORED',
    hospital: row.hospital_name,
    hcode: row.hcode,
    // pg returns timestamptz columns as Date objects, SQLite as strings —
    // normalize to ISO so the API shape stays a string as declared.
    admitDate: row.admit_date == null ? null : new Date(row.admit_date).toISOString(),
    lastVitalAt: row.last_vital_at == null ? null : new Date(row.last_vital_at).toISOString(),
    partographSeverity: (row.partograph_severity as CdssSeverity | null) ?? null,
    partographAlertCount: row.partograph_alert_count ?? null,
    ...projectMaternalScreenFields(maternalScreenUiEnabled, row),
  }));
}

export interface PartographAuditAdmission {
  an: string;
  name: string;
  admitDate: string;
  laborStatus: string;
  observationCount: number;
  lastObservedAt: string | null;
}

export interface HospitalPartographAudit {
  windowDays: number;
  laborRecent: number;
  withPartograph: number;
  /** Window admissions, never-charted first (they are the action items). */
  admissions: PartographAuditAdmission[];
}

/**
 * Per-hospital partograph charting audit — every labor admission inside the
 * PARTOGRAPH_QUALITY window with its observation count, so the provincial
 * team can name the specific uncharted cases, not just the coverage score.
 * Returns null for an unknown hcode.
 */
export async function getHospitalPartographAudit(
  db: DatabaseAdapter,
  hcode: string,
): Promise<HospitalPartographAudit | null> {
  const hospitals = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [
    hcode,
  ]);
  if (hospitals.length === 0) return null;

  const cutoff = new Date(Date.now() - PARTOGRAPH_QUALITY.windowDays * 86_400_000).toISOString();
  const rows = await db.query<{
    an: string;
    name: string;
    admit_date: string;
    labor_status: string;
    obs_count: number;
    last_observed_at: string | null;
  }>(
    `SELECT cp.an, cp.name, cp.admit_date, cp.labor_status,
            (SELECT COUNT(*) FROM cached_partograph_observations o
              WHERE o.patient_id = cp.id) AS obs_count,
            (SELECT MAX(o.observe_datetime) FROM cached_partograph_observations o
              WHERE o.patient_id = cp.id) AS last_observed_at
       FROM cached_patients cp
      WHERE cp.hospital_id = ? AND cp.admit_date >= ?`,
    [hospitals[0].id, cutoff],
  );

  const admissions: PartographAuditAdmission[] = rows
    .map((r) => ({
      an: r.an,
      name: decryptSafe(r.name),
      // pg returns timestamptz columns as Date objects, SQLite as strings —
      // normalize to ISO so the API shape (and the sort below) is stable.
      // .localeCompare on the raw value 500'd this route in production.
      admitDate: new Date(r.admit_date).toISOString(),
      laborStatus: r.labor_status,
      observationCount: Number(r.obs_count) || 0,
      lastObservedAt:
        r.last_observed_at == null ? null : new Date(r.last_observed_at).toISOString(),
    }))
    .sort((a, b) => {
      const aCharted = a.observationCount > 0 ? 1 : 0;
      const bCharted = b.observationCount > 0 ? 1 : 0;
      if (aCharted !== bCharted) return aCharted - bCharted;
      return new Date(b.admitDate).getTime() - new Date(a.admitDate).getTime();
    });

  return {
    windowDays: PARTOGRAPH_QUALITY.windowDays,
    laborRecent: admissions.length,
    withPartograph: admissions.filter((a) => a.observationCount > 0).length,
    admissions,
  };
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
  }>('SELECT id, name, level, connection_status, last_sync_at FROM hospitals WHERE hcode = ?', [
    hcode,
  ]);
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
    // pg returns timestamptz as a Date object — normalize to the declared
    // ISO-string API shape (same pattern as getProvinceDashboard above).
    lastSyncAt: hospitalRow.last_sync_at ? new Date(hospitalRow.last_sync_at).toISOString() : null,
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
  const rows = await db.query<
    Record<string, unknown> & {
      partograph_severity: string | null;
      partograph_alert_count: number | null;
      maternal_screen_local_tier: string | null;
      maternal_screen_emergency_acuity: string | null;
      maternal_screen_is_complete: boolean | null;
      maternal_screen_assessed_at: string | Date | null;
    }
  >(
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

  // Flag read once per request (GC-W3), not per row.
  const maternalScreenUiEnabled = isMaternalScreenUiEnabled();

  const patients = rows.map((r) => {
    const projected = projectMaternalScreenFields(maternalScreenUiEnabled, {
      maternal_screen_local_tier: r.maternal_screen_local_tier,
      maternal_screen_emergency_acuity: r.maternal_screen_emergency_acuity,
      maternal_screen_is_complete: r.maternal_screen_is_complete,
      maternal_screen_assessed_at: r.maternal_screen_assessed_at,
    });

    // Leak fix (GC-W3): `cp.*` above pulls in every raw snake_case
    // maternal_screen_* column untyped, regardless of the UI flag. Strip
    // all six always — the typed camelCase fields from `projected` are the
    // only supported way to read this data from this response. Widened to
    // Record<string, unknown> (dropping the row type's explicit non-optional
    // maternal_screen_* fields) so `delete` is valid under TS 4.4+'s
    // "operand of delete must be optional" rule.
    const rest: Record<string, unknown> = { ...r };
    // Prefix loop, not a name list: a future maternal_screen_* column added
    // to cached_patients must not silently start leaking through cp.*.
    for (const key of Object.keys(rest)) {
      if (key.startsWith('maternal_screen_')) delete rest[key];
    }

    return {
      ...rest,
      name: decryptSafe(typeof r.name === 'string' ? r.name : ''),
      partographSeverity: (r.partograph_severity as CdssSeverity | null) ?? null,
      partographAlertCount: r.partograph_alert_count ?? null,
      ...projected,
    };
  });

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

/**
 * Phase 6 Task H4 (docs/superpowers/plans/2026-07-17-maternal-screening-hosxp.md,
 * GC-H4) — per-AN maternal-screen summaries for one hospital's ACTIVE labor
 * roster. Powers the ward-bed-tile cross-source join: the ward page's
 * occupancy comes from LIVE HOSxP (BMS Session API), never this central DB,
 * so the join happens client-side by `an` against this lean summary list.
 *
 * Lean sibling of `getHospitalPatientList` above — same
 * `cached_patients JOIN hospitals WHERE hcode = ? AND labor_status = 'ACTIVE'`
 * shape, but selects only the `an` + the four `maternal_screen_*` columns
 * (no pagination, no CPD/partograph fields) since the caller only needs an
 * `an → summary` lookup, not a patient list.
 *
 * GC-H4 flag gate: returns `[]` when `isMaternalScreenUiEnabled()` is false,
 * mirroring `projectMaternalScreenFields`'s server-side null-out above — a
 * flag-off hospital never has screening rows to join onto its bed tiles.
 *
 * Only rows with at least one non-null axis are returned (WHERE tier OR
 * acuity IS NOT NULL) — an ACTIVE admission with no assessment yet has
 * nothing to render as a pill, so it's excluded rather than returned as an
 * all-null summary the caller would have to filter anyway.
 */
export async function listMaternalScreenSummariesForHospital(
  db: DatabaseAdapter,
  hcode: string,
): Promise<MaternalScreenSummaryItem[]> {
  if (!isMaternalScreenUiEnabled()) return [];

  const rows = await db.query<{
    an: string;
    maternal_screen_local_tier: string | null;
    maternal_screen_emergency_acuity: string | null;
    maternal_screen_is_complete: boolean | null;
    maternal_screen_assessed_at: string | Date | null;
  }>(
    `SELECT cp.an,
            cp.maternal_screen_local_tier,
            cp.maternal_screen_emergency_acuity,
            cp.maternal_screen_is_complete,
            cp.maternal_screen_assessed_at
       FROM cached_patients cp
       JOIN hospitals h ON h.id = cp.hospital_id
      WHERE h.hcode = ?
        AND cp.labor_status = 'ACTIVE'
        AND (cp.maternal_screen_local_tier IS NOT NULL
             OR cp.maternal_screen_emergency_acuity IS NOT NULL)`,
    [hcode],
  );

  // Same raw-string cast + toIsoString normalization convention as
  // projectMaternalScreenFields above (GC3: out-of-vocabulary values pass
  // through as-is; the display-token layer's TOKEN[v] ?? FALLBACK handles it).
  return rows.map((r) => ({
    an: r.an,
    localTier: (r.maternal_screen_local_tier as MaternalScreenLocalTier | null) ?? null,
    emergencyAcuity: (r.maternal_screen_emergency_acuity as MaternalEmergencyAcuity | null) ?? null,
    isComplete: r.maternal_screen_is_complete ?? null,
    assessedAt: toIsoString(r.maternal_screen_assessed_at),
  }));
}

// T14: Stage KPIs — pregnancy/labor/delivered counts by risk level
export async function getStageKPIs(db: DatabaseAdapter): Promise<DashboardStageKPIs> {
  // Pregnancy counts by ANC risk level — over the SAME freshness-gated
  // registry as the /pregnancies board and the alert bar, so the stage card
  // and the board it links to can never show different totals (raw
  // care_stage='PREGNANCY' includes lost-to-follow-up and silently-delivered
  // rows the boards exclude).
  const { edcOnOrAfter, lastAncOnOrAfter } = ancFreshnessCutoffs(new Date());
  const pregnancyCounts = await db.query<{ anc_risk_level: string; count: number }>(
    `SELECT anc_risk_level, COUNT(*) as count FROM maternal_journeys
     WHERE care_stage = 'PREGNANCY'
       AND (ga_weeks IS NULL OR ga_weeks <= ${ANC_MAX_GA_WEEKS})
       AND (edc IS NULL OR edc >= ?)
       AND (last_anc_date IS NULL OR last_anc_date >= ?)
       AND (hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL}
            OR current_hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL})
     GROUP BY anc_risk_level`,
    [edcOnOrAfter, lastAncOnOrAfter],
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
  // Bangkok month boundary — consistent with the outcomes board (the old
  // server-local setHours(0,0,0,0) drifted from every other monthly figure).
  const monthStart = bangkokStartOfMonth().toISOString();

  // Total comes from journeys: newborn records lag the journey transition
  // (they arrive via the labour_infant sync), so a delivered card keyed only
  // on cached_newborns reads 0 while deliveries are demonstrably happening.
  const deliveredJourneyRows = await db.query<{ total: number }>(
    `SELECT COUNT(*) as total FROM maternal_journeys mj
     WHERE mj.care_stage = 'DELIVERED'
       AND mj.stage_changed_at >= ?
       AND (mj.hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL}
            OR mj.current_hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL})`,
    [monthStart],
  );

  const deliveredRows = await db.query<{
    total: number;
    abnormal: number;
    low_apgar: number;
    lbw: number;
  }>(
    // Low-Apgar uses the 5-minute score (the standard neonatal predictor), the
    // same column as getNewbornKPIs / the outcomes "LOW APGAR" tile — keep both
    // in sync so the dashboard and outcomes page report the same count.
    `SELECT COUNT(*) as total,
            SUM(CASE WHEN cn.apgar_5min < 7 OR cn.birth_weight_g < 2500 THEN 1 ELSE 0 END) as abnormal,
            SUM(CASE WHEN cn.apgar_5min < 7 THEN 1 ELSE 0 END) as low_apgar,
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
  const newbornTotal = Number(dr.total) || 0;
  const journeyTotal = Number(deliveredJourneyRows[0]?.total) || 0;
  // Journeys lead, newborn records refine — take whichever is larger so the
  // card is never zero while deliveries exist, and never below the infant
  // count for multiple births.
  const totalDelivered = Math.max(journeyTotal, newbornTotal);
  const abnormal = Number(dr.abnormal) || 0;
  const lowApgar = Number(dr.low_apgar) || 0;
  const lbw = Number(dr.lbw) || 0;

  return {
    pregnancy,
    labor,
    delivered: {
      total: totalDelivered,
      normal: Math.max(totalDelivered - abnormal, 0),
      lowApgar,
      lbw,
    },
  };
}

// T14: Dashboard alerts — recalibrated 2026-07-09. Every cell must be a
// number that can actually move: the old definitions ("all pending
// referrals" = permanently ~125, ungated 28-day ANC rule = 817 vs the
// boards' 138, in-transit = eternally 0) trained users to ignore the ribbon.
// Thresholds come from the same configs the boards use so the dashboard and
// the drill-down pages can never disagree.
export async function getDashboardAlerts(
  db: DatabaseAdapter,
  now: Date = new Date(),
): Promise<DashboardAlerts> {
  const { overdueBefore } = referralSlaCutoffs(now);
  const { staleBefore, dueSoonBefore } = ancOpsCutoffs(now);
  const { edcOnOrAfter, lastAncOnOrAfter } = ancFreshnessCutoffs(now);

  // Actionable referrals: past-SLA INITIATED or active EMERGENCY.
  const refAlerts = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM cached_referrals
     WHERE ((status = 'INITIATED' AND initiated_at < ?)
         OR (urgency_level = 'EMERGENCY' AND status NOT IN ('ARRIVED', 'REJECTED')))
       AND (from_hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL}
            OR to_hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL})`,
    [overdueBefore],
  );

  // Both ANC alerts run over the same gated registry as the pregnancies
  // board (GA ≤ 42, EDC within grace, last visit within the LTFU window).
  const gatedAnc = `care_stage = 'PREGNANCY'
       AND (ga_weeks IS NULL OR ga_weeks <= ${ANC_MAX_GA_WEEKS})
       AND (edc IS NULL OR edc >= ?)
       AND (last_anc_date IS NULL OR last_anc_date >= ?)
       AND (hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL}
            OR current_hospital_id IN ${ACTIVE_HOSPITAL_IDS_SQL})`;

  const overdueAnc = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM maternal_journeys
     WHERE ${gatedAnc}
       AND last_anc_date IS NOT NULL
       AND last_anc_date < ?`,
    [edcOnOrAfter, lastAncOnOrAfter, staleBefore],
  );

  const dueSoon = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM maternal_journeys
     WHERE ${gatedAnc}
       AND edc IS NOT NULL
       AND edc <= ?`,
    [edcOnOrAfter, lastAncOnOrAfter, dueSoonBefore],
  );

  return {
    referralAlerts: Number(refAlerts[0]?.count) || 0,
    overdueAnc: Number(overdueAnc[0]?.count) || 0,
    dueSoon: Number(dueSoon[0]?.count) || 0,
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

// bangkokStartOfToday moved to src/lib/bangkok-time.ts (shared with the
// referral list service).

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
  const bkkDate = new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate()));

  // Build candidate windows around today (and yesterday, for previous).
  const mkWindow = (
    dayOffset: number,
    startH: number,
    endH: number,
    label: string,
  ): ShiftWindow => {
    const start = new Date(
      bkkDate.getTime() + dayOffset * 86400_000 + startH * 3600_000 - 7 * 3600_000,
    );
    const end = new Date(
      bkkDate.getTime() + dayOffset * 86400_000 + endH * 3600_000 - 7 * 3600_000,
    );
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

// ─── Incoming-term-pregnancy pipeline ─────────────────────────────────────
//
// From the hub's perspective: which pregnancies currently held at spoke
// hospitals will eventually need to deliver here? A spoke must refer up when
// any of GA / fetal weight / risk-level exceeds its capability tier
// (see src/config/hospital-capabilities.ts). We resolve the referral chain
// transitively — a F2-small case that would land at F2-mid first, but
// F2-mid also can't handle it, ultimately lands at the hub.
//
// The Khon Kaen hub (hcode 10670) accepts everything, so once a chain
// reaches it the journey is "incoming."

export interface IncomingTermPregnancy {
  id: string;
  hn: string;
  name: string;
  age: number;
  gravida: number;
  para: number;
  gaWeeks: number | null;
  efwG: number | null;
  edc: string | null;
  ancRiskLevel: string;
  ancVisitCount: number;
  fromHcode: string;
  fromHospitalName: string;
  daysToEdc: number | null;
  // Whether the refer-up is driven by GA / FW / risk
  triggers: Array<'GA' | 'FW' | 'RISK'>;
}

// Walk the referTo chain until we find a hospital that can handle the case
// (no trigger fires) or we hit a terminal (referTo === null). Returns the
// hcode of the hospital where the journey will ultimately land.
function resolveDestinationHcode(
  spokeHcode: string,
  gaWeeks: number,
  efwG: number | null,
  riskLevel: AncRiskLevel,
): { destination: string | null; triggersAtSpoke: Array<'GA' | 'FW' | 'RISK'> } {
  let current = spokeHcode;
  const triggersAtSpoke: Array<'GA' | 'FW' | 'RISK'> = [];
  // Cap at 6 hops — config chains are at most 3 deep; cap defends against
  // accidental cycles if the table is ever edited badly.
  for (let i = 0; i < 6; i++) {
    const cap = getHospitalCapability(current);
    if (!cap) return { destination: null, triggersAtSpoke };
    const exceedsGa = gaWeeks < cap.minGaWeeks;
    const exceedsFw = efwG != null && efwG < cap.minFetalWeightG;
    const exceedsRisk = ANC_RISK_LEVEL_ORDER[riskLevel] > ANC_RISK_LEVEL_ORDER[cap.maxRiskLevel];

    // Record the triggers that fired at the actual spoke (first iteration only)
    if (i === 0) {
      if (exceedsGa) triggersAtSpoke.push('GA');
      if (exceedsFw) triggersAtSpoke.push('FW');
      if (exceedsRisk) triggersAtSpoke.push('RISK');
    }

    if (!exceedsGa && !exceedsFw && !exceedsRisk) {
      return { destination: current, triggersAtSpoke };
    }
    if (cap.referTo === null) {
      // Terminal that still can't handle — clinically a problem, but we
      // return the terminal as destination so the case is at least visible.
      return { destination: current, triggersAtSpoke };
    }
    current = cap.referTo;
  }
  return { destination: current, triggersAtSpoke };
}

export interface IncomingTermPregnanciesResult {
  hubHcode: string;
  minGaWeeks: number;
  count: number;
  byTrigger: { ga: number; fw: number; risk: number };
  items: IncomingTermPregnancy[];
}

export async function getIncomingTermPregnancies(
  db: DatabaseAdapter,
  hubHcode: string,
  minGaWeeks: number = 34,
): Promise<IncomingTermPregnanciesResult> {
  // Pull every active-stage pregnancy from active spokes that's at or past
  // the threshold. JS filter then applies the capability rules.
  // ISO cutoffs instead of `NOW() - INTERVAL …`: edc / last_anc_date are stored
  // as ISO-8601 TEXT in existing deployments, so the timestamptz comparison
  // throws on Postgres. ISO strings compare lexicographically = chronologically.
  const edcCutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const lastAncCutoff = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const rows = await db.query<{
    id: string;
    hn: string;
    name: string;
    age: number;
    gravida: number;
    para: number;
    ga_weeks: number | null;
    efw_g: number | null;
    edc: string | null;
    anc_risk_level: string;
    anc_visit_count: number;
    from_hcode: string;
    from_name: string;
  }>(
    // Freshness gates — exclude stale "PREGNANCY" rows whose owners
    // already delivered, miscarried, or were lost to follow-up but whose
    // care_stage was never transitioned (a known HOSxP-feed hygiene issue).
    //
    //   1. ga_weeks BETWEEN minGa AND 42 — anything >42 is biologically
    //      impossible (post-term + already delivered).
    //   2. edc IS NULL OR edc >= NOW() - INTERVAL '14 days' — past-EDC
    //      pregnancies that are >14 days overdue are effectively complete;
    //      a 14-day grace covers normal late-delivery cases.
    //   3. last_anc_date IS NULL OR last_anc_date >= NOW() - INTERVAL '60 days'
    //      — an ANC visit gap of 60+ days indicates the patient is no
    //      longer being followed at this hospital (delivered elsewhere,
    //      transferred, or abandoned care).
    //
    // Without these gates the hub view showed pregnancies with EDC dates
    // from 2010–2019 — clearly historical migrated data where the journey
    // row was never closed out.
    `SELECT
       mj.id, mj.hn, mj.name, mj.age, mj.gravida, mj.para,
       mj.ga_weeks, mj.efw_g, mj.edc, mj.anc_risk_level, mj.anc_visit_count,
       h.hcode AS from_hcode, h.name AS from_name
     FROM maternal_journeys mj
     JOIN hospitals h ON h.id = mj.current_hospital_id
     WHERE mj.care_stage = 'PREGNANCY'
       AND mj.ga_weeks IS NOT NULL
       AND mj.ga_weeks >= ?
       AND mj.ga_weeks <= 42
       AND (mj.edc IS NULL OR mj.edc >= ?)
       AND (mj.last_anc_date IS NULL OR mj.last_anc_date >= ?)
       AND h.is_active = true
       AND h.hcode <> ?`,
    [minGaWeeks, edcCutoff, lastAncCutoff, hubHcode],
  );

  const items: IncomingTermPregnancy[] = [];
  let gaCount = 0;
  let fwCount = 0;
  let riskCount = 0;

  for (const r of rows) {
    const ga = r.ga_weeks;
    if (ga == null) continue;
    const risk = (r.anc_risk_level as AncRiskLevel) ?? AncRiskLevel.LOW;
    const { destination, triggersAtSpoke } = resolveDestinationHcode(
      r.from_hcode,
      ga,
      r.efw_g,
      risk,
    );
    if (destination !== hubHcode) continue;
    if (triggersAtSpoke.length === 0) continue;

    const daysToEdc = r.edc
      ? Math.round((new Date(r.edc).getTime() - Date.now()) / 86400000)
      : null;

    items.push({
      id: r.id,
      hn: r.hn,
      name: decryptSafe(r.name),
      age: r.age,
      gravida: r.gravida,
      para: r.para,
      gaWeeks: ga,
      efwG: r.efw_g,
      edc: r.edc,
      ancRiskLevel: r.anc_risk_level,
      ancVisitCount: r.anc_visit_count,
      fromHcode: r.from_hcode,
      fromHospitalName: r.from_name,
      daysToEdc,
      triggers: triggersAtSpoke,
    });

    if (triggersAtSpoke.includes('GA')) gaCount++;
    if (triggersAtSpoke.includes('FW')) fwCount++;
    if (triggersAtSpoke.includes('RISK')) riskCount++;
  }

  // Most urgent first — EDC soonest. Nulls at the end.
  items.sort((a, b) => {
    if (a.daysToEdc == null && b.daysToEdc == null) return 0;
    if (a.daysToEdc == null) return 1;
    if (b.daysToEdc == null) return -1;
    return a.daysToEdc - b.daysToEdc;
  });

  return {
    hubHcode,
    minGaWeeks,
    count: items.length,
    byTrigger: { ga: gaCount, fw: fwCount, risk: riskCount },
    items,
  };
}
