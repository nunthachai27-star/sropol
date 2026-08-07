// Phase 6 Task H4: GET /api/hospitals/[hcode]/maternal-screen-summaries —
// per-AN maternal-screen summaries for one hospital's ACTIVE labor roster
// (docs/superpowers/plans/2026-07-17-maternal-screening-hosxp.md, GC-H4).
//
// Sibling of GET /api/hospitals/[hcode]/patients (route.ts in this same
// directory tree): same session-gated auth (via middleware.ts — this path is
// not in PUBLIC_PATHS), same ensureInit/getDatabase/hcode-param resolution,
// same fire-and-forget audit log, same try/catch → INTERNAL_ERROR shape.
//
// This route is the central-DB half of the ward bed-tile cross-source join:
// the ward page's bed occupancy comes from LIVE HOSxP (BMS Session API) and
// never touches this endpoint's data source directly — the client joins the
// two by `an`. Per GC-H4, a failed fetch here must degrade to "no chips",
// never an error tile and never a block on the HOSxP feed; that degradation
// is the caller's (useMaternalScreenSummaries / the page's) responsibility —
// this route still reports real errors as 500s so the hook's `error` state
// is observable.
import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { listMaternalScreenSummariesForHospital } from '@/services/dashboard';
import { auth } from '@/lib/auth';
import { tryLogAccess } from '@/services/audit';
import { auditActorFromSession } from '@/lib/audit-actor';
import { ensureInit } from '@/lib/ensure-init';
import { isMaternalScreenUiEnabled } from '@/lib/feature-flags';
import { logger } from '@/lib/logger';
import type { MaternalScreenSummariesResponse } from '@/types/api';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hcode: string }> },
) {
  try {
    await ensureInit();
    const { hcode } = await params;

    const db = await getDatabase();

    // uiEnabled is computed server-side, independent of the store query
    // (same GC-U3 convention as GET /api/patients/[an]/maternal-screenings):
    // the flag governs whether the client renders chips at all, not whether
    // data exists to join. listMaternalScreenSummariesForHospital already
    // short-circuits to [] when the flag is off; re-deriving it here (rather
    // than trusting summaries.length === 0) keeps the response shape honest
    // even if the service's own gate is ever bypassed.
    const uiEnabled = isMaternalScreenUiEnabled();
    const summaries = await listMaternalScreenSummariesForHospital(db, hcode);

    // PDPA access log — fire-and-forget (tryLogAccess never throws).
    const session = await auth();
    if (session?.user) {
      await tryLogAccess(db, {
        ...auditActorFromSession(session),
        action: 'VIEW_MATERNAL_SCREEN_SUMMARIES',
        resourceType: 'HOSPITAL',
        resourceId: hcode,
      });
    }

    const response: MaternalScreenSummariesResponse = { uiEnabled, summaries };
    return NextResponse.json(response);
  } catch (error) {
    logger.error('maternal_screen_summaries_api_failed', { error });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}
