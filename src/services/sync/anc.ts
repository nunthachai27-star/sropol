// ANC sync — HOSxP person_anc rows → maternal_journeys + cached_anc_visits + cached_anc_risks
// Includes linkJourneyToLabor (ANC journey → labor admission link)
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import type { DatabaseAdapter } from '@/db/adapter';
import type {
  HosxpPersonAncRow,
  HosxpAncServiceRow,
  HosxpAncRiskRow,
  HosxpAncClassifyingRow,
  HosxpPatientAddressRow,
} from '@/types/hosxp';
import { encrypt } from '@/lib/encryption';
import { calculateAge } from '@/lib/utils';
import { isValidThaiCidChecksum } from '@/lib/cid';
import { isoDatesEqual } from '@/lib/dates';
import {
  createJourney,
  getActiveJourneyByCid,
  getJourneyByHn,
  transitionToLabor,
  transitionToDelivered,
} from '@/services/journey';
import { evaluateAncRisk, type AncRiskResult } from '@/services/anc-risk';
import { insertAncScreeningIfChanged } from '@/services/anc-screening';
import { prePregnancyBmi } from '@/services/anc-clinical';
import type { AncRiskInput } from '@/config/anc-risk-rules';
import { HOSXP_RISK_TO_LAB_FLAGS, ANC_RISK_LEVEL_ORDER } from '@/config/anc-risk-rules';
import { AncRiskLevel } from '@/types/domain';
import { logger } from '@/lib/logger';

export async function syncAncData(
  db: DatabaseAdapter,
  hospitalId: string,
  ancPatients: HosxpPersonAncRow[],
  ancServices: HosxpAncServiceRow[],
  ancRisks: HosxpAncRiskRow[],
  ancClassifying: HosxpAncClassifyingRow[],
  encryptionKey: string,
  patientAddresses?: HosxpPatientAddressRow[],
): Promise<number> {
  const addressMap = new Map<string, HosxpPatientAddressRow>();
  if (patientAddresses) {
    for (const addr of patientAddresses) {
      addressMap.set(addr.hn, addr);
    }
  }
  let count = 0;
  let skippedInvalidCid = 0;
  let incompleteAssessments = 0;
  let downgradesBlocked = 0;
  let visitConflicts = 0;

  for (const anc of ancPatients) {
    // Per-row CID gate. The polling-level fingerprint (pollHospital) already
    // suspends a whole cycle when the FIRST row's CID is malformed, but old
    // HOSxP versions can mix valid + 13-digit-but-fake values within the
    // same payload (observed at hcode 10996: ~148 rows, all checksum-
    // invalid). Skip individual bad rows so the rest of the batch ingests
    // cleanly. Format-level rejection (not 13 digits) is hard-skip; failed
    // checksum is a soft-skip with a warning so legitimate non-Thai
    // patients don't silently disappear if a hospital uses placeholder CIDs.
    const rawCid: string = typeof anc.cid === 'string' ? anc.cid.trim() : '';
    if (!/^\d{13}$/.test(rawCid)) {
      skippedInvalidCid++;
      logger.warn('anc_skipped_invalid_cid_format', {
        hospitalId,
        hn: anc.hn,
        cidLength: rawCid.length,
        cidSample: rawCid ? `${rawCid.slice(0, 6)}…` : '(empty)',
      });
      continue;
    }
    if (!isValidThaiCidChecksum(rawCid)) {
      skippedInvalidCid++;
      logger.warn('anc_skipped_invalid_cid_checksum', {
        hospitalId,
        hn: anc.hn,
        // Don't log the raw CID — log a hash prefix so the row is traceable
        // without leaking PDPA-protected data into structured logs.
        cidHashPrefix: createHash('sha256').update(rawCid).digest('hex').slice(0, 8),
      });
      continue;
    }

    const fullName = `${anc.pname}${anc.fname} ${anc.lname}`.trim();
    const encryptedName = encrypt(fullName, encryptionKey);
    const cidHash = anc.cid ? createHash('sha256').update(anc.cid).digest('hex') : null;
    const encryptedCid = anc.cid ? encrypt(anc.cid, encryptionKey) : null;
    const age = calculateAge(anc.birthday);

    let journey =
      (cidHash ? await getActiveJourneyByCid(db, cidHash) : null) ??
      (await getJourneyByHn(db, anc.hn, hospitalId));

    // Same Date-vs-string trap as in webhook.ts:processAncWebhook —
    // journey.lmp is a Date at runtime even though the type says string,
    // so raw `!==` always fires and creates a fresh journey every cycle.
    // Normalise to "YYYY-MM-DD" before comparing.
    const isNewPregnancy =
      journey &&
      (anc.preg_no > journey.gravida ||
        (anc.lmp != null && journey.lmp != null && !isoDatesEqual(anc.lmp, journey.lmp)));
    const existingIsActive =
      journey && (journey.careStage === 'PREGNANCY' || journey.careStage === 'LABOR');

    if (isNewPregnancy && existingIsActive && journey) {
      const daysSinceUpdate = Math.floor(
        (Date.now() - journey.updatedAt.getTime()) / (1000 * 60 * 60 * 24),
      );
      logger.warn('pregnancy_overlap', {
        hn: anc.hn,
        newPregNo: anc.preg_no,
        oldPregNo: journey.gravida,
        oldCareStage: journey.careStage,
        journeyId: journey.id,
        daysSinceUpdate,
      });
    }

    const shouldCreateNew = !journey || isNewPregnancy;

    if (shouldCreateNew) {
      // If the old journey is still in PREGNANCY/LABOR for this hospital,
      // transition it to DELIVERED first. A new preg_no on the same HN
      // means the previous pregnancy has ended in HOSxP — without this
      // step the unique partial index uq_mj_hospital_hn_active rejects
      // the INSERT below and the whole ANC sync cycle fails for the
      // hospital. Skip when there's no existing journey or it's already
      // past DELIVERED.
      //
      // Rollover atomicity: closing the old pregnancy and creating the new
      // one commit together — a crash between the two statements can never
      // strand a mother with zero active journeys.
      const createInput = {
        hospitalId,
        hn: anc.hn,
        personAncId: anc.person_anc_id,
        name: encryptedName,
        cid: encryptedCid ?? '',
        cidHash: cidHash ?? '',
        age,
        gravida: anc.preg_no,
        para: 0,
        lmp: anc.lmp,
        edc: anc.edc,
        ancRiskLevel: AncRiskLevel.LOW,
      };
      journey =
        isNewPregnancy && existingIsActive && journey
          ? await db.transaction(async (tx) => {
              await transitionToDelivered(tx, journey!.id);
              return createJourney(tx, createInput);
            })
          : await createJourney(db, createInput);
    } else {
      const now = new Date().toISOString();
      await db.execute(
        `UPDATE maternal_journeys SET name = ?, cid = ?, cid_hash = ?, age = ?, lmp = ?, edc = ?, person_anc_id = ?, synced_at = ?, updated_at = ? WHERE id = ?`,
        [
          encryptedName,
          encryptedCid,
          cidHash,
          age,
          anc.lmp,
          anc.edc,
          anc.person_anc_id,
          now,
          now,
          journey!.id,
        ],
      );
    }

    const currentJourney = journey!;

    const addr = addressMap.get(anc.hn);
    if (addr && (addr.chwpart || addr.amppart || addr.tmbpart)) {
      const now2 = new Date().toISOString();
      await db.execute(
        `UPDATE maternal_journeys SET changwat_code = ?, amphur_code = ?, tambon_code = ?, updated_at = ? WHERE id = ?`,
        [addr.chwpart ?? null, addr.amppart ?? null, addr.tmbpart ?? null, now2, currentJourney.id],
      );
    }

    const visits = ancServices.filter((s) => s.person_anc_id === anc.person_anc_id);
    for (const visit of visits) {
      // hospitalId here is the hospital whose tunnel this sync ran against —
      // the visit was recorded at that hospital's HOSxP. Carries through so
      // the journey detail timeline can show per-visit hospital. A visit
      // date already owned by ANOTHER hospital is skipped (not overwritten).
      if (await upsertAncVisit(db, currentJourney.id, hospitalId, visit)) {
        visitConflicts++;
      }
    }

    const now = new Date().toISOString();
    const lastVisit =
      visits.length > 0
        ? visits.sort((a, b) => a.service_date.localeCompare(b.service_date)).at(-1)
        : null;
    // Roll-up = DB aggregate over ALL of the journey's surviving visits (every
    // hospital — the provincial history), not this payload's own length (WHO
    // containment T5). Cross-hospital conflict-skips mean payload length can
    // diverge from what is actually stored, so aggregate the real rows.
    await db.execute(
      `UPDATE maternal_journeys
          SET anc_visit_count = (SELECT COUNT(*) FROM cached_anc_visits WHERE journey_id = ?),
              last_anc_date = (SELECT MAX(visit_date) FROM cached_anc_visits WHERE journey_id = ?),
              updated_at = ?
        WHERE id = ?`,
      [currentJourney.id, currentJourney.id, now, currentJourney.id],
    );

    const patientRisks = ancRisks.filter((r) => r.person_anc_id === anc.person_anc_id);
    const patientClassifying = ancClassifying.filter((c) => c.person_anc_id === anc.person_anc_id);
    const latestVisit = lastVisit;

    // Completeness-aware inputs (WHO containment T3): a missing measurement stays
    // `null` — NEVER a fabricated healthy value. `heightCm` is the first real
    // recorded height, BMI is derived from real height+earliest weight via the
    // shared clinical helper (guards <100cm and 0 weight, rounds to 1dp), and
    // o2Sat/hct/hb are always null because this HOSxP polling query never
    // provides them.
    const heightCm = visits.find((v) => v.height != null)?.height ?? null;
    const firstVisitWeight = visits.find((v) => v.bw != null)?.bw ?? null;
    const bmi = prePregnancyBmi(heightCm, firstVisitWeight);

    const labFlags = {
      rhNegative: false,
      hbsAgPositive: false,
      syphilisPositive: false,
      hivPositive: false,
      thalassemiaDisease: false,
      niptHighRisk: false,
    };
    for (const riskId of patientRisks.map((r) => r.anc_risk_id)) {
      const flagKey = HOSXP_RISK_TO_LAB_FLAGS[riskId];
      if (flagKey) {
        labFlags[flagKey] = true;
      }
    }

    const riskInput: AncRiskInput = {
      age,
      heightCm,
      prePregnancyBmi: bmi,
      gravida: anc.preg_no,
      bpSystolic: latestVisit?.bps ?? null,
      bpDiastolic: latestVisit?.bpd ?? null,
      o2Sat: null,
      hct: null,
      hb: null,
      hosxpRiskIds: patientRisks.map((r) => r.anc_risk_id),
      classifyingItems: patientClassifying.map((c) => ({
        itemId: c.person_anc_classifying_item_id,
        value: c.check_value,
      })),
      ...labFlags,
    };

    const riskResult = evaluateAncRisk(riskInput);
    if (riskResult.assessmentIncomplete) incompleteAssessments++;

    // Downgrade guard (WHO containment T3): missing evidence can never LOWER a
    // previously-known risk. When the assessment is incomplete AND the derived
    // level is below the journey's current level, keep the existing level and
    // do NOT append the rejected lower screening row (this also keeps the
    // reconciliation journey-vs-latest-screening report clean). Escalations and
    // complete assessments follow existing behavior.
    const existingLevel = currentJourney.ancRiskLevel;
    const isDowngrade =
      ANC_RISK_LEVEL_ORDER[riskResult.level] < ANC_RISK_LEVEL_ORDER[existingLevel];

    if (riskResult.assessmentIncomplete && isDowngrade) {
      downgradesBlocked++;
      logger.warn('anc_risk_downgrade_blocked', {
        hospitalId,
        journeyId: currentJourney.id,
        from: existingLevel,
        to: riskResult.level,
        reason: 'incomplete_assessment',
      });
    } else {
      await upsertAncRisk(db, currentJourney.id, riskResult);

      await db.execute(
        `UPDATE maternal_journeys SET anc_risk_level = ?, updated_at = ? WHERE id = ?`,
        [riskResult.level, now, currentJourney.id],
      );
    }

    count++;
  }

  if (skippedInvalidCid > 0) {
    logger.warn('anc_sync_skipped_invalid_cids', {
      hospitalId,
      skipped: skippedInvalidCid,
      ingested: count,
    });
  }

  // Aggregate assessment-completeness summary (non-PHI): how many rows this
  // cycle had at least one missing mandatory input, and how many risk
  // downgrades were blocked because the evidence was incomplete.
  logger.info('anc_sync_assessment_summary', {
    hospitalId,
    incompleteAssessments,
    downgradesBlocked,
    visitConflicts,
  });

  return count;
}

// Returns true when the incoming visit was SKIPPED because its
// (journey_id, visit_date) row is already owned by ANOTHER hospital — this
// hospital's payload must never overwrite or reattribute it (WHO containment
// T5). Same-hospital and NULL-hospital rows are updated as before (a
// NULL-hospital row gets CLAIMED by the updating hospital here because this
// polling path historically created those rows — acceptable ownership repair).
async function upsertAncVisit(
  db: DatabaseAdapter,
  journeyId: string,
  hospitalId: string,
  visit: HosxpAncServiceRow,
): Promise<boolean> {
  const now = new Date().toISOString();
  const existing = await db.query<{ id: string; hospital_id: string | null }>(
    `SELECT id, hospital_id FROM cached_anc_visits WHERE journey_id = ? AND visit_date = ?`,
    [journeyId, visit.service_date],
  );

  if (existing.length > 0) {
    const owner = existing[0].hospital_id;
    if (owner != null && owner !== hospitalId) {
      logger.warn('anc_cross_hospital_visit_conflict', {
        journeyId,
        hospitalId,
        conflictingHospitalId: owner,
      });
      return true;
    }
    await db.execute(
      `UPDATE cached_anc_visits SET hospital_id = ?, visit_number = ?, ga_weeks = ?, ga_days = ?,
       fundal_height_cm = ?, weight_kg = ?, bp_systolic = ?, bp_diastolic = ?,
       fetal_hr = ?, presentation = ?, engagement = ?, pass_quality = ?,
       provider_code = ?, synced_at = ? WHERE id = ?`,
      [
        hospitalId,
        visit.anc_service_number,
        visit.pa_week,
        visit.pa_day,
        visit.fundal_height,
        visit.bw,
        visit.bps,
        visit.bpd,
        visit.fetal_heart_rate,
        visit.baby_position,
        visit.baby_lead,
        visit.pass_quality === 'Y',
        visit.doctor_code,
        now,
        existing[0].id,
      ],
    );
  } else {
    await db.execute(
      `INSERT INTO cached_anc_visits (id, journey_id, hospital_id, visit_date, visit_number, ga_weeks, ga_days,
       fundal_height_cm, weight_kg, bp_systolic, bp_diastolic, fetal_hr,
       presentation, engagement, pass_quality, provider_code, synced_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        journeyId,
        hospitalId,
        visit.service_date,
        visit.anc_service_number,
        visit.pa_week,
        visit.pa_day,
        visit.fundal_height,
        visit.bw,
        visit.bps,
        visit.bpd,
        visit.fetal_heart_rate,
        visit.baby_position,
        visit.baby_lead,
        visit.pass_quality === 'Y',
        visit.doctor_code,
        now,
        now,
      ],
    );
  }
  return false;
}

async function upsertAncRisk(
  db: DatabaseAdapter,
  journeyId: string,
  riskResult: AncRiskResult,
): Promise<void> {
  await insertAncScreeningIfChanged(db, journeyId, {
    level: riskResult.level,
    triggeredRulesJson: JSON.stringify(riskResult.triggeredRules),
    // Persist completeness metadata (not fabricated vitals) into the existing
    // JSONB column so the UI/reconciliation can distinguish "measured healthy"
    // from "not measured".
    riskFactorsJson: JSON.stringify({
      missingRequired: riskResult.missingRequired,
      assessmentIncomplete: riskResult.assessmentIncomplete,
    }),
    recommendedFacility: riskResult.recommendation.facilityTh,
    recommendedProvider: riskResult.recommendation.providerTh,
  });
}

export async function linkJourneyToLabor(
  db: DatabaseAdapter,
  hospitalId: string,
  patientHn: string,
  cachedPatientId: string,
  cidHash?: string | null,
  encryptedCid?: string | null,
): Promise<string> {
  let journey =
    (cidHash ? await getActiveJourneyByCid(db, cidHash) : null) ??
    (await getJourneyByHn(db, patientHn, hospitalId));

  if (journey) {
    await db.execute(`UPDATE cached_patients SET journey_id = ? WHERE id = ?`, [
      journey.id,
      cachedPatientId,
    ]);
    if (journey.careStage === 'PREGNANCY') {
      await transitionToLabor(db, journey.id);
    }
    return journey.id;
  }

  journey = await createJourney(db, {
    hospitalId,
    hn: patientHn,
    personAncId: null,
    name: '',
    cid: encryptedCid ?? '',
    cidHash: cidHash ?? '',
    age: 0,
    gravida: 0,
    para: 0,
    lmp: null,
    edc: null,
    ancRiskLevel: AncRiskLevel.LOW,
  });

  await transitionToLabor(db, journey.id);

  await db.execute(`UPDATE cached_patients SET journey_id = ? WHERE id = ?`, [
    journey.id,
    cachedPatientId,
  ]);

  return journey.id;
}
