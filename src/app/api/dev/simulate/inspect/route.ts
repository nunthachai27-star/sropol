// GET /api/dev/simulate/inspect — dev-only. Dumps counts + small samples
// from every simulation-touched table so you can sanity-check what the
// Tier-1/2/3 pipeline is actually producing.
//
// Intentionally does NOT decrypt patient names — returns the encrypted blob
// as-is since this endpoint exists purely for developer debugging and we
// don't want plaintext PDPA data flowing over the wire.
import { NextResponse } from 'next/server';
import { simulationGuard } from '../_guard';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { simulationOrchestrator } from '@/services/dev-simulation/orchestrator';

// Run a query, return [] + log error text on failure. Makes the endpoint
// robust against running-server vs freshly-added-columns mismatches.
async function safeQuery<T>(
  db: Awaited<ReturnType<typeof getDatabase>>,
  sql: string,
  params: unknown[] = [],
  label: string,
  errors: Record<string, string>,
): Promise<T[]> {
  try {
    return (await db.query<T>(sql, params as never[])) as T[];
  } catch (e) {
    errors[label] = e instanceof Error ? e.message : String(e);
    return [];
  }
}

export async function GET(request: Request) {
  const guard = await simulationGuard();
  if (guard instanceof NextResponse) return guard;

  const url = new URL(request.url);
  const targetAn = url.searchParams.get('an');
  const targetHcode = url.searchParams.get('hcode');

  try {
    if (targetAn && targetHcode) {
      return await handlePatient(targetHcode, targetAn);
    }
    return await handle();
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack?.split('\n').slice(0, 8) : null,
      },
      { status: 500 },
    );
  }
}

// Targeted dig — find one patient across labor + partograph + journey.
async function handlePatient(hcode: string, an: string) {
  await ensureInit();
  const db = await getDatabase();
  const errors: Record<string, string> = {};
  const labor = await safeQuery<Record<string, unknown>>(
    db,
    `SELECT cp.id, cp.hn, cp.an, cp.age,
            cp.gravida, cp.para, cp.abortion, cp.living_children, cp.preg_no,
            cp.ga_weeks, cp.ga_day, cp.anc_count,
            cp.height_cm, cp.weight_kg, cp.weight_diff_kg, cp.pre_pregnancy_weight_kg,
            cp.fundal_height_cm, cp.us_weight_g, cp.hematocrit_pct,
            cp.bp_systolic_admit, cp.bp_diastolic_admit, cp.pulse_admit,
            cp.rr_admit, cp.temperature_admit,
            cp.cervical_open_cm_admit, cp.effacement_pct_admit, cp.station_admit,
            cp.labor_status, cp.admit_date, cp.created_at, cp.journey_id, h.hcode
     FROM cached_patients cp
     JOIN hospitals h ON h.id = cp.hospital_id
     WHERE cp.an = ? AND h.hcode = ?`,
    [an, hcode],
    'patient:labor',
    errors,
  );
  const patientId = labor[0]?.id as string | undefined;
  const partograph = patientId
    ? await safeQuery<Record<string, unknown>>(
        db,
        `SELECT id, observe_datetime, hour_no, fetal_heart_rate,
                cervical_dilation_cm, bp_systolic, bp_diastolic, pulse, temperature,
                contraction_per_10min, source_system
         FROM cached_partograph_observations
         WHERE patient_id = ?
         ORDER BY observe_datetime ASC`,
        [patientId],
        'patient:partograph',
        errors,
      )
    : [];
  const vitals = patientId
    ? await safeQuery<Record<string, unknown>>(
        db,
        `SELECT COUNT(*) as n FROM cached_vital_signs WHERE patient_id = ?`,
        [patientId],
        'patient:vitals',
        errors,
      )
    : [];
  const journey = labor[0]?.journey_id
    ? await safeQuery<Record<string, unknown>>(
        db,
        `SELECT id, care_stage, anc_risk_level, anc_visit_count
         FROM maternal_journeys WHERE id = ?`,
        [labor[0].journey_id],
        'patient:journey',
        errors,
      )
    : [];
  // How many partograph rows does the WHOLE hospital have? Helps explain
  // the "missing" feel when the hospital-level aggregate is non-zero.
  const hospPartographCount = await safeQuery<{ n: number }>(
    db,
    `SELECT COUNT(*) as n FROM cached_partograph_observations cpo
     JOIN cached_patients cp ON cp.id = cpo.patient_id
     JOIN hospitals h ON h.id = cp.hospital_id
     WHERE h.hcode = ?`,
    [hcode],
    'hosp:partograph-count',
    errors,
  );
  return NextResponse.json({
    patient: labor[0] ?? null,
    partographCount: partograph.length,
    partographSample: partograph.slice(0, 10),
    vitalCount: Number((vitals[0] as { n?: number } | undefined)?.n ?? 0),
    journey: journey[0] ?? null,
    hospitalPartographCount: Number(hospPartographCount[0]?.n ?? 0),
    errors,
  });
}

async function handle() {
  await ensureInit();
  const db = await getDatabase();
  const errors: Record<string, string> = {};

  const tables = [
    'maternal_journeys',
    'cached_anc_visits',
    'cached_anc_risks',
    'cached_patients',
    'cached_vital_signs',
    'cached_partograph_observations',
    'cached_referrals',
    'cached_newborns',
    'cpd_scores',
    'webhook_api_keys',
  ];

  const counts: Record<string, number> = {};
  for (const t of tables) {
    const rows = await safeQuery<{ n: number }>(
      db,
      `SELECT COUNT(*) as n FROM ${t}`,
      [],
      `count:${t}`,
      errors,
    );
    counts[t] = rows.length > 0 ? Number(rows[0].n ?? 0) : -1;
  }

  // Two journey queries — one with L2 columns, a stripped one as fallback.
  let sampleJourneys = await safeQuery<Record<string, unknown>>(
    db,
    `SELECT mj.id, mj.hn, mj.age, mj.gravida, mj.para, mj.ga_weeks, mj.lmp, mj.edc,
            mj.care_stage, mj.anc_risk_level, mj.anc_visit_count, mj.last_anc_date,
            mj.blood_group, mj.rh_factor, mj.hbsag_result, mj.vdrl_result,
            mj.hiv_result, mj.ogtt_result, mj.term_births, mj.preterm_births,
            mj.abortions, mj.living_children, mj.past_medical_history,
            h.hcode as registered_hcode, h.name as registered_hospital
     FROM maternal_journeys mj
     JOIN hospitals h ON h.id = mj.hospital_id
     ORDER BY mj.created_at DESC
     LIMIT 5`,
    [],
    'sample:journeys',
    errors,
  );
  if (sampleJourneys.length === 0 && errors['sample:journeys']) {
    sampleJourneys = await safeQuery<Record<string, unknown>>(
      db,
      `SELECT mj.id, mj.hn, mj.age, mj.gravida, mj.para, mj.ga_weeks, mj.lmp, mj.edc,
              mj.care_stage, mj.anc_risk_level, mj.anc_visit_count, mj.last_anc_date,
              h.hcode as registered_hcode, h.name as registered_hospital
       FROM maternal_journeys mj
       JOIN hospitals h ON h.id = mj.hospital_id
       ORDER BY mj.created_at DESC
       LIMIT 5`,
      [],
      'sample:journeys:basic',
      errors,
    );
  }

  let sampleAncVisits = await safeQuery<Record<string, unknown>>(
    db,
    `SELECT journey_id, visit_date, visit_number, ga_weeks, fundal_height_cm,
            weight_kg, bp_systolic, bp_diastolic, fetal_hr, presentation, engagement,
            urine_protein, urine_glucose, hb_g_dl, hct_pct, tt_dose_no,
            iron_folic_given, calcium_given, danger_signs_json, fetal_movement_ok
     FROM cached_anc_visits
     ORDER BY created_at DESC
     LIMIT 8`,
    [],
    'sample:ancVisits',
    errors,
  );
  if (sampleAncVisits.length === 0 && errors['sample:ancVisits']) {
    sampleAncVisits = await safeQuery<Record<string, unknown>>(
      db,
      `SELECT journey_id, visit_date, visit_number, ga_weeks, fundal_height_cm,
              weight_kg, bp_systolic, bp_diastolic, fetal_hr, presentation, engagement
       FROM cached_anc_visits ORDER BY created_at DESC LIMIT 8`,
      [],
      'sample:ancVisits:basic',
      errors,
    );
  }

  const sampleRisks = await safeQuery<Record<string, unknown>>(
    db,
    `SELECT journey_id, risk_level, triggered_rules, recommended_facility, screened_at
     FROM cached_anc_risks ORDER BY screened_at DESC LIMIT 5`,
    [],
    'sample:risks',
    errors,
  );

  const sampleLabor = await safeQuery<Record<string, unknown>>(
    db,
    `SELECT cp.hn, cp.an, cp.age, cp.gravida, cp.ga_weeks, cp.anc_count,
            cp.height_cm, cp.weight_kg, cp.fundal_height_cm, cp.us_weight_g,
            cp.hematocrit_pct, cp.labor_status, cp.admit_date,
            h.hcode, h.name as hospital_name
     FROM cached_patients cp
     JOIN hospitals h ON h.id = cp.hospital_id
     ORDER BY cp.created_at DESC LIMIT 5`,
    [],
    'sample:labor',
    errors,
  );

  const samplePartograph = await safeQuery<Record<string, unknown>>(
    db,
    `SELECT patient_id, hour_no, cervical_dilation_cm, fetal_heart_rate,
            bp_systolic, bp_diastolic, pulse, temperature,
            contraction_per_10min, contraction_duration_sec, contraction_strength,
            observe_datetime, note
     FROM cached_partograph_observations
     ORDER BY observe_datetime DESC LIMIT 5`,
    [],
    'sample:partograph',
    errors,
  );

  const sampleReferrals = await safeQuery<Record<string, unknown>>(
    db,
    `SELECT cr.refer_number, cr.status, cr.reason, cr.diagnosis_code,
            cr.urgency_level, cr.initiated_at,
            fh.hcode as from_hcode, th.hcode as to_hcode
     FROM cached_referrals cr
     JOIN hospitals fh ON fh.id = cr.from_hospital_id
     JOIN hospitals th ON th.id = cr.to_hospital_id
     ORDER BY cr.initiated_at DESC LIMIT 5`,
    [],
    'sample:referrals',
    errors,
  );

  const riskBreakdown = await safeQuery<{ anc_risk_level: string; n: number }>(
    db,
    `SELECT anc_risk_level, COUNT(*) as n FROM maternal_journeys GROUP BY anc_risk_level`,
    [],
    'dist:risk',
    errors,
  );

  // Patients that actually have partograph observations — handy for clicking
  // through to /patients/<hcode>-<an> to spot-check the UI.
  const patientsWithPartograph = await safeQuery<Record<string, unknown>>(
    db,
    `SELECT h.hcode, cp.an, cp.hn, cp.age, cp.ga_weeks, cp.labor_status,
            COUNT(cpo.id) AS partograph_count,
            MAX(cpo.observe_datetime) AS last_observed_at
     FROM cached_partograph_observations cpo
     JOIN cached_patients cp ON cp.id = cpo.patient_id
     JOIN hospitals h ON h.id = cp.hospital_id
     GROUP BY h.hcode, cp.an, cp.hn, cp.age, cp.ga_weeks, cp.labor_status
     ORDER BY partograph_count DESC, last_observed_at DESC
     LIMIT 20`,
    [],
    'patients-with-partograph',
    errors,
  );

  // ─── CID-continuity audit ─────────────────────────────────────────────
  // Goal: measure how often a single CID connects multiple stages
  // (ANC journey → labor admission → partograph rows → referral) — ideally
  // also across hospitals (cross-hospital journey via referral).

  const cidJourneyMatchCount = await safeQuery<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n
     FROM cached_patients cp
     WHERE cp.cid_hash IS NOT NULL AND cp.cid_hash <> ''
       AND EXISTS (
         SELECT 1 FROM maternal_journeys mj
          WHERE mj.cid_hash = cp.cid_hash
       )`,
    [],
    'cid:patient-with-journey',
    errors,
  );

  const laborTotal = await safeQuery<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM cached_patients WHERE cid_hash IS NOT NULL AND cid_hash <> ''`,
    [],
    'cid:labor-total',
    errors,
  );

  const cidCrossHospital = await safeQuery<{ n: number }>(
    db,
    `SELECT COUNT(DISTINCT cp.cid_hash) AS n
     FROM cached_patients cp
     JOIN maternal_journeys mj ON mj.cid_hash = cp.cid_hash
     WHERE cp.hospital_id <> mj.hospital_id`,
    [],
    'cid:cross-hospital',
    errors,
  );

  // Referrals: do their (hashed) CIDs match any journey or cached patient?
  const referralCidMatchJourney = await safeQuery<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n
     FROM cached_referrals cr
     WHERE EXISTS (
       SELECT 1 FROM maternal_journeys mj WHERE mj.id = cr.journey_id
     )`,
    [],
    'cid:referral-with-journey',
    errors,
  );

  const referralTotal = await safeQuery<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM cached_referrals`,
    [],
    'cid:referral-total',
    errors,
  );

  // Full-graph chain: CID has both a journey AND a labor admission AND
  // at least one partograph observation. This is the "full journey" case.
  const fullGraph = await safeQuery<Record<string, unknown>>(
    db,
    `SELECT mj.cid_hash, mj.id AS journey_id,
            COUNT(DISTINCT cp.id) AS labor_count,
            COUNT(DISTINCT cpo.id) AS partograph_count,
            COUNT(DISTINCT cr.id) AS referral_count
     FROM maternal_journeys mj
     LEFT JOIN cached_patients cp
            ON cp.cid_hash = mj.cid_hash
     LEFT JOIN cached_partograph_observations cpo
            ON cpo.patient_id = cp.id
     LEFT JOIN cached_referrals cr
            ON cr.journey_id = mj.id
     WHERE mj.cid_hash IS NOT NULL AND mj.cid_hash <> ''
     GROUP BY mj.cid_hash, mj.id
     HAVING COUNT(DISTINCT cp.id) > 0
     ORDER BY partograph_count DESC
     LIMIT 10`,
    [],
    'cid:full-graph',
    errors,
  );

  const continuityAudit = {
    laborTotal: Number(laborTotal[0]?.n ?? 0),
    laborWithMatchingJourney: Number(cidJourneyMatchCount[0]?.n ?? 0),
    crossHospitalCidMatches: Number(cidCrossHospital[0]?.n ?? 0),
    referralTotal: Number(referralTotal[0]?.n ?? 0),
    referralLinkedToJourney: Number(referralCidMatchJourney[0]?.n ?? 0),
    fullGraphSamples: fullGraph,
  };

  const bloodGroupDist = await safeQuery<{ blood_group: string; n: number }>(
    db,
    `SELECT COALESCE(blood_group, '—') as blood_group, COUNT(*) as n
     FROM maternal_journeys GROUP BY blood_group`,
    [],
    'dist:blood',
    errors,
  );
  const rhDist = await safeQuery<{ rh_factor: string; n: number }>(
    db,
    `SELECT COALESCE(rh_factor, '—') as rh_factor, COUNT(*) as n
     FROM maternal_journeys GROUP BY rh_factor`,
    [],
    'dist:rh',
    errors,
  );

  // Parse triggered_rules JSON strings into arrays (pglite returns as string).
  const parseMaybeJson = (v: unknown): unknown => {
    if (typeof v === 'string') {
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    }
    return v;
  };
  const normalizedRisks = sampleRisks.map((r) => ({
    ...r,
    triggered_rules: parseMaybeJson(r.triggered_rules),
  }));
  const normalizedVisits = sampleAncVisits.map((v) => ({
    ...v,
    danger_signs_json: parseMaybeJson(v.danger_signs_json),
  }));

  return NextResponse.json({
    simStatus: simulationOrchestrator.status(),
    counts,
    riskBreakdown,
    bloodGroupDist,
    rhDist,
    patientsWithPartograph,
    continuityAudit,
    samples: {
      journeys: sampleJourneys,
      ancVisits: normalizedVisits,
      risks: normalizedRisks,
      labor: sampleLabor,
      partograph: samplePartograph,
      referrals: sampleReferrals,
    },
    errors,
  });
}
