// Newborn polling-sync glue — TDD for wiring syncNewbornData into the cycle.
// Covers the AN→journey resolution via cached_patients, idempotent re-runs,
// and the self-healing cutoff-date window.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { generateKey, decrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import { beforeAll } from 'vitest';
import {
  syncNewbornsFromRows,
  syncNewbornsFromPregnancyRows,
  processBrowserNewborns,
  newbornSyncCutoffDate,
} from '@/services/sync/newborn';
import type { HosxpLabourInfantRow, HosxpIptPregnancyRow } from '@/types/hosxp';

const HOSPITAL_ID = 'hosp-001';
const JOURNEY_ID = 'journey-001';

function makeInfantRow(
  an: string,
  infantNumber: number,
  overrides: Partial<HosxpLabourInfantRow> = {},
): HosxpLabourInfantRow {
  return {
    ipt_labour_infant_id: infantNumber,
    ipt_labour_id: 1,
    an,
    infant_number: infantNumber,
    sex: 'F',
    birth_weight: 3200,
    body_length: 50,
    head_length: 34,
    temperature: 36.8,
    rr: 45,
    hr: 130,
    apgar_score_min1: 8,
    apgar_score_min5: 9,
    apgar_score_min10: 10,
    infant_check_ppv: 'N',
    infant_check_et_tube: 'N',
    infant_check_chest_pump: 'N',
    infant_check_oxygen_box: 'N',
    infant_check_narcan: 'N',
    infant_check_feed_milk: 'Y',
    infant_check_vitk: 'Y',
    infant_check_eyepaste: 'Y',
    infant_check_bcg: 'Y',
    infant_check_hepb: 'Y',
    infant_check_azt: 'N',
    infant_icd10: null,
    infant_hn: `NB-${an}-${infantNumber}`,
    infant_an: null,
    infant_dchstts: null,
    birth_date: '2026-07-01',
    birth_time: '10:30:00',
    ...overrides,
  };
}

describe('newborn polling sync', () => {
  let db: DatabaseAdapter;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = generateKey();
  });

  beforeEach(async () => {
    db = await createTestDb();
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, '10670', 'รพ.ขอนแก่น', 'A_S', TRUE, 'ONLINE', ?, ?)`,
      [HOSPITAL_ID, now, now],
    );
    await db.execute(
      `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
       VALUES (?, ?, ?, 'HN001', 'Test Mother', 'enc_cid', 'cidhash_x', 28, 1, 0, 'LABOR', 'LOW', 5, ?, ?, ?, ?, ?)`,
      [JOURNEY_ID, HOSPITAL_ID, HOSPITAL_ID, now, now, now, now, now],
    );
    await db.execute(
      `INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, journey_id, synced_at, created_at, updated_at)
       VALUES ('pat-1', ?, 'HN001', 'AN001', 'enc-name', 28, ?, 'ACTIVE', ?, ?, ?, ?)`,
      [HOSPITAL_ID, now, JOURNEY_ID, now, now, now],
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
  });

  it('upserts infants grouped by AN, resolves journeys via cached_patients, transitions the journey', async () => {
    const rows = [
      makeInfantRow('AN001', 1),
      makeInfantRow('AN001', 2, { birth_weight: 2400 }),
      makeInfantRow('AN-UNKNOWN', 1),
    ];

    const result = await syncNewbornsFromRows(db, HOSPITAL_ID, rows);

    expect(result).toEqual({
      rowsRead: 3,
      upserted: 2,
      journeys: 1,
      skippedNoJourney: 1,
      createdJourneys: 0,
      failedAns: 0,
    });

    const newborns = await db.query<{ infant_number: number }>(
      `SELECT infant_number FROM cached_newborns WHERE journey_id = ? ORDER BY infant_number`,
      [JOURNEY_ID],
    );
    expect(newborns.map((n) => n.infant_number)).toEqual([1, 2]);

    const journey = await db.query<{ care_stage: string }>(
      `SELECT care_stage FROM maternal_journeys WHERE id = ?`,
      [JOURNEY_ID],
    );
    expect(journey[0].care_stage).toBe('DELIVERED');
  });

  it('is idempotent — re-running the same rows updates instead of duplicating', async () => {
    const rows = [makeInfantRow('AN001', 1)];
    await syncNewbornsFromRows(db, HOSPITAL_ID, rows);
    await syncNewbornsFromRows(db, HOSPITAL_ID, rows);

    const count = await db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM cached_newborns WHERE journey_id = ?`,
      [JOURNEY_ID],
    );
    expect(Number(count[0].cnt)).toBe(1);
  });

  it('falls back to the mother HN when the AN was never cached (backfill path)', async () => {
    // No cached_patients row for AN-OLD — the admission predates the system.
    // The infant row carries the mother's HN from HOSxP (ipt join), which
    // resolves to the journey directly.
    const rows = [makeInfantRow('AN-OLD', 1, { mother_hn: 'HN001' })];

    const result = await syncNewbornsFromRows(db, HOSPITAL_ID, rows);

    expect(result.upserted).toBe(1);
    expect(result.skippedNoJourney).toBe(0);
    const newborns = await db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM cached_newborns WHERE journey_id = ?`,
      [JOURNEY_ID],
    );
    expect(Number(newborns[0].cnt)).toBe(1);
  });

  it('for repeat mothers, attributes the birth to the pregnancy registered before it', async () => {
    const now = Date.now();
    const iso = (d: number) => new Date(now - d * 24 * 3600_000).toISOString();
    // Same HN, two pregnancies: an old delivered journey and the current one.
    await db.execute(
      `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
       VALUES ('journey-old', ?, ?, 'HN002', 'Repeat Mother', 'enc_cid2', 'cidhash_y', 32, 2, 1, 'DELIVERED', 'LOW', 5, ?, ?, ?, ?, ?)`,
      [HOSPITAL_ID, HOSPITAL_ID, iso(400), iso(400), iso(400), iso(400), iso(400)],
    );
    await db.execute(
      `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
       VALUES ('journey-new', ?, ?, 'HN002', 'Repeat Mother', 'enc_cid2', 'cidhash_y', 32, 3, 2, 'LABOR', 'LOW', 5, ?, ?, ?, ?, ?)`,
      [HOSPITAL_ID, HOSPITAL_ID, iso(200), iso(200), iso(200), iso(200), iso(200)],
    );

    const birthDate = new Date(now - 5 * 24 * 3600_000).toISOString().slice(0, 10);
    await syncNewbornsFromRows(db, HOSPITAL_ID, [
      makeInfantRow('AN-REPEAT', 1, { mother_hn: 'HN002', birth_date: birthDate }),
    ]);

    const newborns = await db.query<{ journey_id: string }>(
      `SELECT journey_id FROM cached_newborns WHERE infant_hn = 'NB-AN-REPEAT-1'`,
    );
    expect(newborns[0].journey_id).toBe('journey-new');
  });

  // ── ipt_pregnancy fallback ─────────────────────────────────────────────
  // Some sites fill the IPD pregnancy summary (ipt_pregnancy) but never the
  // labour-module infant table — the fallback synthesizes minimal newborn
  // rows from the delivery summary so births are counted and journeys close.

  function makePregnancyRow(
    an: string,
    overrides: Partial<HosxpIptPregnancyRow> = {},
  ): HosxpIptPregnancyRow {
    return {
      an,
      mother_hn: null,
      // Explicit UTC midnight, not a bare date: a naive 'YYYY-MM-DD' value
      // hits TIMESTAMPTZ's local-midnight interpretation (PGlite's session
      // TimeZone follows the host, Asia/Bangkok, +07) and rolls back to the
      // previous UTC day. See newbornSyncCutoffDate / bornAtIso callers.
      labor_date: '2026-07-01T00:00:00Z',
      child_count: 1,
      dead_child_count: 0,
      preg_number: 1,
      ga: 39,
      ...overrides,
    };
  }

  it('fallback: synthesizes one newborn per live child and transitions the journey', async () => {
    const result = await syncNewbornsFromPregnancyRows(db, HOSPITAL_ID, [
      makePregnancyRow('AN001', { child_count: 2 }),
      makePregnancyRow('AN-UNKNOWN'),
    ]);

    expect(result).toEqual({
      rowsRead: 2,
      upserted: 2,
      journeys: 1,
      skippedNoJourney: 1,
      skippedHasDetail: 0,
      createdJourneys: 0,
      failedAns: 0,
    });

    const newborns = await db.query<{ infant_number: number; born_at: string | Date }>(
      `SELECT infant_number, born_at FROM cached_newborns WHERE journey_id = ? ORDER BY infant_number`,
      [JOURNEY_ID],
    );
    expect(newborns.map((n) => n.infant_number)).toEqual([1, 2]);
    expect(new Date(newborns[0].born_at).toISOString().slice(0, 10)).toBe('2026-07-01');

    const journey = await db.query<{ care_stage: string }>(
      `SELECT care_stage FROM maternal_journeys WHERE id = ?`,
      [JOURNEY_ID],
    );
    expect(journey[0].care_stage).toBe('DELIVERED');
  });

  it('fallback: never clobbers journeys that already have detailed infant rows', async () => {
    await syncNewbornsFromRows(db, HOSPITAL_ID, [makeInfantRow('AN001', 1)]);

    const result = await syncNewbornsFromPregnancyRows(db, HOSPITAL_ID, [
      makePregnancyRow('AN001', { child_count: 3 }),
    ]);

    expect(result.upserted).toBe(0);
    expect(result.skippedHasDetail).toBe(1);
    const newborns = await db.query<{ birth_weight_g: number | null }>(
      `SELECT birth_weight_g FROM cached_newborns WHERE journey_id = ?`,
      [JOURNEY_ID],
    );
    expect(newborns).toHaveLength(1);
    expect(Number(newborns[0].birth_weight_g)).toBe(3200); // detail row untouched
  });

  it('fallback: resolves via mother HN when the AN was never cached', async () => {
    const result = await syncNewbornsFromPregnancyRows(db, HOSPITAL_ID, [
      makePregnancyRow('AN-OLD', { mother_hn: 'HN001' }),
    ]);

    expect(result.upserted).toBe(1);
    expect(result.skippedNoJourney).toBe(0);
  });

  it('fallback: stillbirth-only delivery closes the journey without newborn rows', async () => {
    const result = await syncNewbornsFromPregnancyRows(db, HOSPITAL_ID, [
      makePregnancyRow('AN001', { child_count: 0, dead_child_count: 1 }),
    ]);

    expect(result.upserted).toBe(0);
    expect(result.journeys).toBe(1);
    const journey = await db.query<{ care_stage: string }>(
      `SELECT care_stage FROM maternal_journeys WHERE id = ?`,
      [JOURNEY_ID],
    );
    expect(journey[0].care_stage).toBe('DELIVERED');
  });

  it('fallback: skips undelivered rows and caps garbage child counts', async () => {
    const result = await syncNewbornsFromPregnancyRows(db, HOSPITAL_ID, [
      makePregnancyRow('AN001', { child_count: 99 }),
      makePregnancyRow('AN-PENDING', { labor_date: null }),
    ]);

    expect(result.rowsRead).toBe(2);
    const newborns = await db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM cached_newborns WHERE journey_id = ?`,
      [JOURNEY_ID],
    );
    expect(Number(newborns[0].cnt)).toBeLessThanOrEqual(5);
  });

  // ── browser-push glue ──────────────────────────────────────────────────
  // Production syncs via the browser gateway (polling.ts is disabled), so
  // the route needs one entry point that runs raw gateway rows through both
  // newborn sources and reports the counts.

  it('processBrowserNewborns: runs infants then the pregnancy fallback (detail wins)', async () => {
    const result = await processBrowserNewborns(db, HOSPITAL_ID, {
      infants: [makeInfantRow('AN001', 1) as unknown as Record<string, unknown>],
      pregnancies: [
        makePregnancyRow('AN001', { child_count: 3 }) as unknown as Record<string, unknown>,
      ],
    });

    expect(result.infants.upserted).toBe(1);
    expect(result.fallback.skippedHasDetail).toBe(1);
    const rows = await db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM cached_newborns WHERE journey_id = ?`,
      [JOURNEY_ID],
    );
    expect(Number(rows[0].cnt)).toBe(1);
  });

  it('processBrowserNewborns: tolerates missing/empty sections', async () => {
    const result = await processBrowserNewborns(db, HOSPITAL_ID, {});
    expect(result.infants.rowsRead).toBe(0);
    expect(result.fallback.rowsRead).toBe(0);
  });

  // ── Retrospective journeys ─────────────────────────────────────────────
  // Historical births whose mothers were never registered (pre-kk-lrms
  // deliveries found during backfill) get a minimal DELIVERED journey built
  // from the mother identity the delivery queries now carry — instead of
  // being skipped and lost to the outcomes board.

  it('creates a retrospective DELIVERED journey when no journey exists but identity does', async () => {
    const rows = [
      makeInfantRow('AN-RETRO', 1, {
        mother_hn: 'HN-RETRO',
        mother_cid: '1100500090006',
        mother_name: 'นาง ย้อนหลัง ทดสอบ',
        mother_birthday: '1996-02-01',
        // registered_at for the retrospective journey is sourced straight
        // from birth_date with no time component (see bornAtIso in
        // createRetroJourneysForUnresolved) — a bare date rolls back a day
        // under TIMESTAMPTZ's local-midnight interpretation, so pin it to
        // an explicit UTC instant. birth_time is cleared so the infant's
        // own born_at (unasserted here) doesn't get corrupted by
        // `${birth_date}T${birth_time}` concatenation.
        birth_date: '2026-05-20T00:00:00Z',
        birth_time: null,
      }),
    ];

    const result = await syncNewbornsFromRows(db, HOSPITAL_ID, rows);

    expect(result.createdJourneys).toBe(1);
    expect(result.skippedNoJourney).toBe(0);
    expect(result.upserted).toBe(1);

    const journeys = await db.query<{
      id: string;
      hn: string;
      name: string;
      cid_hash: string | null;
      care_stage: string;
      registered_at: string | Date;
    }>(
      `SELECT id, hn, name, cid_hash, care_stage, registered_at FROM maternal_journeys WHERE hn = 'HN-RETRO'`,
    );
    expect(journeys).toHaveLength(1);
    expect(journeys[0].care_stage).toBe('DELIVERED');
    expect(journeys[0].cid_hash).toBeTruthy();
    expect(new Date(journeys[0].registered_at).toISOString().slice(0, 10)).toBe('2026-05-20');
    expect(decrypt(journeys[0].name, process.env.ENCRYPTION_KEY!)).toBe('นาง ย้อนหลัง ทดสอบ');

    const newborns = await db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM cached_newborns WHERE journey_id = ?`,
      [journeys[0].id],
    );
    expect(Number(newborns[0].cnt)).toBe(1);
  });

  it('reuses an existing journey by mother CID before creating a new one', async () => {
    // Journey exists at this hospital under a DIFFERENT HN but same CID hash.
    const { createHash } = await import('crypto');
    const cidHash = createHash('sha256').update('1100500090006').digest('hex');
    const old = new Date(Date.now() - 300 * 86_400_000).toISOString();
    await db.execute(
      `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
       VALUES ('journey-cid', ?, ?, 'HN-OTHER', 'enc', 'enc_cid', ?, 29, 1, 0, 'PREGNANCY', 'LOW', 3, ?, ?, ?, ?, ?)`,
      [HOSPITAL_ID, HOSPITAL_ID, cidHash, old, old, old, old, old],
    );

    const result = await syncNewbornsFromRows(db, HOSPITAL_ID, [
      makeInfantRow('AN-CIDMATCH', 1, {
        mother_hn: 'HN-UNSEEN',
        mother_cid: '1100500090006',
        mother_name: 'นาง ซีไอดี ทดสอบ',
        birth_date: '2026-06-01',
      }),
    ]);

    expect(result.createdJourneys).toBe(0);
    expect(result.skippedNoJourney).toBe(0);
    const newborns = await db.query<{ journey_id: string }>(
      `SELECT journey_id FROM cached_newborns WHERE infant_hn = 'NB-AN-CIDMATCH-1'`,
    );
    expect(newborns[0].journey_id).toBe('journey-cid');
  });

  it('still skips births with no identity at all', async () => {
    const result = await syncNewbornsFromRows(db, HOSPITAL_ID, [
      makeInfantRow('AN-GHOST', 1, { mother_hn: null, birth_date: '2026-05-01' }),
    ]);
    expect(result.createdJourneys).toBe(0);
    expect(result.skippedNoJourney).toBe(1);
  });

  it('fallback path also creates retrospective journeys from delivery summaries', async () => {
    const result = await syncNewbornsFromPregnancyRows(db, HOSPITAL_ID, [
      makePregnancyRow('AN-RETRO-P', {
        mother_hn: 'HN-RETRO-P',
        mother_cid: null,
        mother_name: 'นาง สรุปคลอด ทดสอบ',
        child_count: 2,
        labor_date: '2026-04-15',
      }),
    ]);

    expect(result.createdJourneys).toBe(1);
    expect(result.upserted).toBe(2);
    const journeys = await db.query<{ care_stage: string }>(
      `SELECT care_stage FROM maternal_journeys WHERE hn = 'HN-RETRO-P'`,
    );
    expect(journeys).toHaveLength(1);
    expect(journeys[0].care_stage).toBe('DELIVERED');
  });

  it('normalizes Buddhist-Era birth dates and drops implausible future rows', async () => {
    const result = await syncNewbornsFromRows(db, HOSPITAL_ID, [
      // BE year 2569 = CE 2026 — must ingest with the converted date.
      makeInfantRow('AN001', 1, { birth_date: '2569-07-01' }),
      // Still in the future after conversion — must be dropped, not cached.
      makeInfantRow('AN001', 2, { birth_date: '2570-01-01' }),
    ]);

    expect(result.upserted).toBe(1);
    const rows = await db.query<{ born_at: string | Date }>(
      `SELECT born_at FROM cached_newborns WHERE journey_id = ?`,
      [JOURNEY_ID],
    );
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].born_at).toISOString().slice(0, 10)).toBe('2026-07-01');
  });

  it('cutoff never exceeds today even when a poisoned born_at slipped into the cache', async () => {
    const now = new Date('2026-07-10T12:00:00Z');
    const iso = now.toISOString();
    await db.execute(
      `INSERT INTO cached_newborns (id, journey_id, infant_number, born_at, synced_at, created_at)
       VALUES ('nb-poison', ?, 9, '2556-11-03', ?, ?)`,
      [JOURNEY_ID, iso, iso],
    );
    const cutoff = await newbornSyncCutoffDate(db, HOSPITAL_ID, now);
    expect(cutoff <= '2026-07-10').toBe(true);
  });

  it('cutoff: 365-day backfill window when nothing is cached for the hospital', async () => {
    const now = new Date('2026-07-09T12:00:00+07:00');
    const cutoff = await newbornSyncCutoffDate(db, HOSPITAL_ID, now);
    expect(cutoff).toBe('2025-07-09');
  });

  it('cutoff: two days before the latest cached birth once data exists', async () => {
    await syncNewbornsFromRows(db, HOSPITAL_ID, [
      makeInfantRow('AN001', 1, { birth_date: '2026-07-01' }),
    ]);

    const cutoff = await newbornSyncCutoffDate(db, HOSPITAL_ID, new Date('2026-07-09T12:00:00Z'));
    expect(cutoff).toBe('2026-06-29');
  });

  // ── NULL infant_number poison rows (10998/11008 frozen-cutoff incident) ──
  // HOSxP at some sites stores NULL infant_number in ipt_labour_infant.
  // cached_newborns.infant_number is NOT NULL and the upsert key is
  // (journey_id, infant_number), so before sanitization ONE such row killed
  // the entire batch, MAX(born_at) never advanced, and the client re-shipped
  // the same >1000-row window every cycle forever.

  it('defaults NULL infant_number rows to their 1-based AN-group position and persists them', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const result = await syncNewbornsFromRows(db, HOSPITAL_ID, [
      makeInfantRow('AN001', 1, { infant_number: null }),
      makeInfantRow('AN001', 2, { infant_number: null }),
    ]);

    expect(result.upserted).toBe(2);
    expect(result.failedAns).toBe(0);
    const newborns = await db.query<{ infant_number: number }>(
      `SELECT infant_number FROM cached_newborns WHERE journey_id = ? ORDER BY infant_number`,
      [JOURNEY_ID],
    );
    expect(newborns.map((n) => Number(n.infant_number))).toEqual([1, 2]);

    // One defaulted-log per affected AN — dropped-bad-date convention.
    expect(warnSpy).toHaveBeenCalledWith(
      'newborn_infant_number_defaulted',
      expect.objectContaining({ hospitalId: HOSPITAL_ID, an: 'AN001', count: 2 }),
    );

    // The frozen-cutoff symptom heals: MAX(born_at) now advances.
    const cutoff = await newbornSyncCutoffDate(db, HOSPITAL_ID, new Date('2026-07-09T12:00:00Z'));
    expect(cutoff).toBe('2026-06-29');
  });

  it('defaulted infant_number skips upward past numbers explicitly taken in the AN group', async () => {
    // NULL row sorts AFTER the explicit row (higher ipt_labour_infant_id):
    // its 1-based position is 2, which collides with the explicit 2 → 3.
    await syncNewbornsFromRows(db, HOSPITAL_ID, [
      makeInfantRow('AN001', 2, { ipt_labour_infant_id: 10 }),
      makeInfantRow('AN001', 3, { ipt_labour_infant_id: 11, infant_number: null }),
    ]);
    const newborns = await db.query<{ infant_number: number }>(
      `SELECT infant_number FROM cached_newborns WHERE journey_id = ? ORDER BY infant_number`,
      [JOURNEY_ID],
    );
    expect(newborns.map((n) => Number(n.infant_number))).toEqual([2, 3]);
  });

  it('defaulted infant_number takes a free lower slot when the NULL row sorts first', async () => {
    // NULL row sorts FIRST (lower ipt_labour_infant_id): position 1 is free.
    await syncNewbornsFromRows(db, HOSPITAL_ID, [
      makeInfantRow('AN001', 9, { ipt_labour_infant_id: 5, infant_number: null }),
      makeInfantRow('AN001', 2, { ipt_labour_infant_id: 6 }),
    ]);
    const newborns = await db.query<{ infant_number: number }>(
      `SELECT infant_number FROM cached_newborns WHERE journey_id = ? ORDER BY infant_number`,
      [JOURNEY_ID],
    );
    expect(newborns.map((n) => Number(n.infant_number))).toEqual([1, 2]);
  });

  // ── Per-AN fault isolation ────────────────────────────────────────────
  // A poisoned AN (any per-row DB error) must not abort the other ANs in
  // the batch — that was the data-loss half of the incident.

  it('one poisoned AN does not prevent other ANs from persisting; failedAns counted', async () => {
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
       VALUES ('journey-002', ?, ?, 'HN-P2', 'Second Mother', 'enc_cid_p2', 'cidhash_p2', 30, 1, 0, 'LABOR', 'LOW', 4, ?, ?, ?, ?, ?)`,
      [HOSPITAL_ID, HOSPITAL_ID, now, now, now, now, now],
    );
    await db.execute(
      `INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, journey_id, synced_at, created_at, updated_at)
       VALUES ('pat-2', ?, 'HN-P2', 'AN002', 'enc-name2', 30, ?, 'ACTIVE', 'journey-002', ?, ?, ?)`,
      [HOSPITAL_ID, now, now, now, now],
    );

    const warnSpy = vi.spyOn(logger, 'warn');
    // AN002 poisoned: infant_hn overflows varchar(20) → per-row INSERT error.
    // It is FIRST in the batch, so without isolation AN001 would be lost.
    const result = await syncNewbornsFromRows(db, HOSPITAL_ID, [
      makeInfantRow('AN002', 1, { infant_hn: 'X'.repeat(30) }),
      makeInfantRow('AN001', 1),
    ]);

    expect(result.failedAns).toBe(1);
    expect(result.upserted).toBe(1);
    expect(result.journeys).toBe(1);

    const ok = await db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM cached_newborns WHERE journey_id = ?`,
      [JOURNEY_ID],
    );
    expect(Number(ok[0].cnt)).toBe(1);

    expect(warnSpy).toHaveBeenCalledWith(
      'newborn_an_failed',
      expect.objectContaining({ hospitalId: HOSPITAL_ID, an: 'AN002' }),
    );
    const failLog = warnSpy.mock.calls.find(([event]) => event === 'newborn_an_failed');
    expect(String((failLog![1] as { error: string }).error).length).toBeLessThanOrEqual(120);
  });

  it('processBrowserNewborns: infants-pass hard failure still runs the pregnancy fallback', async () => {
    const original = db.query.bind(db);
    let crashed = false;
    vi.spyOn(db, 'query').mockImplementation(async (sql: string, params?: unknown[]) => {
      // First cached_patients resolution (the infants pass) crashes; the
      // fallback pass re-resolves and must be allowed through.
      if (!crashed && sql.includes('FROM cached_patients')) {
        crashed = true;
        throw new Error('simulated infants-pass crash');
      }
      return original(sql, params);
    });

    const result = await processBrowserNewborns(db, HOSPITAL_ID, {
      infants: [makeInfantRow('AN001', 1) as unknown as Record<string, unknown>],
      pregnancies: [makePregnancyRow('AN001') as unknown as Record<string, unknown>],
    });

    expect(crashed).toBe(true);
    expect(result.infantsError).toContain('simulated infants-pass crash');
    expect(result.infants.upserted).toBe(0);
    expect(result.fallback.upserted).toBe(1);

    const rows = await db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM cached_newborns WHERE journey_id = ?`,
      [JOURNEY_ID],
    );
    expect(Number(rows[0].cnt)).toBe(1);
    const journey = await db.query<{ care_stage: string }>(
      `SELECT care_stage FROM maternal_journeys WHERE id = ?`,
      [JOURNEY_ID],
    );
    expect(journey[0].care_stage).toBe('DELIVERED');
  });

  // ── Batched fallback dedup ────────────────────────────────────────────
  // The per-row COUNT(*) on cached_newborns (1000 round-trips per cycle at
  // 10998) is replaced by ONE batched lookup; skip semantics must not move.

  it('fallback: one batched cached_newborns lookup, zero per-row COUNT(*) calls', async () => {
    // AN001's journey gains detailed rows first → must be skipped.
    await syncNewbornsFromRows(db, HOSPITAL_ID, [makeInfantRow('AN001', 1)]);
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
       VALUES ('journey-003', ?, ?, 'HN-B3', 'Batch Mother', 'enc_cid_b3', 'cidhash_b3', 27, 1, 0, 'LABOR', 'LOW', 2, ?, ?, ?, ?, ?)`,
      [HOSPITAL_ID, HOSPITAL_ID, now, now, now, now, now],
    );
    await db.execute(
      `INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, journey_id, synced_at, created_at, updated_at)
       VALUES ('pat-3', ?, 'HN-B3', 'AN003', 'enc-name3', 27, ?, 'ACTIVE', 'journey-003', ?, ?, ?)`,
      [HOSPITAL_ID, now, now, now, now],
    );

    const spy = vi.spyOn(db, 'query');
    const result = await syncNewbornsFromPregnancyRows(db, HOSPITAL_ID, [
      makePregnancyRow('AN001'),
      makePregnancyRow('AN003'),
    ]);

    // Skip semantics identical: journey WITH detail skipped, WITHOUT processed.
    expect(result.skippedHasDetail).toBe(1);
    expect(result.upserted).toBe(1);
    expect(result.journeys).toBe(1);

    const dedupCalls = spy.mock.calls.filter(([sql]) =>
      String(sql).includes('FROM cached_newborns WHERE journey_id IN'),
    );
    const perRowCalls = spy.mock.calls.filter(([sql]) =>
      String(sql).includes('COUNT(*) as cnt FROM cached_newborns'),
    );
    expect(dedupCalls).toHaveLength(1);
    expect(perRowCalls).toHaveLength(0);
  });

  it('fallback: two summaries resolving to the same journey — second still skips as has-detail', async () => {
    // Both unknown ANs resolve to JOURNEY_ID via mother HN. The first
    // inserts a synthesized infant; the per-row COUNT(*) used to make the
    // second skip — the in-memory set must preserve that within one batch.
    const result = await syncNewbornsFromPregnancyRows(db, HOSPITAL_ID, [
      makePregnancyRow('AN-DUP-1', { mother_hn: 'HN001' }),
      makePregnancyRow('AN-DUP-2', { mother_hn: 'HN001' }),
    ]);

    expect(result.upserted).toBe(1);
    expect(result.journeys).toBe(1);
    expect(result.skippedHasDetail).toBe(1);
    const rows = await db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM cached_newborns WHERE journey_id = ?`,
      [JOURNEY_ID],
    );
    expect(Number(rows[0].cnt)).toBe(1);
  });
});
