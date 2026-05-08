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
import { evaluateAncRisk } from '@/services/anc-risk';
import type { AncRiskInput } from '@/config/anc-risk-rules';
import { HOSXP_RISK_TO_LAB_FLAGS } from '@/config/anc-risk-rules';
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
    const cidHash = anc.cid
      ? createHash('sha256').update(anc.cid).digest('hex')
      : null;
    const encryptedCid = anc.cid ? encrypt(anc.cid, encryptionKey) : null;
    const age = calculateAge(anc.birthday);

    let journey = (cidHash ? await getActiveJourneyByCid(db, cidHash) : null)
      ?? await getJourneyByHn(db, anc.hn, hospitalId);

    // Same Date-vs-string trap as in webhook.ts:processAncWebhook —
    // journey.lmp is a Date at runtime even though the type says string,
    // so raw `!==` always fires and creates a fresh journey every cycle.
    // Normalise to "YYYY-MM-DD" before comparing.
    const isNewPregnancy = journey && (
      (anc.preg_no > journey.gravida) ||
      (anc.lmp != null && journey.lmp != null && !isoDatesEqual(anc.lmp, journey.lmp))
    );
    const existingIsActive = journey && (journey.careStage === 'PREGNANCY' || journey.careStage === 'LABOR');

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
      if (isNewPregnancy && existingIsActive && journey) {
        await transitionToDelivered(db, journey.id);
      }
      journey = await createJourney(db, {
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
      });
    } else {
      const now = new Date().toISOString();
      await db.execute(
        `UPDATE maternal_journeys SET name = ?, cid = ?, cid_hash = ?, age = ?, lmp = ?, edc = ?, person_anc_id = ?, synced_at = ?, updated_at = ? WHERE id = ?`,
        [encryptedName, encryptedCid, cidHash, age, anc.lmp, anc.edc, anc.person_anc_id, now, now, journey!.id],
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
      // the journey detail timeline can show per-visit hospital.
      await upsertAncVisit(db, currentJourney.id, hospitalId, visit);
    }

    const now = new Date().toISOString();
    const lastVisit = visits.length > 0
      ? visits.sort((a, b) => a.service_date.localeCompare(b.service_date)).at(-1)
      : null;
    await db.execute(
      `UPDATE maternal_journeys SET anc_visit_count = ?, last_anc_date = ?, updated_at = ? WHERE id = ?`,
      [visits.length, lastVisit?.service_date ?? null, now, currentJourney.id],
    );

    const patientRisks = ancRisks.filter((r) => r.person_anc_id === anc.person_anc_id);
    const patientClassifying = ancClassifying.filter((c) => c.person_anc_id === anc.person_anc_id);
    const latestVisit = lastVisit;

    const firstVisitWithHeight = visits.find((v) => v.height != null);
    const heightCm = firstVisitWithHeight?.height ?? 160;

    const firstVisitWeight = visits.find((v) => v.bw != null)?.bw;
    const prePregnancyBmi = (firstVisitWeight && heightCm > 0)
      ? (firstVisitWeight / ((heightCm / 100) ** 2))
      : 22;

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
      prePregnancyBmi,
      gravida: anc.preg_no,
      bpSystolic: latestVisit?.bps ?? 120,
      bpDiastolic: latestVisit?.bpd ?? 80,
      o2Sat: 98,
      hct: 36,
      hb: 12,
      hosxpRiskIds: patientRisks.map((r) => r.anc_risk_id),
      classifyingItems: patientClassifying.map((c) => ({
        itemId: c.person_anc_classifying_item_id,
        value: c.check_value,
      })),
      ...labFlags,
    };

    const riskResult = evaluateAncRisk(riskInput);

    await upsertAncRisk(db, currentJourney.id, riskResult, riskInput);

    await db.execute(
      `UPDATE maternal_journeys SET anc_risk_level = ?, updated_at = ? WHERE id = ?`,
      [riskResult.level, now, currentJourney.id],
    );

    count++;
  }

  if (skippedInvalidCid > 0) {
    logger.warn('anc_sync_skipped_invalid_cids', {
      hospitalId,
      skipped: skippedInvalidCid,
      ingested: count,
    });
  }
  return count;
}

async function upsertAncVisit(
  db: DatabaseAdapter,
  journeyId: string,
  hospitalId: string,
  visit: HosxpAncServiceRow,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM cached_anc_visits WHERE journey_id = ? AND visit_date = ?`,
    [journeyId, visit.service_date],
  );

  if (existing.length > 0) {
    await db.execute(
      `UPDATE cached_anc_visits SET hospital_id = ?, visit_number = ?, ga_weeks = ?, ga_days = ?,
       fundal_height_cm = ?, weight_kg = ?, bp_systolic = ?, bp_diastolic = ?,
       fetal_hr = ?, presentation = ?, engagement = ?, pass_quality = ?,
       provider_code = ?, synced_at = ? WHERE id = ?`,
      [hospitalId, visit.anc_service_number, visit.pa_week, visit.pa_day,
       visit.fundal_height, visit.bw, visit.bps, visit.bpd,
       visit.fetal_heart_rate, visit.baby_position, visit.baby_lead,
       visit.pass_quality === 'Y', visit.doctor_code, now,
       existing[0].id],
    );
  } else {
    await db.execute(
      `INSERT INTO cached_anc_visits (id, journey_id, hospital_id, visit_date, visit_number, ga_weeks, ga_days,
       fundal_height_cm, weight_kg, bp_systolic, bp_diastolic, fetal_hr,
       presentation, engagement, pass_quality, provider_code, synced_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), journeyId, hospitalId, visit.service_date, visit.anc_service_number,
       visit.pa_week, visit.pa_day, visit.fundal_height, visit.bw,
       visit.bps, visit.bpd, visit.fetal_heart_rate,
       visit.baby_position, visit.baby_lead,
       visit.pass_quality === 'Y', visit.doctor_code, now, now],
    );
  }
}

async function upsertAncRisk(
  db: DatabaseAdapter,
  journeyId: string,
  riskResult: { level: AncRiskLevel; triggeredRules: string[]; recommendation: { facilityTh: string; providerTh: string } },
  _riskInput: AncRiskInput,
): Promise<void> {
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO cached_anc_risks (id, journey_id, risk_level, triggered_rules, risk_factors,
     recommended_facility, recommended_provider, screened_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), journeyId, riskResult.level,
     JSON.stringify(riskResult.triggeredRules), JSON.stringify({}),
     riskResult.recommendation.facilityTh, riskResult.recommendation.providerTh,
     now, now],
  );
}

export async function linkJourneyToLabor(
  db: DatabaseAdapter,
  hospitalId: string,
  patientHn: string,
  cachedPatientId: string,
  cidHash?: string | null,
  encryptedCid?: string | null,
): Promise<string> {
  let journey = (cidHash ? await getActiveJourneyByCid(db, cidHash) : null)
    ?? await getJourneyByHn(db, patientHn, hospitalId);

  if (journey) {
    await db.execute(
      `UPDATE cached_patients SET journey_id = ? WHERE id = ?`,
      [journey.id, cachedPatientId],
    );
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

  await db.execute(
    `UPDATE cached_patients SET journey_id = ? WHERE id = ?`,
    [journey.id, cachedPatientId],
  );

  return journey.id;
}
