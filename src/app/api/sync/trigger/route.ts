// POST /api/sync/trigger — on-demand data sync for the user's hospital
import { NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { auth } from '@/lib/auth';
import { startImmediateSyncJob } from '@/services/sync';
import { SseManager } from '@/lib/sse';
import { logger } from '@/lib/logger';

export async function POST() {
  try {
    await ensureInit();

    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = await getDatabase();
    const sseManager = SseManager.getInstance();

    // Get hospital info from the user's session (set during BMS login)
    const hospitalCode = session.user.hospitalCode;
    if (!hospitalCode) {
      return NextResponse.json({ synced: false, reason: 'no_hospital_code', lastSyncAt: null });
    }

    // Resolve hcode → hospital UUID. We previously auto-registered the row
    // here when not found, which was a security hole: any director-role user
    // from an unregistered hospital who hit the dashboard could silently
    // graft their facility into the registry, bypassing /admin · โรงพยาบาล.
    // Now we 403 — registration must go through an admin who explicitly adds
    // the hospital. The login-time hospital-access-guard should already have
    // blocked this path; this 403 is defense-in-depth for stale sessions.
    const hospitals = await db.query<{ id: string }>(
      'SELECT id FROM hospitals WHERE hcode = ? AND is_active = true',
      [hospitalCode],
    );

    if (hospitals.length === 0) {
      logger.warn('sync_trigger_rejected_unregistered_hospital', {
        hospitalCode,
        hospitalName: session.user.hospitalName,
      });
      return NextResponse.json(
        {
          error: 'hospital_not_registered',
          hospitalCode,
          hospitalName: session.user.hospitalName,
          message:
            'โรงพยาบาลของท่านยังไม่ได้รับสิทธิ์ใช้งานระบบ — กรุณาติดต่อผู้ดูแลระบบ',
        },
        { status: 403 },
      );
    }

    const job = startImmediateSyncJob(db, hospitals[0].id, sseManager);
    return NextResponse.json(
      { queued: job.running, job, hcode: hospitalCode },
      { status: job.running ? 202 : 200 },
    );
  } catch (error) {
    logger.error('sync_trigger_failed', { error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
