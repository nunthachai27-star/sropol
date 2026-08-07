// Task 8: GET /api/patients/[an]/maternal-screenings — read-only maternal
// labor-triage screening history (docs/superpowers/plans/2026-07-16-maternal-screening.md,
// spec §9.3). PROVISIONAL / flag-gated feature (GC2): the endpoint itself is
// always reachable, but it simply returns `{ latest: null, history: [],
// nextCursor: null }` at any hospital where MATERNAL_SCREEN_INGEST_ENABLED
// has never been on — nothing to read, nothing surfaced.
//
// Auth/param handling mirrors src/app/api/patients/[an]/route.ts exactly:
// session-gated by middleware.ts (this path is not in PUBLIC_PATHS), audit
// logging is fire-and-forget (never blocks the response), and the patient is
// resolved via parsePatientId + a hospitals-join scoped by hcode — the same
// tenant-isolation mechanism as every other nested /api/patients/[an]/* route.
import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { auth } from '@/lib/auth';
import { tryLogAccess } from '@/services/audit';
import { auditActorFromSession } from '@/lib/audit-actor';
import { ensureInit } from '@/lib/ensure-init';
import { parsePatientId } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { isMaternalScreenUiEnabled } from '@/lib/feature-flags';
import type { MaternalScreenAssessmentsResponse } from '@/types/api';
import {
  listMaternalScreenAssessments,
  MaternalScreenStoreError,
  type ListMaternalScreenAssessmentsResult,
} from '@/services/maternal-screening-store';

export async function GET(request: NextRequest, { params }: { params: Promise<{ an: string }> }) {
  try {
    await ensureInit();
    const { an: patientId } = await params;
    const parsed = parsePatientId(patientId);
    if (!parsed) {
      return NextResponse.json(
        { error: 'Invalid patient ID format', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }
    const { hcode, an } = parsed;
    const db = await getDatabase();

    // Audit logging — same fire-and-forget pattern as GET /api/patients/[an]
    // (T091): never gates the response, only records who looked.
    const session = await auth();
    if (session?.user) {
      await tryLogAccess(db, {
        ...auditActorFromSession(session),
        action: 'VIEW_MATERNAL_SCREENING',
        resourceType: 'PATIENT',
        resourceId: an,
      });
    }

    // Tenant-scoped patient/admission lookup — identical join to the sibling
    // nested routes (contractions, partogram, vitals): an AN only resolves
    // within the hospital named by hcode, so a caller can never read another
    // hospital's assessments by guessing an AN (GC6 tenant isolation).
    const patients = await db.query<{ id: string; hospital_id: string }>(
      `SELECT cp.id, cp.hospital_id
         FROM cached_patients cp
         JOIN hospitals h ON h.id = cp.hospital_id
        WHERE cp.an = ? AND h.hcode = ?
        LIMIT 1`,
      [an, hcode],
    );

    if (patients.length === 0) {
      return NextResponse.json({ error: 'Patient not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const patient = patients[0];

    // Pagination params (spec §9.3: bounded — default 20 / max 100, enforced
    // again inside listMaternalScreenAssessments as defense-in-depth).
    const limitParam = request.nextUrl.searchParams.get('limit');
    const limit = limitParam != null ? Number(limitParam) : undefined;
    const cursor = request.nextUrl.searchParams.get('cursor');

    let result: ListMaternalScreenAssessmentsResult;
    try {
      result = await listMaternalScreenAssessments(db, {
        hospitalId: patient.hospital_id,
        laborAdmissionId: patient.id,
        limit,
        cursor,
      });
    } catch (err) {
      if (err instanceof MaternalScreenStoreError && err.code === 'INVALID_PARAMS') {
        return NextResponse.json({ error: err.message, code: 'BAD_REQUEST' }, { status: 400 });
      }
      throw err;
    }

    // uiEnabled is computed server-side, independent of the store query
    // (GC-U3): the flag governs whether the client renders the section, not
    // whether data exists to read.
    const response: MaternalScreenAssessmentsResponse = {
      ...result,
      uiEnabled: isMaternalScreenUiEnabled(),
    };

    return NextResponse.json(response);
  } catch (error) {
    logger.error('maternal_screenings_api_failed', { error });
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
