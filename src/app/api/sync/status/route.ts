// GET /api/sync/status — current on-demand sync job state for the user's hospital
import { NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { auth } from '@/lib/auth';
import { getImmediateSyncJobStatus } from '@/services/sync';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    await ensureInit();

    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hospitalCode = session.user.hospitalCode;
    if (!hospitalCode) {
      return NextResponse.json({
        hcode: null,
        job: null,
        reason: 'no_hospital_code',
      });
    }

    const db = await getDatabase();
    const hospitals = await db.query<{ id: string }>(
      'SELECT id FROM hospitals WHERE hcode = ? AND is_active = true',
      [hospitalCode],
    );

    if (hospitals.length === 0) {
      return NextResponse.json(
        {
          error: 'hospital_not_registered',
          hcode: hospitalCode,
          job: null,
        },
        { status: 403 },
      );
    }

    return NextResponse.json({
      hcode: hospitalCode,
      job: getImmediateSyncJobStatus(hospitals[0].id),
    });
  } catch (error) {
    logger.error('sync_status_failed', { error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
