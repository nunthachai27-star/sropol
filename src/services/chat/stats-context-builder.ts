// Statistics-mode context builder (codex verdict: Phase 1 = deterministic
// aggregate injection — NO model-called stats tool yet, NO PHI lists).
//
// Emits a hospital-scoped markdown block of COUNT aggregates only, sourced
// from confirmed tables (cached_patients, cached_referrals, moph_alert_log).
// Unlike clinical mode it never touches patient names/CIDs — aggregates are
// non-PHI by nature, and we deliberately avoid getHighRiskPatients()/lists
// which decrypt names. Keep additions here to COUNT-only expressions.
import type { DatabaseAdapter } from '@/db/adapter';

export interface StatisticsContext {
  hospitalId: string;
  context: string;
}

export async function buildStatisticsContext(
  db: DatabaseAdapter,
  hospitalId: string,
): Promise<StatisticsContext | null> {
  const hospital = await db.query<{ hcode: string; name: string }>(
    `SELECT hcode, name FROM hospitals WHERE id = ?`,
    [hospitalId],
  );
  if (!hospital[0]) return null;
  const hcode = hospital[0].hcode;
  const hospName = hospital[0].name;

  const admitted = await db.query<{ c: number }>(
    `SELECT COUNT(*) AS c FROM cached_patients
     WHERE hospital_id = ? AND labor_status = 'ACTIVE'`,
    [hospitalId],
  );
  const referrals = await db.query<{ c: number }>(
    `SELECT COUNT(*) AS c FROM cached_referrals
     WHERE to_hospital_id = ? AND status IN ('INITIATED','ACCEPTED','IN_TRANSIT')`,
    [hospitalId],
  );
  const alerts = await db.query<{ c: number }>(
    `SELECT COUNT(*) AS c FROM moph_alert_log
     WHERE hospital_id = ? AND status = 'pending'`,
    [hospitalId],
  );

  const context =
    `## สถิติของ ${hospName} (รหัส ${hcode})\n\n` +
    `- ผู้ป่วยทั้งหมด: **${Number(admitted[0]?.c ?? 0)}** คน\n` +
    `- การส่งต่อค้าง (ระหว่างทาง/รอรับ): **${Number(referrals[0]?.c ?? 0)}** ราย\n` +
    `- การแจ้งเตือนฉุกเฉินค้างส่ง: **${Number(alerts[0]?.c ?? 0)}** ราย\n\n` +
    `(ตัวเลขรวมทั้งโรงพยาบาล ไม่ระบุตัวผู้ป่วย)\n`;

  return { hospitalId, context };
}
