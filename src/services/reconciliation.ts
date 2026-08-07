// Read-only discrepancy report backing the Release B clinical-data
// reconciliation contract. NEVER mutates; returns de-identified aggregates.
import type { DatabaseAdapter } from '@/db/adapter';

export interface ReconciliationReport {
  generatedAt: string;
  riskMismatches: { hospitalId: string; count: number }[];
  stuckPregnancyWithActiveLabor: { hospitalId: string; count: number }[];
  duplicateActiveJourneys: { hospitalId: string; hn: string; count: number }[];
  totals: {
    riskMismatches: number;
    stuckPregnancyWithActiveLabor: number;
    duplicateActiveJourneys: number;
  };
}

export async function getReconciliationReport(db: DatabaseAdapter): Promise<ReconciliationReport> {
  const riskMismatches = await db.query<{ hospital_id: string; count: number }>(
    `SELECT mj.current_hospital_id as hospital_id, COUNT(*) as count
       FROM maternal_journeys mj
       JOIN LATERAL (
         SELECT risk_level FROM cached_anc_risks r
          WHERE r.journey_id = mj.id
          ORDER BY r.screened_at DESC, r.created_at DESC LIMIT 1
       ) latest ON TRUE
      WHERE latest.risk_level <> mj.anc_risk_level
      GROUP BY mj.current_hospital_id`,
  );

  const stuck = await db.query<{ hospital_id: string; count: number }>(
    `SELECT mj.current_hospital_id as hospital_id, COUNT(DISTINCT mj.id) as count
       FROM maternal_journeys mj
       JOIN cached_patients p
         ON p.cid_hash = mj.cid_hash AND p.labor_status = 'ACTIVE'
      WHERE mj.care_stage = 'PREGNANCY'
      GROUP BY mj.current_hospital_id`,
  );

  const dupes = await db.query<{ hospital_id: string; hn: string; count: number }>(
    `SELECT hospital_id, hn, COUNT(*) as count
       FROM maternal_journeys
      WHERE care_stage IN ('PREGNANCY', 'LABOR') AND hn <> ''
      GROUP BY hospital_id, hn
     HAVING COUNT(*) > 1`,
  );

  const sum = (rows: { count: number }[]) => rows.reduce((acc, r) => acc + Number(r.count), 0);
  return {
    generatedAt: new Date().toISOString(),
    riskMismatches: riskMismatches.map((r) => ({
      hospitalId: r.hospital_id,
      count: Number(r.count),
    })),
    stuckPregnancyWithActiveLabor: stuck.map((r) => ({
      hospitalId: r.hospital_id,
      count: Number(r.count),
    })),
    duplicateActiveJourneys: dupes.map((r) => ({
      hospitalId: r.hospital_id,
      hn: r.hn,
      count: Number(r.count),
    })),
    totals: {
      riskMismatches: sum(riskMismatches),
      stuckPregnancyWithActiveLabor: sum(stuck),
      duplicateActiveJourneys: sum(dupes),
    },
  };
}
