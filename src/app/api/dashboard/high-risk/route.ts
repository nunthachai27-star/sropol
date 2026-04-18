// GET /api/dashboard/high-risk — high-risk patients across all hospitals
import { NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { getHighRiskPatients } from '@/services/dashboard';
import { auth } from '@/lib/auth';
import { tryLogAccess } from '@/services/audit';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    await ensureInit();
    const db = await getDatabase();

    // Audit logging
    const session = await auth();
    if (session?.user) {
      await tryLogAccess(db, {
        userId: session.user.id,
        action: 'VIEW_HIGH_RISK_PATIENTS',
        resourceType: 'DASHBOARD',
      });
    }

    const patients = await getHighRiskPatients(db);
    return NextResponse.json({ patients });
  } catch (error) {
    logger.error('high_risk_patients_api_failed', { error });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}
