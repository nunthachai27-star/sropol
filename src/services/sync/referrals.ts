// Referral gateway sync — plan: docs/superpowers/plans/2026-07-20-referral-gateway-sync.md
//
// Phase 1 (origin side): processBrowserReferouts ingests HOSxP `referout` rows
// pushed by the origin hospital's browser gateway, upserting cached_referrals
// on the SAME compound key the webhook path uses (from_hospital_id +
// refer_number) so both ingest paths converge on one row. Unlike the webhook
// processor it NEVER creates maternal journeys — a referral alone is weak
// identity evidence (ghost-journey incident c80e9be); rows without an existing
// journey for the CID are skipped and counted.
//
// Phase 2 (destination side): processBrowserReferins matches HOSxP `referin`
// rows pushed by the DESTINATION hospital against open referrals headed there
// (origin hcode + patient CID + bounded date window — referin's exact-key
// column referout_number exists in the schema but is unpopulated at live
// sites) and marks them ARRIVED. Guards from the adversarial review:
//   - 30-day lower bound on initiation age, so a fresh referin can never flip
//     a months-old stuck INITIATED row with a fabricated arrival;
//   - one evidence row arrives at most one referral (dedupe on journey +
//     destination + arrival timestamp), so a re-pulled referin can't
//     double-arrive after the origin gateway catches up;
//   - journey ownership moves only for non-DELIVERED journeys and only when
//     this arrival is the journey's NEWEST arrival evidence (out-of-order
//     60-day backfills must not leave a round-trip patient at the wrong
//     hospital). Ownership move only — no journey creation, so there is no
//     CID-collision surface. arrived_at approximates from referin.refer_date
//     (mirrors the origin send date — best evidence available).
import { createHash } from 'crypto';
import type { DatabaseAdapter } from '@/db/adapter';
import { getActiveJourneyByCid } from '@/services/journey';
import { normalizeHosxpDate } from '@/lib/hosxp-date';
import { decryptSafe } from '@/lib/encryption';
import { logger } from '@/lib/logger';

export interface BrowserReferoutRow {
  refer_number?: string | null;
  refer_date?: string | Date | null;
  refer_time?: string | null;
  /** Destination hospital HCODE. */
  refer_hospcode?: string | null;
  pre_diagnosis?: string | null;
  /** ICD-10 principal diagnosis. HOSxP referout has NO icd10 column — the
   *  real column is pdx (live-schema verified); icd10 kept as a legacy alias
   *  for payloads mapped elsewhere. */
  pdx?: string | null;
  icd10?: string | null;
  referout_emergency_type_id?: number | null;
  hn?: string | null;
  cid?: string | null;
}

export interface BrowserReferinRow {
  hn?: string | null;
  cid?: string | null;
  /** Origin hospital HCODE the patient was referred FROM. */
  refer_hospcode?: string | null;
  refer_date?: string | Date | null;
  refer_time?: string | null;
}

/** ovst fallback: some hospitals never fill the refer-in form, so ANY visit
 *  at the destination after the referral date is arrival evidence. The
 *  gateway only probes CIDs the server handed out (getReferralArrivalProbe). */
export interface BrowserVisitEvidenceRow {
  cid?: string | null;
  visit_date?: string | Date | null;
  /** `YYYY-MM-DD HH:MM:SS` (Bangkok local) — carries the ovst vsttime so the
   *  arrival isn't stamped midnight. Preferred over visit_date when present. */
  visit_datetime?: string | null;
}

export interface ReferralArrivalProbeEntry {
  /** เลขบัตรประชาชน of a woman with an open referral TO the requesting
   *  hospital — a legitimate care-communication disclosure to the readwrite
   *  destination session only. */
  cid: string;
  /** Earliest visit date worth probing (initiation date - 1d slack). */
  since: string;
}

export interface BrowserReferoutsResult {
  rowsRead: number;
  created: number;
  upserted: number;
  skippedNoJourney: number;
  skippedUnknownHospital: number;
  skippedInvalid: number;
  /** Same (from_hospital, refer_number) but initiated ≫ this row's refer_date
   *  — HOSxP sites reuse refer_number across years; never overwrite. */
  skippedKeyReuse: number;
  failed: number;
}

export interface BrowserReferinsResult {
  rowsRead: number;
  arrived: number;
  /** Arrivals whose journey ownership was actually moved (DELIVERED journeys
   *  and out-of-order backfills arrive without moving ownership). */
  ownershipMoves: number;
  skippedNoMatch: number;
  skippedInvalid: number;
  failed: number;
}

/** Referin evidence may predate cached initiation slightly (clock/date skew). */
const REFERIN_MATCH_SLACK_MS = 24 * 3600 * 1000;
/** A referin only matches referrals initiated within this window before it —
 *  guards months-old stuck INITIATED rows from being falsely flipped by a
 *  fresh arrival (review finding: no lower bound = wrong-referral matches). */
const REFERIN_MATCH_MAX_AGE_MS = 30 * 86_400_000;
/** Upsert guard: an existing row initiated further than this from the pulled
 *  refer_date is a different physical referral wearing a reused number. */
const KEY_REUSE_GUARD_MS = 90 * 86_400_000;

async function hospitalIdByHcode(db: DatabaseAdapter, hcode: string): Promise<string | null> {
  const rows = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [hcode]);
  return rows.length > 0 ? rows[0].id : null;
}

/** Coerce a pg/browser-serialized date value to Gregorian `YYYY-MM-DD`, or
 *  null. Buddhist-Era years (พ.ศ. > 2400) are normalized first — some HOSxP
 *  sites store BE in DATE columns (see hosxp-date.ts). */
function dateOnly(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  const raw = value instanceof Date ? value.toISOString() : String(value);
  const s = normalizeHosxpDate(raw) ?? '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : null;
}

/** HOSxP refer_date/time are Bangkok local; keep the offset explicit. */
function toEventIso(date: string | null, time: string | null | undefined): string | null {
  if (!date) return null;
  const t = time && /^\d{2}:\d{2}/.test(time) ? time.slice(0, 8).padEnd(8, ':00') : '00:00:00';
  const parsed = new Date(`${date}T${t}+07:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toMs(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const ms = new Date(value instanceof Date ? value.toISOString() : String(value)).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export async function processBrowserReferouts(
  db: DatabaseAdapter,
  hospitalId: string,
  rows: BrowserReferoutRow[],
): Promise<BrowserReferoutsResult> {
  const result: BrowserReferoutsResult = {
    rowsRead: rows.length,
    created: 0,
    upserted: 0,
    skippedNoJourney: 0,
    skippedUnknownHospital: 0,
    skippedInvalid: 0,
    skippedKeyReuse: 0,
    failed: 0,
  };

  for (const row of rows) {
    try {
      const referNumber = row.refer_number?.trim();
      const cid = row.cid?.trim();
      const referDate = dateOnly(row.refer_date);
      if (!referNumber || !cid || !referDate) {
        result.skippedInvalid++;
        continue;
      }

      const toHcode = row.refer_hospcode?.trim();
      const toHospitalId = toHcode ? await hospitalIdByHcode(db, toHcode) : null;
      if (!toHospitalId) {
        result.skippedUnknownHospital++;
        continue;
      }

      const cidHash = createHash('sha256').update(cid).digest('hex');
      const journey = await getActiveJourneyByCid(db, cidHash);
      if (!journey) {
        result.skippedNoJourney++;
        continue;
      }

      const reason = (row.pre_diagnosis ?? '').trim().slice(0, 500) || 'refer จาก HOSxP';
      const diagnosisCode = (row.pdx ?? row.icd10)?.trim() || null;
      const urgency = row.referout_emergency_type_id != null ? 'EMERGENCY' : 'ROUTINE';
      const now = new Date().toISOString();
      const referDateMs = toMs(referDate) ?? 0;

      const existing = await db.query<{ id: string; initiated_at: string | Date }>(
        `SELECT id, initiated_at FROM cached_referrals WHERE from_hospital_id = ? AND refer_number = ?`,
        [hospitalId, referNumber],
      );

      if (existing.length > 0) {
        // HOSxP refer numbers reset (yearly at some sites): if the cached row
        // was initiated far from this row's refer_date it is a DIFFERENT
        // physical referral — never overwrite it.
        const existingMs = toMs(existing[0].initiated_at);
        if (existingMs != null && Math.abs(existingMs - referDateMs) > KEY_REUSE_GUARD_MS) {
          result.skippedKeyReuse++;
          continue;
        }
        // Refresh descriptive fields only — the lifecycle status is owned by
        // the state machine / arrival evidence and must never regress on a
        // re-pull.
        await db.execute(
          `UPDATE cached_referrals SET to_hospital_id = ?, reason = ?, diagnosis_code = ?, urgency_level = ?, updated_at = ? WHERE id = ?`,
          [toHospitalId, reason, diagnosisCode, urgency, now, existing[0].id],
        );
        result.upserted++;
      } else {
        const { randomUUID } = await import('crypto');
        const initiatedAt = toEventIso(referDate, row.refer_time) ?? now;
        await db.execute(
          `INSERT INTO cached_referrals (id, journey_id, refer_number, from_hospital_id, to_hospital_id, status, reason, diagnosis_code, urgency_level, initiated_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'INITIATED', ?, ?, ?, ?, ?, ?)`,
          [
            randomUUID(),
            journey.id,
            referNumber,
            hospitalId,
            toHospitalId,
            reason,
            diagnosisCode,
            urgency,
            initiatedAt,
            now,
            now,
          ],
        );
        result.created++;
      }
    } catch {
      // Per-row isolation: one poison row never blocks the rest of the batch.
      result.failed++;
    }
  }

  if (result.created > 0 || result.upserted > 0 || result.failed > 0) {
    logger.info('browser_referouts_synced', { hospitalId, ...result });
  }
  return result;
}

export async function processBrowserReferins(
  db: DatabaseAdapter,
  hospitalId: string,
  rows: BrowserReferinRow[],
): Promise<BrowserReferinsResult> {
  const result: BrowserReferinsResult = {
    rowsRead: rows.length,
    arrived: 0,
    ownershipMoves: 0,
    skippedNoMatch: 0,
    skippedInvalid: 0,
    failed: 0,
  };

  for (const row of rows) {
    try {
      const cid = row.cid?.trim();
      const fromHcode = row.refer_hospcode?.trim();
      const referDate = dateOnly(row.refer_date);
      if (!cid || !fromHcode || !referDate) {
        result.skippedInvalid++;
        continue;
      }

      const fromHospitalId = await hospitalIdByHcode(db, fromHcode);
      if (!fromHospitalId) {
        result.skippedNoMatch++;
        continue;
      }

      const cidHash = createHash('sha256').update(cid).digest('hex');
      const arrivalIso = toEventIso(referDate, row.refer_time) ?? new Date().toISOString();
      await applyArrivalEvidence(db, hospitalId, { cidHash, arrivalIso, fromHospitalId }, result);
    } catch {
      result.failed++;
    }
  }

  if (result.arrived > 0 || result.failed > 0) {
    logger.info('browser_referins_arrived', { hospitalId, ...result });
  }
  return result;
}

/**
 * ovst fallback (operator knowledge: some hospitals never fill the refer-in
 * form): any visit at the destination after the referral date is arrival
 * evidence. Rows come from the gateway probing ONLY the CIDs the server
 * handed out via getReferralArrivalProbe. No origin constraint — the match is
 * destination + CID + the same bounded initiation window and guards.
 */
export async function processBrowserVisitEvidences(
  db: DatabaseAdapter,
  hospitalId: string,
  rows: BrowserVisitEvidenceRow[],
): Promise<BrowserReferinsResult> {
  const result: BrowserReferinsResult = {
    rowsRead: rows.length,
    arrived: 0,
    ownershipMoves: 0,
    skippedNoMatch: 0,
    skippedInvalid: 0,
    failed: 0,
  };

  for (const row of rows) {
    try {
      const cid = row.cid?.trim();
      const rawDate = row.visit_datetime ?? row.visit_date;
      const visitDate = dateOnly(rawDate);
      if (!cid || !visitDate) {
        result.skippedInvalid++;
        continue;
      }
      const visitTime =
        typeof row.visit_datetime === 'string'
          ? (row.visit_datetime.match(/\d{2}:\d{2}(:\d{2})?/)?.[0] ?? null)
          : null;
      const cidHash = createHash('sha256').update(cid).digest('hex');
      const arrivalIso = toEventIso(visitDate, visitTime) ?? new Date().toISOString();
      await applyArrivalEvidence(db, hospitalId, { cidHash, arrivalIso }, result);
    } catch {
      result.failed++;
    }
  }

  if (result.arrived > 0 || result.failed > 0) {
    logger.info('browser_visit_evidence_arrived', { hospitalId, ...result });
  }
  return result;
}

/**
 * The server-issued probe list for the ovst fallback: CIDs of women with an
 * open referral TO the requesting hospital, initiated recently enough to
 * still be matchable. The route MUST only hand this to a readwrite session of
 * that same active hospital (care-communication disclosure to the legitimate
 * destination).
 */
export async function getReferralArrivalProbe(
  db: DatabaseAdapter,
  hospitalId: string,
): Promise<ReferralArrivalProbeEntry[]> {
  const horizon = new Date(Date.now() - REFERIN_MATCH_MAX_AGE_MS).toISOString();
  const rows = await db.query<{ cid: string | null; initiated_at: string | Date }>(
    `SELECT mj.cid, cr.initiated_at
     FROM cached_referrals cr
     JOIN maternal_journeys mj ON mj.id = cr.journey_id
     WHERE cr.to_hospital_id = ?
       AND cr.status IN ('INITIATED', 'ACCEPTED', 'IN_TRANSIT')
       AND cr.initiated_at >= ?
     ORDER BY cr.initiated_at DESC
     LIMIT 100`,
    [hospitalId, horizon],
  );
  const entries: ReferralArrivalProbeEntry[] = [];
  for (const row of rows) {
    const cid = decryptSafe(row.cid);
    if (!/^\d{13}$/.test(cid)) continue;
    const initiatedMs = toMs(row.initiated_at);
    if (initiatedMs == null) continue;
    const since = new Date(initiatedMs - REFERIN_MATCH_SLACK_MS).toISOString().slice(0, 10);
    entries.push({ cid, since });
  }
  return entries;
}

/** Shared guarded arrival core for referin + ovst visit evidence. */
async function applyArrivalEvidence(
  db: DatabaseAdapter,
  destHospitalId: string,
  evidence: { cidHash: string; arrivalIso: string; fromHospitalId?: string },
  result: BrowserReferinsResult,
): Promise<void> {
  const arrivalMs = new Date(evidence.arrivalIso).getTime();
  const windowEnd = new Date(arrivalMs + REFERIN_MATCH_SLACK_MS).toISOString();
  const windowStart = new Date(arrivalMs - REFERIN_MATCH_MAX_AGE_MS).toISOString();

  // Candidate: open referral →here for this patient, initiated inside
  // [evidence-30d, evidence+1d]. The dedupe NOT EXISTS makes one evidence row
  // (journey+destination+arrival timestamp) arrive at most one referral even
  // across re-pulled cycles.
  const originFilter = evidence.fromHospitalId ? 'AND cr.from_hospital_id = ?' : '';
  const params: unknown[] = [
    destHospitalId,
    evidence.cidHash,
    windowEnd,
    windowStart,
    evidence.arrivalIso,
  ];
  if (evidence.fromHospitalId) params.push(evidence.fromHospitalId);
  const candidates = await db.query<{ id: string; journey_id: string }>(
    `SELECT cr.id, cr.journey_id
     FROM cached_referrals cr
     JOIN maternal_journeys mj ON mj.id = cr.journey_id
     WHERE cr.to_hospital_id = ?
       AND cr.status IN ('INITIATED', 'ACCEPTED', 'IN_TRANSIT')
       AND mj.cid_hash = ?
       AND cr.initiated_at <= ?
       AND cr.initiated_at >= ?
       AND NOT EXISTS (
         SELECT 1 FROM cached_referrals dup
         WHERE dup.journey_id = cr.journey_id
           AND dup.to_hospital_id = cr.to_hospital_id
           AND dup.status = 'ARRIVED'
           AND dup.arrived_at = ?
       )
       ${originFilter}
     ORDER BY cr.initiated_at DESC
     LIMIT 1`,
    params,
  );
  if (candidates.length === 0) {
    result.skippedNoMatch++;
    return;
  }

  const now = new Date().toISOString();
  await db.execute(
    `UPDATE cached_referrals SET status = 'ARRIVED', arrived_at = ?, updated_at = ? WHERE id = ?`,
    [evidence.arrivalIso, now, candidates[0].id],
  );
  result.arrived++;

  // Ownership follows the journey's NEWEST arrival evidence only, and never
  // moves after delivery — an out-of-order backfill must not strand a
  // round-trip patient at the wrong hospital. (Adapter execute() returns
  // void, so the guard is evaluated explicitly to keep the counter honest.)
  const movable = await db.query<{ id: string }>(
    `SELECT mj.id FROM maternal_journeys mj
     WHERE mj.id = ?
       AND mj.care_stage <> 'DELIVERED'
       AND NOT EXISTS (
         SELECT 1 FROM cached_referrals newer
         WHERE newer.journey_id = mj.id
           AND newer.status = 'ARRIVED'
           AND newer.arrived_at > ?
       )`,
    [candidates[0].journey_id, evidence.arrivalIso],
  );
  if (movable.length > 0) {
    await db.execute(
      `UPDATE maternal_journeys SET current_hospital_id = ?, updated_at = ? WHERE id = ?`,
      [destHospitalId, now, candidates[0].journey_id],
    );
    result.ownershipMoves++;
  }
}
