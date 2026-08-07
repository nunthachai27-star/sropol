// Shared hcode -> hospitals.id resolution (extracts the inline one-liner
// duplicated in dashboard.ts, journey-list.ts, webhook.ts, orchestrator.ts).
import type { DatabaseAdapter } from '@/db/adapter';

export async function getHospitalIdByHcode(
  db: DatabaseAdapter,
  hcode: string,
): Promise<string | null> {
  const rows = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [hcode]);
  return rows.length > 0 ? rows[0].id : null;
}
