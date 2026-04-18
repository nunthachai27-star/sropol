// T072: GET /api/patients/[an] — patient detail with CPD score and hospital info
import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { decrypt, getEncryptionKey } from '@/lib/encryption';
import { auth } from '@/lib/auth';
import { tryLogAccess } from '@/services/audit';
import { ensureInit } from '@/lib/ensure-init';
import { parsePatientId } from '@/lib/utils';
import { logger } from '@/lib/logger';
import type { PatientDetailResponse } from '@/types/api';
import { getJourneyByHn } from '@/services/journey';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ an: string }> },
) {
  try {
    await ensureInit();
    const { an: patientId } = await params;
    const parsed = parsePatientId(patientId);
    if (!parsed) {
      return NextResponse.json({ error: 'Invalid patient ID format', code: 'BAD_REQUEST' }, { status: 400 });
    }
    const { hcode, an } = parsed;
    const db = await getDatabase();

    // T091: Audit logging
    const session = await auth();
    if (session?.user) {
      await tryLogAccess(db, {
        userId: session.user.id,
        action: 'VIEW_PATIENT',
        resourceType: 'PATIENT',
        resourceId: an,
      });
    }

    // Query patient with hospital info
    const patients = await db.query<{
      id: string;
      hn: string;
      an: string;
      name: string;
      cid: string | null;
      age: number;
      gravida: number | null;
      ga_weeks: number | null;
      anc_count: number | null;
      admit_date: string;
      height_cm: number | null;
      weight_kg: number | null;
      weight_diff_kg: number | null;
      fundal_height_cm: number | null;
      us_weight_g: number | null;
      hematocrit_pct: number | null;
      labor_status: string;
      synced_at: string;
      hcode: string;
      hospital_name: string;
      level: string;
    }>(
      `SELECT cp.id, cp.hn, cp.an, cp.name, cp.cid, cp.age, cp.gravida,
              cp.ga_weeks, cp.anc_count, cp.admit_date, cp.height_cm,
              cp.weight_kg, cp.weight_diff_kg, cp.fundal_height_cm,
              cp.us_weight_g, cp.hematocrit_pct, cp.labor_status, cp.synced_at,
              h.hcode, h.name as hospital_name, h.level
       FROM cached_patients cp
       JOIN hospitals h ON h.id = cp.hospital_id
       WHERE cp.an = ? AND h.hcode = ?
       LIMIT 1`,
      [an, hcode],
    );

    if (patients.length === 0) {
      return NextResponse.json(
        { error: 'Patient not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    const p = patients[0];

    // Decrypt name and CID for display
    let decryptedName = p.name;
    try {
      const key = getEncryptionKey();
      if (key) {
        decryptedName = decrypt(p.name, key);
      }
    } catch {
      // If decryption fails, use raw value
    }

    // Get latest CPD score
    const cpdScores = await db.query<{
      score: number;
      risk_level: string;
      recommendation: string | null;
      factor_gravida: number | null;
      factor_anc_count: number | null;
      factor_ga_weeks: number | null;
      factor_height_cm: number | null;
      factor_weight_diff: number | null;
      factor_fundal_ht: number | null;
      factor_us_weight: number | null;
      factor_hematocrit: number | null;
      missing_factors: string;
      calculated_at: string;
    }>(
      'SELECT * FROM cpd_scores WHERE patient_id = ? ORDER BY calculated_at DESC LIMIT 1',
      [p.id],
    );

    const cpdScore = cpdScores.length > 0 ? {
      score: cpdScores[0].score,
      riskLevel: cpdScores[0].risk_level as PatientDetailResponse['cpdScore'] extends null ? never : NonNullable<PatientDetailResponse['cpdScore']>['riskLevel'],
      recommendation: cpdScores[0].recommendation,
      factors: {
        gravida: cpdScores[0].factor_gravida,
        ancCount: cpdScores[0].factor_anc_count,
        gaWeeks: cpdScores[0].factor_ga_weeks,
        heightCm: cpdScores[0].factor_height_cm,
        weightDiffKg: cpdScores[0].factor_weight_diff,
        fundalHeightCm: cpdScores[0].factor_fundal_ht,
        usWeightG: cpdScores[0].factor_us_weight,
        hematocritPct: cpdScores[0].factor_hematocrit,
      },
      missingFactors: JSON.parse(cpdScores[0].missing_factors || '[]'),
      calculatedAt: cpdScores[0].calculated_at,
    } : null;

    // Look up hospital ID for journey query
    const hospitals = await db.query<{ id: string }>(
      'SELECT id FROM hospitals WHERE hcode = ? LIMIT 1',
      [hcode],
    );
    const hospitalId = hospitals.length > 0 ? hospitals[0].id : null;

    // Look up journey context
    let journeyContext: {
      journeyId: string;
      careStage: string;
      ancRiskLevel: string;
      ancVisitCount: number;
      lastAncDate: string | null;
      lmp: string | null;
      edc: string | null;
    } | null = null;
    if (hospitalId) {
      const journey = await getJourneyByHn(db, p.hn, hospitalId);
      if (journey) {
        journeyContext = {
          journeyId: journey.id,
          careStage: journey.careStage,
          ancRiskLevel: journey.ancRiskLevel,
          ancVisitCount: journey.ancVisitCount,
          lastAncDate: journey.lastAncDate,
          lmp: journey.lmp,
          edc: journey.edc,
        };
      }
    }

    const response: PatientDetailResponse = {
      patient: {
        id: p.id,
        hn: p.hn,
        an: p.an,
        name: decryptedName,
        age: p.age,
        gravida: p.gravida,
        gaWeeks: p.ga_weeks,
        ancCount: p.anc_count,
        admitDate: p.admit_date,
        heightCm: p.height_cm,
        weightKg: p.weight_kg,
        weightDiffKg: p.weight_diff_kg,
        fundalHeightCm: p.fundal_height_cm,
        usWeightG: p.us_weight_g,
        hematocritPct: p.hematocrit_pct,
        laborStatus: p.labor_status as PatientDetailResponse['patient']['laborStatus'],
        hospital: {
          hcode: p.hcode,
          name: p.hospital_name,
          level: p.level as PatientDetailResponse['patient']['hospital']['level'],
        },
        syncedAt: p.synced_at,
      },
      cpdScore,
      ...(journeyContext !== null && { journeyContext }),
    };

    return NextResponse.json(response);
  } catch (error) {
    logger.error('patient_detail_api_failed', { error });
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
