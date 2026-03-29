// T048: Dashboard service — province dashboard data from local cache
import type { DatabaseAdapter } from '@/db/adapter';
import type { DashboardHospital, DashboardSummary, HighRiskPatient, DashboardStageKPIs, DashboardAlerts } from '@/types/api';
import type { ConnectionStatus, HospitalLevel } from '@/types/domain';

interface DashboardRow {
  hcode: string;
  name: string;
  level: string;
  connection_status: string;
  last_sync_at: string | null;
  is_active: number;
}

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
  // Get all active hospitals
  const hospitals = await db.query<DashboardRow>(
    "SELECT hcode, name, level, connection_status, last_sync_at, is_active FROM hospitals WHERE is_active = 1 ORDER BY name",
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
    WHERE h.is_active = 1
    GROUP BY h.id, h.hcode, risk_level
  `);

  // Build result
  const hospitalMap = new Map<string, DashboardHospital>();

  for (const h of hospitals) {
    hospitalMap.set(h.hcode, {
      hcode: h.hcode,
      name: h.name,
      level: h.level as HospitalLevel,
      connectionStatus: h.connection_status as ConnectionStatus,
      lastSyncAt: h.last_sync_at,
      counts: { low: 0, medium: 0, high: 0, total: 0 },
    });
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
    ORDER BY cs.score DESC
    LIMIT ?
  `, [limit]);

  return rows.map((row) => ({
    an: row.an,
    hn: row.hn,
    name: row.name,
    age: row.age,
    gaWeeks: row.ga_weeks,
    cpdScore: row.cpd_score,
    riskLevel: row.risk_level,
    hospital: row.hospital_name,
    hcode: row.hcode,
    admitDate: row.admit_date,
    lastVitalAt: row.last_vital_at,
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

  // Get hospital ID
  const hospitals = await db.query<{ id: string }>(
    'SELECT id FROM hospitals WHERE hcode = ?',
    [hcode],
  );
  if (hospitals.length === 0) return { patients: [], pagination: { total: 0, page, perPage, totalPages: 0 } };

  const hospitalId = hospitals[0].id;

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

  // Get patients with latest CPD score
  const patients = await db.query(
    `SELECT cp.*,
      (SELECT cs.score FROM cpd_scores cs WHERE cs.patient_id = cp.id ORDER BY cs.calculated_at DESC LIMIT 1) as cpd_score,
      (SELECT cs.risk_level FROM cpd_scores cs WHERE cs.patient_id = cp.id ORDER BY cs.calculated_at DESC LIMIT 1) as cpd_risk_level,
      (SELECT cs.recommendation FROM cpd_scores cs WHERE cs.patient_id = cp.id ORDER BY cs.calculated_at DESC LIMIT 1) as cpd_recommendation
    FROM cached_patients cp
    ${whereClause}
    ORDER BY cp.admit_date DESC
    LIMIT ? OFFSET ?`,
    [...params, perPage, offset],
  );

  return {
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
    `SELECT anc_risk_level, COUNT(*) as count FROM maternal_journeys WHERE care_stage = 'PREGNANCY' GROUP BY anc_risk_level`,
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
     WHERE mj.care_stage = 'DELIVERED' AND cn.born_at >= ?`,
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
    `SELECT COUNT(*) as count FROM cached_referrals WHERE status IN ('INITIATED', 'ACCEPTED')`,
  );

  // Overdue ANC: pregnancies where last_anc_date is > 28 days ago
  // Uses date string comparison — works in both SQLite and PostgreSQL
  const twentyEightDaysAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();
  const overdueAnc = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM maternal_journeys
     WHERE care_stage = 'PREGNANCY'
       AND last_anc_date IS NOT NULL
       AND last_anc_date < ?`,
    [twentyEightDaysAgo],
  );

  // In-transit referrals
  const inTransit = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM cached_referrals WHERE status = 'IN_TRANSIT'`,
  );

  return {
    referralAlerts: Number(refAlerts[0]?.count) || 0,
    overdueAnc: Number(overdueAnc[0]?.count) || 0,
    inTransitReferrals: Number(inTransit[0]?.count) || 0,
  };
}
