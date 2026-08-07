// Referral gateway sync — TDD (tests FIRST, plan:
// docs/superpowers/plans/2026-07-20-referral-gateway-sync.md).
// Phase 1: processBrowserReferouts upserts cached_referrals from HOSxP referout
// rows pushed by the ORIGIN hospital's browser gateway, converging on the same
// (from_hospital_id, refer_number) key the webhook path uses, and NEVER creates
// journeys (ghost-journey lesson) nor regresses an advanced status.
// Phase 2: processBrowserReferins marks ARRIVED (+ moves journey ownership)
// from the DESTINATION hospital's referin evidence.
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { createHash } from 'crypto';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { generateKey, encrypt, getEncryptionKey } from '@/lib/encryption';
import {
  processBrowserReferouts,
  processBrowserReferins,
  processBrowserVisitEvidences,
  getReferralArrivalProbe,
} from '@/services/sync/referrals';

const ORIGIN_ID = 'hosp-origin';
const ORIGIN_HCODE = '10001';
const DEST_ID = 'hosp-dest';
const DEST_HCODE = '10002';
const JOURNEY_ID = 'journey-001';
const CID = '1111111111111';
const CID_HASH = createHash('sha256').update(CID).digest('hex');

let db: DatabaseAdapter;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = generateKey();
});

beforeEach(async () => {
  db = await createTestDb();
  const now = new Date().toISOString();
  for (const [id, hcode] of [
    [ORIGIN_ID, ORIGIN_HCODE],
    [DEST_ID, DEST_HCODE],
  ]) {
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, 'M2', true, 'ONLINE', ?, ?)`,
      [id, hcode, `รพ.${hcode}`, now, now],
    );
  }
  await db.execute(
    `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, registered_at, stage_changed_at, synced_at, created_at, updated_at)
     VALUES (?, ?, ?, 'HN001', 'enc-name', 'enc-cid', ?, 30, 1, 0, 'PREGNANCY', ?, ?, ?, ?, ?)`,
    [JOURNEY_ID, ORIGIN_ID, ORIGIN_ID, CID_HASH, now, now, now, now, now],
  );
});

afterEach(async () => {
  await db.close?.();
  vi.restoreAllMocks();
});

function referoutRow(overrides: Record<string, unknown> = {}) {
  return {
    refer_number: 'RF-001',
    refer_date: '2026-07-18',
    refer_time: '10:30:00',
    refer_hospcode: DEST_HCODE,
    pre_diagnosis: 'PIH, GA 36wk',
    pdx: 'O13',
    referout_emergency_type_id: null,
    hn: 'HN001',
    cid: CID,
    ...overrides,
  };
}

function referinRow(overrides: Record<string, unknown> = {}) {
  return {
    hn: 'DEST-HN9',
    cid: CID,
    refer_hospcode: ORIGIN_HCODE,
    refer_date: '2026-07-19',
    ...overrides,
  };
}

async function allReferrals() {
  return db.query<{
    id: string;
    journey_id: string;
    refer_number: string;
    from_hospital_id: string;
    to_hospital_id: string;
    status: string;
    reason: string;
    diagnosis_code: string | null;
    urgency_level: string;
    arrived_at: string | null;
  }>(`SELECT * FROM cached_referrals ORDER BY refer_number`);
}

describe('processBrowserReferouts (Phase 1 — origin gateway push)', () => {
  it('creates an INITIATED referral linked to the existing journey', async () => {
    const result = await processBrowserReferouts(db, ORIGIN_ID, [referoutRow()]);

    expect(result).toMatchObject({ rowsRead: 1, created: 1, upserted: 0, skippedNoJourney: 0 });
    const rows = await allReferrals();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      journey_id: JOURNEY_ID,
      refer_number: 'RF-001',
      from_hospital_id: ORIGIN_ID,
      to_hospital_id: DEST_ID,
      status: 'INITIATED',
      reason: 'PIH, GA 36wk',
      diagnosis_code: 'O13',
      urgency_level: 'ROUTINE',
    });
  });

  it('is idempotent: a re-push refreshes fields without duplicating rows', async () => {
    await processBrowserReferouts(db, ORIGIN_ID, [referoutRow()]);
    const second = await processBrowserReferouts(db, ORIGIN_ID, [
      referoutRow({ pre_diagnosis: 'PIH worsening', pdx: 'O14' }),
    ]);

    expect(second).toMatchObject({ rowsRead: 1, created: 0, upserted: 1 });
    const rows = await allReferrals();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: 'PIH worsening', diagnosis_code: 'O14' });
  });

  it('converges with a webhook-created referral on the same compound key', async () => {
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO cached_referrals (id, journey_id, refer_number, from_hospital_id, to_hospital_id, status, reason, urgency_level, initiated_at, created_at, updated_at)
       VALUES ('web-1', ?, 'RF-001', ?, ?, 'INITIATED', 'webhook reason', 'ROUTINE', ?, ?, ?)`,
      [JOURNEY_ID, ORIGIN_ID, DEST_ID, now, now, now],
    );

    const result = await processBrowserReferouts(db, ORIGIN_ID, [referoutRow()]);

    expect(result).toMatchObject({ created: 0, upserted: 1 });
    expect(await allReferrals()).toHaveLength(1);
  });

  it('never regresses an advanced status on re-push', async () => {
    await processBrowserReferouts(db, ORIGIN_ID, [referoutRow()]);
    await db.execute(
      `UPDATE cached_referrals SET status = 'ARRIVED' WHERE refer_number = 'RF-001'`,
    );

    await processBrowserReferouts(db, ORIGIN_ID, [referoutRow({ pre_diagnosis: 'updated' })]);

    const rows = await allReferrals();
    expect(rows[0].status).toBe('ARRIVED');
    expect(rows[0].reason).toBe('updated');
  });

  it('skips rows whose CID matches no existing journey (never creates journeys)', async () => {
    const result = await processBrowserReferouts(db, ORIGIN_ID, [
      referoutRow({ cid: '9999999999999', refer_number: 'RF-STRANGER' }),
    ]);

    expect(result).toMatchObject({ rowsRead: 1, created: 0, skippedNoJourney: 1 });
    expect(await allReferrals()).toHaveLength(0);
    const journeys = await db.query(`SELECT id FROM maternal_journeys`);
    expect(journeys).toHaveLength(1);
  });

  it('skips rows with an unknown destination hcode', async () => {
    const result = await processBrowserReferouts(db, ORIGIN_ID, [
      referoutRow({ refer_hospcode: '99999' }),
    ]);

    expect(result).toMatchObject({ rowsRead: 1, created: 0, skippedUnknownHospital: 1 });
    expect(await allReferrals()).toHaveLength(0);
  });

  it('maps a non-null emergency type to EMERGENCY urgency', async () => {
    await processBrowserReferouts(db, ORIGIN_ID, [referoutRow({ referout_emergency_type_id: 1 })]);
    expect((await allReferrals())[0].urgency_level).toBe('EMERGENCY');
  });

  it('normalizes Buddhist-Era refer_date before caching', async () => {
    await processBrowserReferouts(db, ORIGIN_ID, [referoutRow({ refer_date: '2569-07-18' })]);
    const rows = await db.query<{ initiated_at: string | Date }>(
      `SELECT initiated_at FROM cached_referrals`,
    );
    expect(
      String(
        rows[0].initiated_at instanceof Date
          ? rows[0].initiated_at.toISOString()
          : rows[0].initiated_at,
      ),
    ).toContain('2026-07-18');
  });

  it('does not overwrite an old referral when HOSxP reuses the refer_number (yearly reset)', async () => {
    const oldInitiated = new Date(Date.now() - 200 * 86_400_000).toISOString();
    await db.execute(
      `INSERT INTO cached_referrals (id, journey_id, refer_number, from_hospital_id, to_hospital_id, status, reason, urgency_level, initiated_at, created_at, updated_at)
       VALUES ('old-1', ?, 'RF-001', ?, ?, 'ARRIVED', 'old year referral', 'ROUTINE', ?, ?, ?)`,
      [JOURNEY_ID, ORIGIN_ID, DEST_ID, oldInitiated, oldInitiated, oldInitiated],
    );

    const result = await processBrowserReferouts(db, ORIGIN_ID, [referoutRow()]);

    expect(result).toMatchObject({ created: 0, upserted: 0, skippedKeyReuse: 1 });
    const rows = await allReferrals();
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe('old year referral');
  });
});

describe('processBrowserReferins (Phase 2 — destination gateway push)', () => {
  beforeEach(async () => {
    await processBrowserReferouts(db, ORIGIN_ID, [referoutRow()]);
  });

  it('marks the matching referral ARRIVED and moves journey ownership to the destination', async () => {
    const result = await processBrowserReferins(db, DEST_ID, [referinRow()]);

    expect(result).toMatchObject({ rowsRead: 1, arrived: 1, skippedNoMatch: 0 });
    const rows = await allReferrals();
    expect(rows[0].status).toBe('ARRIVED');
    expect(rows[0].arrived_at).not.toBeNull();
    const journey = await db.query<{ current_hospital_id: string }>(
      `SELECT current_hospital_id FROM maternal_journeys WHERE id = ?`,
      [JOURNEY_ID],
    );
    expect(journey[0].current_hospital_id).toBe(DEST_ID);
  });

  it('carries the real refer_time into arrived_at (not a midnight stamp)', async () => {
    await processBrowserReferins(db, DEST_ID, [referinRow({ refer_time: '14:45:00' })]);
    const rows = await db.query<{ arrived_at: string | Date }>(
      `SELECT arrived_at FROM cached_referrals`,
    );
    const iso =
      rows[0].arrived_at instanceof Date
        ? rows[0].arrived_at.toISOString()
        : new Date(String(rows[0].arrived_at)).toISOString();
    // 14:45 Bangkok = 07:45 UTC
    expect(iso).toContain('T07:45:00');
  });

  it('is idempotent: a second referin push finds no candidate', async () => {
    await processBrowserReferins(db, DEST_ID, [referinRow()]);
    const second = await processBrowserReferins(db, DEST_ID, [referinRow()]);
    expect(second).toMatchObject({ arrived: 0, skippedNoMatch: 1 });
  });

  it('does not match a referral from a different origin hospital', async () => {
    const result = await processBrowserReferins(db, DEST_ID, [
      referinRow({ refer_hospcode: '55555' }),
    ]);
    expect(result).toMatchObject({ arrived: 0 });
    expect((await allReferrals())[0].status).toBe('INITIATED');
  });

  it('does not match a different patient CID', async () => {
    const result = await processBrowserReferins(db, DEST_ID, [
      referinRow({ cid: '9999999999999' }),
    ]);
    expect(result).toMatchObject({ arrived: 0, skippedNoMatch: 1 });
    expect((await allReferrals())[0].status).toBe('INITIATED');
  });

  it('never resurrects a REJECTED referral', async () => {
    await db.execute(
      `UPDATE cached_referrals SET status = 'REJECTED' WHERE refer_number = 'RF-001'`,
    );
    const result = await processBrowserReferins(db, DEST_ID, [referinRow()]);
    expect(result).toMatchObject({ arrived: 0 });
    expect((await allReferrals())[0].status).toBe('REJECTED');
  });

  it('ignores referin evidence dated before initiation (minus 1-day slack)', async () => {
    const result = await processBrowserReferins(db, DEST_ID, [
      referinRow({ refer_date: '2026-07-10' }),
    ]);
    expect(result).toMatchObject({ arrived: 0, skippedNoMatch: 1 });
  });

  it('never matches a referral initiated more than 30 days before the referin (stuck-row protection)', async () => {
    const staleInitiated = new Date(Date.now() - 65 * 86_400_000).toISOString();
    await db.execute(`UPDATE cached_referrals SET initiated_at = ? WHERE refer_number = 'RF-001'`, [
      staleInitiated,
    ]);

    const result = await processBrowserReferins(db, DEST_ID, [referinRow()]);

    expect(result).toMatchObject({ arrived: 0, skippedNoMatch: 1 });
    expect((await allReferrals())[0].status).toBe('INITIATED');
  });

  it('one referin evidence row arrives at most one referral (no double-arrive on re-pull)', async () => {
    await processBrowserReferins(db, DEST_ID, [referinRow()]);
    // A second open referral for the same journey/corridor appears later
    // (e.g. the origin gateway caught up) — the SAME re-pulled referin must
    // not flip it too.
    await processBrowserReferouts(db, ORIGIN_ID, [referoutRow({ refer_number: 'RF-002' })]);

    const result = await processBrowserReferins(db, DEST_ID, [referinRow()]);

    expect(result).toMatchObject({ arrived: 0 });
    const rows = await allReferrals();
    expect(rows.find((r) => r.refer_number === 'RF-002')!.status).toBe('INITIATED');
  });

  it('marks ARRIVED but does NOT move ownership for a DELIVERED journey', async () => {
    await db.execute(`UPDATE maternal_journeys SET care_stage = 'DELIVERED' WHERE id = ?`, [
      JOURNEY_ID,
    ]);

    const result = await processBrowserReferins(db, DEST_ID, [referinRow()]);

    expect(result).toMatchObject({ arrived: 1 });
    expect((await allReferrals())[0].status).toBe('ARRIVED');
    const journey = await db.query<{ current_hospital_id: string }>(
      `SELECT current_hospital_id FROM maternal_journeys WHERE id = ?`,
      [JOURNEY_ID],
    );
    expect(journey[0].current_hospital_id).toBe(ORIGIN_ID);
  });

  it('ovst visit evidence at the destination arrives the referral without a referin row', async () => {
    // Some hospitals never fill the refer-in form (operator knowledge) — the
    // OPD visit registry (ovst) is the fallback arrival evidence.
    const result = await processBrowserVisitEvidences(db, DEST_ID, [
      { cid: CID, visit_date: '2026-07-19' },
    ]);

    expect(result).toMatchObject({ rowsRead: 1, arrived: 1, ownershipMoves: 1 });
    const rows = await allReferrals();
    expect(rows[0].status).toBe('ARRIVED');
    const journey = await db.query<{ current_hospital_id: string }>(
      `SELECT current_hospital_id FROM maternal_journeys WHERE id = ?`,
      [JOURNEY_ID],
    );
    expect(journey[0].current_hospital_id).toBe(DEST_ID);
  });

  it('carries the ovst visit time into arrived_at when visit_datetime is provided', async () => {
    await processBrowserVisitEvidences(db, DEST_ID, [
      { cid: CID, visit_datetime: '2026-07-19 10:15:00' },
    ]);
    const rows = await db.query<{ arrived_at: string | Date }>(
      `SELECT arrived_at FROM cached_referrals`,
    );
    const iso =
      rows[0].arrived_at instanceof Date
        ? rows[0].arrived_at.toISOString()
        : new Date(String(rows[0].arrived_at)).toISOString();
    // 10:15 Bangkok = 03:15 UTC
    expect(iso).toContain('T03:15:00');
  });

  it('visit evidence respects the 30-day stale-initiation guard', async () => {
    const staleInitiated = new Date(Date.now() - 65 * 86_400_000).toISOString();
    await db.execute(`UPDATE cached_referrals SET initiated_at = ? WHERE refer_number = 'RF-001'`, [
      staleInitiated,
    ]);

    const result = await processBrowserVisitEvidences(db, DEST_ID, [
      { cid: CID, visit_date: new Date().toISOString().slice(0, 10) },
    ]);

    expect(result).toMatchObject({ arrived: 0, skippedNoMatch: 1 });
    expect((await allReferrals())[0].status).toBe('INITIATED');
  });

  it('visit evidence dated before initiation does not arrive the referral', async () => {
    const result = await processBrowserVisitEvidences(db, DEST_ID, [
      { cid: CID, visit_date: '2026-07-10' },
    ]);
    expect(result).toMatchObject({ arrived: 0, skippedNoMatch: 1 });
  });

  it('does not let an older backfilled arrival override newer arrival evidence (round-trip ordering)', async () => {
    // The journey already arrived somewhere else LATER (July 19, at ORIGIN —
    // i.e. she was referred back and is in active care there).
    const newerArrival = new Date('2026-07-19T12:00:00+07:00').toISOString();
    await db.execute(
      `INSERT INTO cached_referrals (id, journey_id, refer_number, from_hospital_id, to_hospital_id, status, reason, urgency_level, initiated_at, arrived_at, created_at, updated_at)
       VALUES ('back-1', ?, 'RF-BACK', ?, ?, 'ARRIVED', 'refer back', 'ROUTINE', ?, ?, ?, ?)`,
      [JOURNEY_ID, DEST_ID, ORIGIN_ID, newerArrival, newerArrival, newerArrival, newerArrival],
    );

    // An OLDER referin (July 10) for the outbound leg backfills afterwards.
    await db.execute(`UPDATE cached_referrals SET initiated_at = ? WHERE refer_number = 'RF-001'`, [
      new Date('2026-07-09T09:00:00+07:00').toISOString(),
    ]);
    const result = await processBrowserReferins(db, DEST_ID, [
      referinRow({ refer_date: '2026-07-10' }),
    ]);

    expect(result).toMatchObject({ arrived: 1 });
    const journey = await db.query<{ current_hospital_id: string }>(
      `SELECT current_hospital_id FROM maternal_journeys WHERE id = ?`,
      [JOURNEY_ID],
    );
    expect(journey[0].current_hospital_id).toBe(ORIGIN_ID);
  });
});

describe('getReferralArrivalProbe (server-issued CID list for the ovst fallback)', () => {
  beforeEach(async () => {
    // The probe decrypts journey.cid — reseed the journey with a real ciphertext.
    await db.execute(`UPDATE maternal_journeys SET cid = ? WHERE id = ?`, [
      encrypt(CID, getEncryptionKey()),
      JOURNEY_ID,
    ]);
    await processBrowserReferouts(db, ORIGIN_ID, [referoutRow()]);
  });

  it('lists CIDs of open referrals headed to this hospital with a since date', async () => {
    const probe = await getReferralArrivalProbe(db, DEST_ID);
    expect(probe).toHaveLength(1);
    expect(probe[0].cid).toBe(CID);
    expect(probe[0].since <= '2026-07-18').toBe(true);
  });

  it('excludes referrals headed elsewhere and non-open statuses', async () => {
    expect(await getReferralArrivalProbe(db, ORIGIN_ID)).toHaveLength(0);
    await db.execute(`UPDATE cached_referrals SET status = 'ARRIVED'`);
    expect(await getReferralArrivalProbe(db, DEST_ID)).toHaveLength(0);
  });
});
