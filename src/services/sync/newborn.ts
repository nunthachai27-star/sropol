// Newborn sync — HOSxP labour_infant rows → cached_newborns + journey transition
import type { DatabaseAdapter } from '@/db/adapter';
import type { HosxpLabourInfantRow, HosxpIptPregnancyRow } from '@/types/hosxp';
import { upsertNewborn } from '@/services/newborn';
import { encrypt, getEncryptionKey } from '@/lib/encryption';
import { isValidThaiCidChecksum } from '@/lib/cid';
import { createHash, randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { normalizeHosxpDate, isPlausibleEventDate } from '@/lib/hosxp-date';
import { transitionToDelivered } from '@/services/journey';
import { CooperativeYielder } from '@/lib/event-loop';

/** A labour-infant row whose infant_number has passed hygiene: production
 *  HOSxP ships NULL at some sites (10998/11008), but cached_newborns requires
 *  it — see defaultMissingInfantNumbers. */
export type SanitizedInfantRow = HosxpLabourInfantRow & { infant_number: number };

export async function syncNewbornData(
  db: DatabaseAdapter,
  journeyId: string,
  infantRows: SanitizedInfantRow[],
): Promise<number> {
  let count = 0;

  for (const infant of infantRows) {
    const bornAt =
      infant.birth_date && infant.birth_time
        ? `${infant.birth_date}T${infant.birth_time}`
        : (infant.birth_date ?? new Date().toISOString());

    await upsertNewborn(db, {
      journeyId,
      infantNumber: infant.infant_number,
      sex: infant.sex ?? undefined,
      birthWeightG: infant.birth_weight ?? undefined,
      bodyLengthCm: infant.body_length ?? undefined,
      headCircumCm: infant.head_length ?? undefined,
      temperature: infant.temperature ?? undefined,
      heartRate: infant.hr ?? undefined,
      respiratoryRate: infant.rr ?? undefined,
      apgar1min: infant.apgar_score_min1 ?? undefined,
      apgar5min: infant.apgar_score_min5 ?? undefined,
      apgar10min: infant.apgar_score_min10 ?? undefined,
      resuscitation: {
        ppv: infant.infant_check_ppv === 'Y',
        et_tube: infant.infant_check_et_tube === 'Y',
        chest_pump: infant.infant_check_chest_pump === 'Y',
        oxygen_box: infant.infant_check_oxygen_box === 'Y',
        narcan: infant.infant_check_narcan === 'Y',
      },
      vaccinations: {
        bcg: infant.infant_check_bcg === 'Y',
        hepb: infant.infant_check_hepb === 'Y',
        vitk: infant.infant_check_vitk === 'Y',
        eye_paste: infant.infant_check_eyepaste === 'Y',
        azt: infant.infant_check_azt === 'Y',
      },
      infantIcd10: infant.infant_icd10 ?? undefined,
      infantHn: infant.infant_hn ?? undefined,
      infantAn: infant.infant_an ?? undefined,
      dischargeStatus: infant.infant_dchstts ?? undefined,
      bornAt,
    });
    count++;
  }

  if (infantRows.length > 0) {
    await transitionToDelivered(db, journeyId);
  }

  return count;
}

// ─── Polling-cycle glue ─────────────────────────────────────────────────────
// The per-journey syncNewbornData above predates the polling integration; the
// helpers below let the cycle fetch one LABOUR_INFANTS_SINCE batch per
// hospital and fan it out to journeys via cached_patients.an → journey_id.

/** First backfill window when a hospital has no cached newborns yet. */
const BACKFILL_LOOKBACK_DAYS = 365;
/** Re-read overlap so late edits to recent births are picked up. */
const REFRESH_OVERLAP_DAYS = 2;
const DAY_MS = 24 * 3600_000;

export interface NewbornSyncResult {
  rowsRead: number;
  upserted: number;
  journeys: number;
  skippedNoJourney: number;
  /** Retrospective journeys created for pre-registry deliveries. */
  createdJourneys: number;
  /** ANs whose persist threw and was isolated — the rest of the batch still
   *  landed (10998/11008 incident: one poison row used to kill everything). */
  failedAns: number;
}

/**
 * Self-healing HOSxP query cutoff (YYYY-MM-DD): two days before the latest
 * cached birth for this hospital, or a one-year backfill window when nothing
 * is cached yet. Idempotent upserts make the overlap safe.
 */
export async function newbornSyncCutoffDate(
  db: DatabaseAdapter,
  hospitalId: string,
  now: Date = new Date(),
): Promise<string> {
  const rows = await db.query<{ max_born: string | null }>(
    `SELECT MAX(cn.born_at) as max_born
       FROM cached_newborns cn
       JOIN maternal_journeys mj ON mj.id = cn.journey_id
      WHERE mj.hospital_id = ?`,
    [hospitalId],
  );
  const maxBorn = rows[0]?.max_born;
  const baseMs = maxBorn
    ? new Date(maxBorn).getTime() - REFRESH_OVERLAP_DAYS * DAY_MS
    : now.getTime() - BACKFILL_LOOKBACK_DAYS * DAY_MS;
  // Never let a poisoned future born_at push the cutoff past today — that
  // would make every subsequent HOSxP query return nothing, forever.
  return new Date(Math.min(baseMs, now.getTime())).toISOString().slice(0, 10);
}

function hasUsableInfantNumber(row: HosxpLabourInfantRow): boolean {
  return row.infant_number != null && Number.isFinite(Number(row.infant_number));
}

/**
 * infant_number hygiene (frozen-cutoff incident, hospitals 10998/11008):
 * production ipt_labour_infant rows arrive with NULL infant_number, but
 * cached_newborns.infant_number is NOT NULL and (journey_id, infant_number)
 * is the upsert key — one NULL used to abort the whole batch INSERT.
 *
 * Rows missing a usable number get a deterministic fallback: their 1-based
 * position within the AN group ordered by ipt_labour_infant_id (the HOSxP
 * PK; ties or non-numeric PKs fall back to birth date+time, then input
 * order), skipping upward past numbers another row explicitly claims — so
 * re-running the same batch assigns the same numbers and the idempotent
 * upsert keeps working. Original row order is preserved in the output.
 */
function defaultMissingInfantNumbers(
  hospitalId: string,
  an: string,
  rows: HosxpLabourInfantRow[],
): SanitizedInfantRow[] {
  if (rows.every(hasUsableInfantNumber)) {
    // Guarded by hasUsableInfantNumber — every infant_number is a number.
    return rows as SanitizedInfantRow[];
  }

  const order = rows
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => {
      const pkA = Number(a.row.ipt_labour_infant_id);
      const pkB = Number(b.row.ipt_labour_infant_id);
      if (Number.isFinite(pkA) && Number.isFinite(pkB) && pkA !== pkB) return pkA - pkB;
      const bornA = `${a.row.birth_date ?? ''}T${a.row.birth_time ?? ''}`;
      const bornB = `${b.row.birth_date ?? ''}T${b.row.birth_time ?? ''}`;
      if (bornA !== bornB) return bornA < bornB ? -1 : 1;
      return a.idx - b.idx;
    });

  const taken = new Set<number>();
  for (const { row } of order) {
    if (hasUsableInfantNumber(row)) taken.add(Number(row.infant_number));
  }

  const assigned = new Map<number, number>(); // original index → defaulted number
  order.forEach(({ row, idx }, position) => {
    if (hasUsableInfantNumber(row)) return;
    let candidate = position + 1;
    while (taken.has(candidate)) candidate += 1;
    taken.add(candidate);
    assigned.set(idx, candidate);
  });

  // Once per affected AN — same convention as newborn_rows_dropped_bad_date.
  logger.warn('newborn_infant_number_defaulted', { hospitalId, an, count: assigned.size });

  return rows.map((row, idx) => {
    const fallback = assigned.get(idx);
    return fallback === undefined
      ? (row as SanitizedInfantRow)
      : { ...row, infant_number: fallback };
  });
}

interface BirthResolutionItem {
  an: string;
  motherHn: string | null;
  bornMs: number;
  /** ISO born timestamp — registered_at for retrospective journeys. */
  bornAtIso?: string | null;
  motherCid?: string | null;
  motherName?: string | null;
  motherBirthday?: string | null;
  pregNumber?: number | null;
}

/**
 * For births still unresolved after resolveJourneysForBirths: reuse a journey
 * by the mother's CID hash (latest registered before the birth — matches the
 * repeat-mother rule), else create a minimal retrospective DELIVERED journey
 * so pre-registry deliveries are counted instead of skipped. Returns how many
 * journeys were created. Births with no usable identity stay unresolved.
 */
async function createRetroJourneysForUnresolved(
  db: DatabaseAdapter,
  hospitalId: string,
  items: BirthResolutionItem[],
  journeyByAn: Map<string, string>,
): Promise<number> {
  let created = 0;
  const key = getEncryptionKey();
  // Bounded cooperative yielding (page-stall fix part 2): the 365-day
  // backfill window can make this per-birth loop (query + insert each) large.
  // No transaction is held here — callers pass the top-level adapter.
  const yielder = new CooperativeYielder();
  for (const item of items) {
    await yielder.tick();
    if (journeyByAn.has(item.an)) continue;
    const cid =
      item.motherCid && isValidThaiCidChecksum(String(item.motherCid))
        ? String(item.motherCid)
        : null;
    if (!cid && !item.motherHn) continue; // no identity — stays skipped

    // cid_hash is NOT NULL. Real CIDs hash normally (unifying with any
    // existing journey for the same woman); HN-only mothers get a
    // deterministic namespaced hash — it can never equal a real CID hash,
    // and a second historical birth by the same mother reuses one journey.
    const cidHash = cid
      ? createHash('sha256').update(cid).digest('hex')
      : createHash('sha256').update(`retro-hn:${hospitalId}:${item.motherHn}`).digest('hex');
    {
      // Same person may already have a journey under another HN/hospital.
      const existing = await db.query<{ id: string; registered_at: string }>(
        `SELECT id, registered_at FROM maternal_journeys WHERE cid_hash = ?`,
        [cidHash],
      );
      if (existing.length > 0) {
        const sorted = existing
          .map((j) => ({ id: j.id, regMs: new Date(j.registered_at).getTime() }))
          .sort((a, b) => a.regMs - b.regMs);
        const before = sorted.filter((j) => j.regMs <= item.bornMs);
        journeyByAn.set(item.an, (before.length > 0 ? before[before.length - 1] : sorted[0]).id);
        continue;
      }
    }

    const bornIso = item.bornAtIso ?? new Date(item.bornMs).toISOString();
    const now = new Date().toISOString();
    const age = item.motherBirthday
      ? Math.max(
          0,
          Math.floor(
            (new Date(bornIso).getTime() - new Date(item.motherBirthday).getTime()) /
              (365.25 * 86_400_000),
          ),
        )
      : 0;
    const id = randomUUID();
    await db.execute(
      `INSERT INTO maternal_journeys
         (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age,
          gravida, para, care_stage, anc_risk_level, anc_visit_count,
          registered_at, stage_changed_at, synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'DELIVERED', 'LOW', 0, ?, ?, ?, ?, ?)`,
      [
        id,
        hospitalId,
        hospitalId,
        item.motherHn ?? '',
        encrypt(item.motherName ?? 'ไม่ระบุชื่อ (บันทึกย้อนหลัง)', key),
        // cid column is NOT NULL; unknown CID stores an encrypted empty
        // string while cid_hash stays NULL (no fake hash to collide on).
        encrypt(cid ?? '', key),
        cidHash,
        age,
        item.pregNumber ?? 1,
        bornIso,
        bornIso,
        now,
        now,
        now,
      ],
    );
    logger.info('retrospective_journey_created', {
      hospitalId,
      an: item.an,
      bornAt: bornIso.slice(0, 10),
      hasCid: cid != null,
    });
    journeyByAn.set(item.an, id);
    created += 1;
  }
  return created;
}

/**
 * Resolve mothers' ANs to journey IDs: cached_patients (hospital + AN)
 * first, then the mother's HN against maternal_journeys — for repeat
 * mothers, the pregnancy registered most recently BEFORE the birth wins.
 * Shared by the labour-infant batch and the ipt_pregnancy fallback.
 */
async function resolveJourneysForBirths(
  db: DatabaseAdapter,
  hospitalId: string,
  items: BirthResolutionItem[],
): Promise<Map<string, string>> {
  const journeyByAn = new Map<string, string>();
  if (items.length === 0) return journeyByAn;

  const ans = items.map((i) => i.an);
  const placeholders = ans.map(() => '?').join(',');
  const patientRows = await db.query<{ an: string; journey_id: string | null }>(
    `SELECT an, journey_id FROM cached_patients
      WHERE hospital_id = ? AND an IN (${placeholders})`,
    [hospitalId, ...ans],
  );
  for (const p of patientRows) {
    if (p.journey_id) journeyByAn.set(p.an, p.journey_id);
  }

  const unresolved = items.filter(
    (i): i is BirthResolutionItem & { motherHn: string } =>
      !journeyByAn.has(i.an) && i.motherHn !== null,
  );
  if (unresolved.length === 0) return journeyByAn;

  const hns = Array.from(new Set(unresolved.map((u) => u.motherHn)));
  const hnPlaceholders = hns.map(() => '?').join(',');
  const journeyRows = await db.query<{ id: string; hn: string; registered_at: string }>(
    `SELECT id, hn, registered_at FROM maternal_journeys
      WHERE hospital_id = ? AND hn IN (${hnPlaceholders})`,
    [hospitalId, ...hns],
  );
  const journeysByHn = new Map<string, Array<{ id: string; regMs: number }>>();
  for (const j of journeyRows) {
    const list = journeysByHn.get(j.hn) ?? [];
    list.push({ id: j.id, regMs: new Date(j.registered_at).getTime() });
    journeysByHn.set(j.hn, list);
  }
  for (const list of journeysByHn.values()) list.sort((a, b) => a.regMs - b.regMs);

  for (const u of unresolved) {
    const candidates = journeysByHn.get(u.motherHn);
    if (!candidates || candidates.length === 0) continue;
    const before = candidates.filter((c) => c.regMs <= u.bornMs);
    const pick = before.length > 0 ? before[before.length - 1] : candidates[0];
    journeyByAn.set(u.an, pick.id);
  }
  return journeyByAn;
}

/**
 * Fan a LABOUR_INFANTS_SINCE batch out to journeys. Rows group by the
 * mother's AN; the journey resolves through cached_patients (hospital + AN).
 * ANs the system never admitted are counted and skipped — they cannot be
 * attributed to a pregnancy journey.
 */
export async function syncNewbornsFromRows(
  db: DatabaseAdapter,
  hospitalId: string,
  rows: HosxpLabourInfantRow[],
): Promise<NewbornSyncResult> {
  const result: NewbornSyncResult = {
    rowsRead: rows.length,
    upserted: 0,
    journeys: 0,
    skippedNoJourney: 0,
    createdJourneys: 0,
    failedAns: 0,
  };
  if (rows.length === 0) return result;

  // Date hygiene: convert Buddhist-Era years, drop rows whose birth date is
  // still in the future afterwards — one poisoned date would wedge the
  // MAX(born_at) cutoff and freeze the hospital's incremental sync.
  const sanitized = rows
    .map((row) => ({ ...row, birth_date: normalizeHosxpDate(row.birth_date) }))
    .filter((row) => row.birth_date == null || isPlausibleEventDate(row.birth_date));
  if (sanitized.length < rows.length) {
    logger.warn('newborn_rows_dropped_bad_date', {
      hospitalId,
      dropped: rows.length - sanitized.length,
    });
  }

  const byAn = new Map<string, HosxpLabourInfantRow[]>();
  for (const row of sanitized) {
    const an = String(row.an);
    const list = byAn.get(an) ?? [];
    list.push(row);
    byAn.set(an, list);
  }

  // infant_number hygiene, alongside the date hygiene above: NULLs get a
  // deterministic per-AN fallback instead of poisoning the batch INSERT.
  // Row order inside each group is preserved, so the identity fields the
  // BirthResolutionItem mapping reads from list[0] are unaffected.
  const sanitizedByAn = new Map<string, SanitizedInfantRow[]>();
  for (const [an, list] of byAn) {
    sanitizedByAn.set(an, defaultMissingInfantNumbers(hospitalId, an, list));
  }

  const items: BirthResolutionItem[] = Array.from(byAn.entries()).map(([an, list]) => ({
    an,
    motherHn: list[0].mother_hn ? String(list[0].mother_hn) : null,
    bornMs: list[0].birth_date ? new Date(list[0].birth_date).getTime() : Number.MAX_SAFE_INTEGER,
    bornAtIso: list[0].birth_date ?? null,
    motherCid: list[0].mother_cid ?? null,
    motherName: list[0].mother_name ?? null,
    motherBirthday: list[0].mother_birthday ?? null,
  }));
  const journeyByAn = await resolveJourneysForBirths(db, hospitalId, items);
  result.createdJourneys = await createRetroJourneysForUnresolved(
    db,
    hospitalId,
    items,
    journeyByAn,
  );

  // Bounded cooperative yielding (page-stall fix part 2): per-journey fan-out
  // reachable from the browser-push newborn cycle; tick at the top of each
  // outer iteration (syncNewbornData holds no transaction).
  const yielder = new CooperativeYielder();
  for (const [an, infantRows] of sanitizedByAn) {
    await yielder.tick();
    const journeyId = journeyByAn.get(an);
    if (!journeyId) {
      result.skippedNoJourney += 1;
      continue;
    }
    // Per-AN fault isolation: one poisoned AN must not abort the batch —
    // every other birth still persists, MAX(born_at) advances, and the
    // hospital's sync window keeps self-healing (frozen-cutoff incident).
    try {
      result.upserted += await syncNewbornData(db, journeyId, infantRows);
      result.journeys += 1;
    } catch (e) {
      result.failedAns += 1;
      logger.warn('newborn_an_failed', {
        hospitalId,
        an,
        error: (e instanceof Error ? e.message : String(e)).slice(0, 120),
      });
    }
  }

  return result;
}

// ─── ipt_pregnancy fallback ─────────────────────────────────────────────────
// HOSxP's own Account 2 module closes pregnancies from ipt_pregnancy (the
// per-admission delivery summary), not from ipt_labour_infant — some sites
// only ever fill the former. The fallback synthesizes minimal newborn rows
// (infant 1..child_count, bornAt = labor_date, no sex/weight/Apgar) so births
// are counted and journeys transition; if detailed infant rows arrive later
// they overwrite these via the (journey_id, infant_number) upsert key.

/** Sanity cap on synthesized infants per delivery — guards against garbage
 *  child_count values (quintuplets are the largest plausible multiple). */
const MAX_SYNTHESIZED_INFANTS = 5;

export interface PregnancyFallbackResult extends NewbornSyncResult {
  /** Journeys skipped because detailed infant rows already exist. */
  skippedHasDetail: number;
}

/** IN-list chunk size — matches the repo's multi-row statement chunking
 *  precedent (db/seeds/thai-geo-seeder.ts) and stays well under parameter
 *  limits on every dialect. */
const DEDUP_CHUNK_SIZE = 500;

/**
 * One batched round-trip: which of these journeys already have any
 * cached_newborns rows? Replaces the former per-delivery COUNT(*) —
 * ~1,000 queries per cycle at hospital 10998 while the frozen cutoff kept
 * re-shipping the same one-year window.
 */
async function fetchJourneysWithNewborns(
  db: DatabaseAdapter,
  journeyIds: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < journeyIds.length; i += DEDUP_CHUNK_SIZE) {
    const chunk = journeyIds.slice(i, i + DEDUP_CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await db.query<{ journey_id: string }>(
      `SELECT journey_id FROM cached_newborns WHERE journey_id IN (${placeholders}) GROUP BY journey_id`,
      chunk,
    );
    for (const r of rows) found.add(r.journey_id);
  }
  return found;
}

export async function syncNewbornsFromPregnancyRows(
  db: DatabaseAdapter,
  hospitalId: string,
  rows: HosxpIptPregnancyRow[],
): Promise<PregnancyFallbackResult> {
  const result: PregnancyFallbackResult = {
    rowsRead: rows.length,
    upserted: 0,
    journeys: 0,
    skippedNoJourney: 0,
    skippedHasDetail: 0,
    createdJourneys: 0,
    failedAns: 0,
  };

  // an is ipt_pregnancy's PK, but dedupe defensively; undelivered admissions
  // (labor_date NULL) carry no outcome yet.
  const byAn = new Map<string, HosxpIptPregnancyRow>();
  for (const row of rows) {
    const laborDate = normalizeHosxpDate(row.labor_date);
    if (laborDate == null || !isPlausibleEventDate(laborDate)) continue;
    byAn.set(String(row.an), { ...row, labor_date: laborDate });
  }
  if (byAn.size === 0) return result;

  const items: BirthResolutionItem[] = Array.from(byAn.entries()).map(([an, row]) => ({
    an,
    motherHn: row.mother_hn ? String(row.mother_hn) : null,
    bornMs: new Date(row.labor_date as string).getTime() || Number.MAX_SAFE_INTEGER,
    bornAtIso: row.labor_date,
    motherCid: row.mother_cid ?? null,
    motherName: row.mother_name ?? null,
    motherBirthday: row.mother_birthday ?? null,
    pregNumber: row.preg_number ?? null,
  }));
  const journeyByAn = await resolveJourneysForBirths(db, hospitalId, items);
  result.createdJourneys = await createRetroJourneysForUnresolved(
    db,
    hospitalId,
    items,
    journeyByAn,
  );

  // Never clobber richer per-infant data (from the labour module or an
  // earlier cycle) with weight-less synthesized rows. Resolved once as a
  // batched lookup; the set is kept current inside the loop so two
  // summaries hitting the same journey keep the old per-row semantics.
  const journeysWithNewborns = await fetchJourneysWithNewborns(
    db,
    Array.from(new Set(journeyByAn.values())),
  );

  // Bounded cooperative yielding (page-stall fix part 2): same rationale as
  // syncNewbornsFromRows — per-delivery loop with per-item queries/upserts,
  // no transaction held.
  const yielder = new CooperativeYielder();
  for (const [an, row] of byAn) {
    await yielder.tick();
    const journeyId = journeyByAn.get(an);
    if (!journeyId) {
      result.skippedNoJourney += 1;
      continue;
    }

    if (journeysWithNewborns.has(journeyId)) {
      result.skippedHasDetail += 1;
      continue;
    }

    const live = Math.min(Math.max(Number(row.child_count) || 0, 0), MAX_SYNTHESIZED_INFANTS);
    const dead = Number(row.dead_child_count) || 0;
    // A delivery happened only if some outcome was recorded — an admission
    // with labor_date but zero counts stays open for the detailed source.
    if (live === 0 && dead === 0) continue;

    // Per-AN fault isolation — same rationale as syncNewbornsFromRows: this
    // fallback is the recovery path for outcome-less DELIVERED journeys, so
    // one poisoned summary must not re-freeze the whole pass.
    try {
      for (let i = 1; i <= live; i++) {
        await upsertNewborn(db, {
          journeyId,
          infantNumber: i,
          bornAt: row.labor_date as string,
          resuscitation: {},
          vaccinations: {},
        });
        result.upserted += 1;
      }
      if (live > 0) journeysWithNewborns.add(journeyId);
      await transitionToDelivered(db, journeyId);
      result.journeys += 1;
    } catch (e) {
      result.failedAns += 1;
      logger.warn('newborn_fallback_an_failed', {
        hospitalId,
        an,
        error: (e instanceof Error ? e.message : String(e)).slice(0, 120),
      });
    }
  }

  return result;
}

// ─── Browser-push glue ──────────────────────────────────────────────────────
// Production syncs through the browser gateway (server-side polling is
// disabled), so /api/sync/browser-push needs one entry point that runs raw
// gateway rows through BOTH sources: detailed labour infants first, then the
// ipt_pregnancy summary fallback (which skips journeys the first pass filled).

export interface BrowserNewbornsSection {
  infants?: unknown;
  pregnancies?: unknown;
}

export interface BrowserNewbornsResult {
  infants: NewbornSyncResult;
  fallback: PregnancyFallbackResult;
  /** Set when the detailed infants pass threw wholesale (despite per-AN
   *  isolation) — first 120 chars, PHI-free. The fallback still ran. */
  infantsError?: string;
}

export async function processBrowserNewborns(
  db: DatabaseAdapter,
  hospitalId: string,
  section: BrowserNewbornsSection,
): Promise<BrowserNewbornsResult> {
  const infantRows = Array.isArray(section.infants)
    ? (section.infants as HosxpLabourInfantRow[])
    : [];
  const pregnancyRows = Array.isArray(section.pregnancies)
    ? (section.pregnancies as HosxpIptPregnancyRow[])
    : [];
  let infants: NewbornSyncResult = {
    rowsRead: infantRows.length,
    upserted: 0,
    journeys: 0,
    skippedNoJourney: 0,
    createdJourneys: 0,
    failedAns: 0,
  };
  let infantsError: string | undefined;
  try {
    infants = await syncNewbornsFromRows(db, hospitalId, infantRows);
  } catch (e) {
    // The detailed pass must never block the ipt_pregnancy fallback: during
    // the 10998/11008 frozen-cutoff incident the fallback never ran, so the
    // ~2,415 outcome-less DELIVERED journeys could not self-heal.
    infantsError = (e instanceof Error ? e.message : String(e)).slice(0, 120);
    logger.error('newborn_infants_pass_failed', {
      hospitalId,
      rows: infantRows.length,
      error: infantsError,
    });
  }
  const fallback = await syncNewbornsFromPregnancyRows(db, hospitalId, pregnancyRows);
  return infantsError === undefined ? { infants, fallback } : { infants, fallback, infantsError };
}
