// POST /api/referrals/check — pre-check if a referral can be sent for a patient
// Uses CID as the patient key (hashed server-side, never stored raw)
import { createHash } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';

interface CheckResult {
  canRefer: boolean;
  reason: string;
  patient: {
    found: boolean;
    careStage: string | null;
    ancRiskLevel: string | null;
    gravida: number | null;
    gaWeeks: number | null;
    ancVisitCount: number | null;
    lastAncDate: string | null;
    currentHospitalCode: string | null;
    currentHospitalName: string | null;
    originHospitalCode: string | null;
  } | null;
  labor: {
    found: boolean;
    an: string | null;
    laborStatus: string | null;
    admitDate: string | null;
    hospitalCode: string | null;
  } | null;
  activeReferrals: number;
}

export async function POST(request: NextRequest) {
  try {
    await ensureInit();
    const db = await getDatabase();

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }

    const { cid } = body as { cid?: string };
    if (!cid || typeof cid !== 'string' || cid.length !== 13) {
      return NextResponse.json(
        { error: '"cid" is required (string, 13 digits) — เลขบัตรประชาชน' },
        { status: 400 },
      );
    }

    const cidHash = createHash('sha256').update(cid).digest('hex');

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

    // Resolve hospital names
    async function getHospitalInfo(hospitalId: string): Promise<{ hcode: string; name: string } | null> {
      const rows = await db.query<{ hcode: string; name: string }>(
        'SELECT hcode, name FROM hospitals WHERE id = ?',
        [hospitalId],
      );
      return rows.length > 0 ? rows[0] : null;
    }

    const hasJourney = journeyRows.length > 0;
    const hasLabor = laborRows.length > 0;
    const journey = hasJourney ? journeyRows[0] : null;
    const labor = hasLabor ? laborRows[0] : null;

    // Resolve hospital info
    const currentHosp = journey ? await getHospitalInfo(journey.current_hospital_id) : null;
    const originHosp = journey ? await getHospitalInfo(journey.hospital_id) : null;
    const laborHosp = labor ? await getHospitalInfo(labor.hospital_id) : null;

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

    const result: CheckResult = {
      canRefer,
      reason,
      patient: hasJourney ? {
        found: true,
        careStage: journey!.care_stage,
        ancRiskLevel: journey!.anc_risk_level,
        gravida: journey!.gravida,
        gaWeeks: journey!.ga_weeks,
        ancVisitCount: journey!.anc_visit_count,
        lastAncDate: journey!.last_anc_date,
        currentHospitalCode: currentHosp?.hcode ?? null,
        currentHospitalName: currentHosp?.name ?? null,
        originHospitalCode: originHosp?.hcode ?? null,
      } : null,
      labor: hasLabor ? {
        found: true,
        an: labor!.an,
        laborStatus: labor!.labor_status,
        admitDate: labor!.admit_date,
        hospitalCode: laborHosp?.hcode ?? null,
      } : null,
      activeReferrals,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Referral check error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
