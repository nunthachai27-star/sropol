// GET — read-only clinical discrepancy report (Release B reconciliation gate).
import { NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireAdmin } from '@/lib/admin-guard';
import { getReconciliationReport } from '@/services/reconciliation';
import { logger } from '@/lib/logger';

export async function GET() {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  try {
    await ensureInit();
    const db = await getDatabase();
    const report = await getReconciliationReport(db);
    return NextResponse.json(report);
  } catch (error) {
    logger.error('reconciliation_report_failed', { error });
    return NextResponse.json(
      { error: 'reconciliation report failed', message: 'สร้างรายงานไม่สำเร็จ กรุณาลองใหม่' },
      { status: 500 },
    );
  }
}
