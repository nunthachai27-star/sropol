// T050: GET /api/hospitals/[hcode]/patients — patient list per hospital
import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { getHospitalPatientList, getHospitalPartographAudit } from '@/services/dashboard';
import { auth } from '@/lib/auth';
import { tryLogAccess } from '@/services/audit';
import { auditActorFromSession } from '@/lib/audit-actor';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hcode: string }> },
) {
  try {
    await ensureInit();
    const { hcode } = await params;
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status') ?? 'active';
    const riskLevel = searchParams.get('risk_level') ?? undefined;
    const page = parseInt(searchParams.get('page') ?? '1', 10);
    const perPage = parseInt(searchParams.get('per_page') ?? '20', 10);
    const dateFrom = searchParams.get('date_from') ?? undefined;
    const dateTo = searchParams.get('date_to') ?? undefined;

    const db = await getDatabase();
    const result = await getHospitalPatientList(db, hcode, {
      status,
      riskLevel,
      page,
      perPage,
      dateFrom,
      dateTo,
    });

    // PDPA access log — fire-and-forget (tryLogAccess never throws).
    const session = await auth();
    if (session?.user) {
      await tryLogAccess(db, {
        ...auditActorFromSession(session),
        action: 'VIEW_HOSPITAL_PATIENTS',
        resourceType: 'HOSPITAL',
        resourceId: hcode,
      });
    }

    // Charting audit rides along so the detail page renders the
    // data-quality panel without a second fetch.
    const partographAudit = await getHospitalPartographAudit(db, hcode);

    return NextResponse.json({ ...result, partographAudit });
  } catch (error) {
    logger.error('patients_api_failed', { error });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}
