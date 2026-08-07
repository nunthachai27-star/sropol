// POST /api/referrals/check — pre-check if a referral can be sent for a patient
// Uses CID as the patient key (hashed server-side, never stored raw)
import { createHash } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';
import { apiError } from '@/lib/api-errors';
import { validateApiKey } from '@/services/webhook';
import { diagnoseCid, describeCidFailure } from '@/lib/cid';
import { checkRateLimit } from '@/lib/rate-limit';

// Minimized contract (2026-07-13 PHI review): the only consumer is the HOSxP
// referral gate, which uses canRefer + reason. Maternity details must never
// be returned from a CID lookup.
interface CheckResult {
  canRefer: boolean;
  reason: string;
  activeReferrals: number;
}

const CHECK_RATE_LIMIT = 30; // requests
const CHECK_RATE_WINDOW_SECONDS = 60;

export async function POST(request: NextRequest) {
  try {
    await ensureInit();
    const db = await getDatabase();

    // Same Bearer webhook-key auth as /api/webhooks/patient-data. The route
    // stays in middleware PUBLIC_PATHS; this handler check is the auth.
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(apiError('MISSING_AUTH'), { status: 401 });
    }
    const keyInfo = await validateApiKey(db, authHeader.slice(7));
    if (!keyInfo) {
      return NextResponse.json(apiError('INVALID_API_KEY'), { status: 401 });
    }

    const rate = await checkRateLimit(
      `referral-check:${keyInfo.hospitalId}`,
      CHECK_RATE_LIMIT,
      CHECK_RATE_WINDOW_SECONDS,
    );
    if (!rate.allowed) {
      logger.warn('referral_check_rate_limited', { hospitalId: keyInfo.hospitalId });
      return NextResponse.json(apiError('RATE_LIMITED'), { status: 429 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(apiError('INVALID_JSON'), { status: 400 });
    }
    const { cid } = body as { cid?: string };
    const cidCheck = diagnoseCid(cid, { requireChecksum: true });
    if (!cidCheck.ok) {
      logger.warn('referral_check_invalid_cid', {
        hospitalId: keyInfo.hospitalId,
        failure: cidCheck.failure,
      });
      return NextResponse.json(
        apiError('VALIDATION_FAILED', { cid: describeCidFailure(cidCheck.failure) }),
        { status: 400 },
      );
    }

    const cidHash = createHash('sha256').update(cidCheck.cid).digest('hex');

    // 1. Check maternal journey (ANC/pregnancy data)
    const journeyRows = await db.query<{
      care_stage: string;
      anc_risk_level: string;
      gravida: number;
      ga_weeks: number | null;
      anc_visit_count: number;
      last_anc_date: string | null;
      current_hospital_id: string;
      hospital_id: string;
    }>(
      `SELECT care_stage, anc_risk_level, gravida, ga_weeks, anc_visit_count, last_anc_date, current_hospital_id, hospital_id
       FROM maternal_journeys WHERE cid_hash = ? ORDER BY created_at DESC LIMIT 1`,
      [cidHash],
    );

    // 2. Check active labor record
    const laborRows = await db.query<{
      an: string;
      labor_status: string;
      admit_date: string;
      hospital_id: string;
    }>(
      `SELECT an, labor_status, admit_date, hospital_id
       FROM cached_patients WHERE cid_hash = ? AND labor_status = 'ACTIVE'
       ORDER BY created_at DESC LIMIT 1`,
      [cidHash],
    );

    // 3. Count active referrals (not ARRIVED/REJECTED)
    let activeReferrals = 0;
    if (journeyRows.length > 0) {
      const refCountRows = await db.query<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM cached_referrals
         WHERE journey_id = (SELECT id FROM maternal_journeys WHERE cid_hash = ? ORDER BY created_at DESC LIMIT 1)
         AND status NOT IN ('ARRIVED', 'REJECTED')`,
        [cidHash],
      );
      activeReferrals = refCountRows[0]?.cnt ?? 0;
    }

    const hasJourney = journeyRows.length > 0;
    const hasLabor = laborRows.length > 0;
    const journey = hasJourney ? journeyRows[0] : null;

    // Determine if referral is possible
    let canRefer = false;
    let reason = '';

    if (!hasJourney && !hasLabor) {
      canRefer = false;
      reason = 'ไม่พบข้อมูลผู้ป่วยในระบบ (ไม่มีข้อมูลฝากครรภ์และไม่มีข้อมูลคลอด)';
    } else if (journey?.care_stage === 'DELIVERED' || journey?.care_stage === 'POSTPARTUM') {
      canRefer = false;
      reason = `ผู้ป่วยคลอดแล้ว (สถานะ: ${journey.care_stage}) — ไม่จำเป็นต้องส่งต่อ`;
    } else if (activeReferrals > 0) {
      canRefer = true;
      reason = `มีใบส่งต่อที่ยังดำเนินการอยู่ ${activeReferrals} รายการ — สามารถส่งต่อได้แต่ควรตรวจสอบใบส่งต่อเดิม`;
    } else {
      canRefer = true;
      reason = 'พร้อมส่งต่อ';
    }

    const result: CheckResult = { canRefer, reason, activeReferrals };
    return NextResponse.json(result);
  } catch (error) {
    logger.error('referral_check_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
