// Change-only ANC screening persistence, shared by the webhook processor and
// the HOSxP polling path (constitution III — one dedup rule, two callers).
import { v4 as uuidv4 } from 'uuid';
import type { DatabaseAdapter } from '@/db/adapter';

export interface AncScreeningRow {
  level: string;
  triggeredRulesJson: string;
  riskFactorsJson: string;
  recommendedFacility: string | null;
  recommendedProvider: string | null;
}

/** Insert a cached_anc_risks row only when level or triggered rules changed
 *  vs the latest row for the journey. Returns true when a row was inserted. */
export async function insertAncScreeningIfChanged(
  db: DatabaseAdapter,
  journeyId: string,
  row: AncScreeningRow,
): Promise<boolean> {
  const latest = await db.query<{ risk_level: string; triggered_rules: unknown }>(
    `SELECT risk_level, triggered_rules FROM cached_anc_risks
      WHERE journey_id = ? ORDER BY screened_at DESC, created_at DESC LIMIT 1`,
    [journeyId],
  );
  if (latest.length > 0) {
    // pg returns JSONB pre-parsed; normalize to compare.
    const prev = latest[0].triggered_rules;
    const prevJson = typeof prev === 'string' ? prev : JSON.stringify(prev);
    if (latest[0].risk_level === row.level && prevJson === row.triggeredRulesJson) return false;
  }
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO cached_anc_risks (id, journey_id, risk_level, triggered_rules, risk_factors,
       recommended_facility, recommended_provider, screened_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      journeyId,
      row.level,
      row.triggeredRulesJson,
      row.riskFactorsJson,
      row.recommendedFacility,
      row.recommendedProvider,
      now,
      now,
    ],
  );
  return true;
}
