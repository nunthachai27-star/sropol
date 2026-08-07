// W3: Journey list/detail service tests — written FIRST (TDD).
// Covers freshness gates (PREGNANCY-only), q search (HN + decrypted name),
// DB-wide counts (page-independent), hospital scoping, and detail lookup.
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { encrypt, generateKey } from '@/lib/encryption';
import {
  ANC_MAX_GA_WEEKS,
  ANC_EDC_MAX_PAST_DAYS,
  ANC_LAST_VISIT_MAX_AGE_DAYS,
  ancFreshnessCutoffs,
} from '@/config/anc-freshness';
import { ANC_OPS } from '@/config/anc-ops';
import {
  listJourneys,
  listHospitalJourneys,
  getJourneyDetail,
  parseAncAssessment,
} from '@/services/journey-list';

const HOSP_A = 'hosp-a';
const HOSP_B = 'hosp-b';

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
function daysAheadIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

let seq = 0;
interface JourneySeed {
  hospitalId?: string;
  currentHospitalId?: string;
  hn?: string;
  name?: string;
  careStage?: string;
  ancRiskLevel?: string;
  gaWeeks?: number | null;
  edc?: string | null;
  lastAncDate?: string | null;
  createdAt?: string;
  age?: number;
  ancVisitCount?: number;
}

async function insertJourney(db: DatabaseAdapter, seed: JourneySeed = {}): Promise<string> {
  seq += 1;
  const id = `j-${seq}`;
  const hospitalId = seed.hospitalId ?? HOSP_A;
  const currentHospitalId = seed.currentHospitalId ?? hospitalId;
  const name = encrypt(seed.name ?? `Patient ${seq}`, process.env.ENCRYPTION_KEY!);
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO maternal_journeys
       (id, hospital_id, current_hospital_id, hn, person_anc_id, name, cid, cid_hash,
        age, gravida, para, lmp, edc, care_stage, anc_risk_level, anc_visit_count,
        last_anc_date, ga_weeks, registered_at, stage_changed_at, synced_at,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      hospitalId,
      currentHospitalId,
      seed.hn ?? `HN${String(seq).padStart(4, '0')}`,
      seq,
      name,
      `cid-${seq}`,
      `hash-${seq}`,
      seed.age ?? 28,
      1,
      0,
      null,
      seed.edc ?? null,
      seed.careStage ?? 'PREGNANCY',
      seed.ancRiskLevel ?? 'LOW',
      seed.ancVisitCount ?? 0,
      seed.lastAncDate ?? null,
      seed.gaWeeks ?? null,
      now,
      now,
      now,
      seed.createdAt ?? now,
      now,
    ],
  );
  return id;
}

describe('anc-freshness config', () => {
  it('exposes the three documented gate constants', () => {
    expect(ANC_MAX_GA_WEEKS).toBe(42);
    expect(ANC_EDC_MAX_PAST_DAYS).toBe(14);
    expect(ANC_LAST_VISIT_MAX_AGE_DAYS).toBe(60);
  });

  it('computes cutoffs relative to a supplied clock', () => {
    const now = new Date('2026-07-08T00:00:00.000Z');
    const { edcOnOrAfter, lastAncOnOrAfter } = ancFreshnessCutoffs(now);
    expect(edcOnOrAfter).toBe('2026-06-24T00:00:00.000Z'); // 14 days before
    expect(lastAncOnOrAfter).toBe('2026-05-09T00:00:00.000Z'); // 60 days before
  });
});

describe('journey-list service', () => {
  let db: DatabaseAdapter;
  let prevKey: string | undefined;

  beforeAll(() => {
    prevKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = generateKey();
  });

  afterAll(() => {
    if (prevKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = prevKey;
  });

  beforeEach(async () => {
    seq = 0;
    db = await createTestDb();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, '10670', 'รพ.A', 'A_S', TRUE, 'ONLINE', NOW(), NOW())`,
      [HOSP_A],
    );
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, '10671', 'รพ.B', 'F2', TRUE, 'ONLINE', NOW(), NOW())`,
      [HOSP_B],
    );
  });

  afterEach(async () => {
    await db.close();
  });

  describe('freshness gates (PREGNANCY only)', () => {
    it('excludes post-term / delivered / lost-to-follow-up PREGNANCY rows', async () => {
      const fresh = await insertJourney(db, {
        gaWeeks: 30,
        edc: daysAheadIso(30),
        lastAncDate: daysAgoIso(3),
      });
      await insertJourney(db, { gaWeeks: 45, edc: daysAheadIso(30), lastAncDate: daysAgoIso(3) }); // post-term
      await insertJourney(db, { gaWeeks: 30, edc: daysAgoIso(400), lastAncDate: daysAgoIso(3) }); // delivered
      await insertJourney(db, { gaWeeks: 30, edc: daysAheadIso(30), lastAncDate: daysAgoIso(90) }); // LTFU

      const res = await listJourneys(db, { stage: 'PREGNANCY' });
      const ids = res.journeys.map((j) => j.id);
      expect(ids).toEqual([fresh]);
      expect(res.pagination.total).toBe(1);
    });

    it('treats NULL ga_weeks / edc / last_anc_date as fresh (passes the gate)', async () => {
      const nulls = await insertJourney(db, { gaWeeks: null, edc: null, lastAncDate: null });
      const res = await listJourneys(db, { stage: 'PREGNANCY' });
      expect(res.journeys.map((j) => j.id)).toContain(nulls);
    });

    it('does NOT apply freshness gates to non-PREGNANCY stages', async () => {
      const staleLabor = await insertJourney(db, {
        careStage: 'LABOR',
        gaWeeks: 45,
        edc: daysAgoIso(400),
        lastAncDate: daysAgoIso(400),
      });
      const res = await listJourneys(db, { stage: 'LABOR' });
      expect(res.journeys.map((j) => j.id)).toEqual([staleLabor]);
    });

    it('applies no freshness gate when stage is omitted', async () => {
      await insertJourney(db, { careStage: 'PREGNANCY', gaWeeks: 45 });
      await insertJourney(db, { careStage: 'DELIVERED', gaWeeks: 45 });
      const res = await listJourneys(db, {});
      expect(res.pagination.total).toBe(2);
    });
  });

  describe('q search', () => {
    beforeEach(async () => {
      await insertJourney(db, { hn: 'AAA111', name: 'สมหญิง ใจดี' });
      await insertJourney(db, { hn: 'BBB222', name: 'Somchai Jaidee' });
      await insertJourney(db, { hn: 'CCC333', name: 'Malee Rakdee' });
    });

    it('matches by HN prefix', async () => {
      const res = await listJourneys(db, { q: 'AAA' });
      expect(res.journeys.map((j) => j.hn)).toEqual(['AAA111']);
      expect(res.pagination.total).toBe(1);
    });

    it('matches by decrypted name, case-insensitively (contains)', async () => {
      const res = await listJourneys(db, { q: 'somchai' });
      expect(res.journeys.map((j) => j.hn)).toEqual(['BBB222']);
      expect(res.journeys[0].name).toBe('Somchai Jaidee');
    });

    it('matches Thai names by substring', async () => {
      const res = await listJourneys(db, { q: 'สมหญิง' });
      expect(res.journeys.map((j) => j.hn)).toEqual(['AAA111']);
    });

    it('returns nothing when q matches neither HN nor name', async () => {
      const res = await listJourneys(db, { q: 'zzz-no-match' });
      expect(res.journeys).toHaveLength(0);
      expect(res.pagination.total).toBe(0);
    });
  });

  describe('counts (DB-wide, page-independent)', () => {
    it('counts the full stage+freshness set, not just the current page', async () => {
      for (let i = 0; i < 25; i++) {
        await insertJourney(db, { ancRiskLevel: 'LOW', gaWeeks: 30 });
      }
      await insertJourney(db, { ancRiskLevel: 'HR1', gaWeeks: 30 });
      await insertJourney(db, { ancRiskLevel: 'HR3', gaWeeks: 30 });
      // stale row must be excluded from counts too
      await insertJourney(db, { ancRiskLevel: 'HR3', gaWeeks: 99 });

      const res = await listJourneys(db, { stage: 'PREGNANCY', page: 1, perPage: 20 });
      expect(res.journeys).toHaveLength(20); // page-bound
      expect(res.counts).toBeDefined();
      expect(res.counts!.low).toBe(25); // DB-wide
      expect(res.counts!.hr1).toBe(1);
      expect(res.counts!.hr3).toBe(1); // stale HR3 excluded
      expect(res.counts!.total).toBe(27);
    });

    it('counts ignore the risk_level filter (KPI shows all levels)', async () => {
      await insertJourney(db, { ancRiskLevel: 'LOW', gaWeeks: 30 });
      await insertJourney(db, { ancRiskLevel: 'HR3', gaWeeks: 30 });

      const res = await listJourneys(db, { stage: 'PREGNANCY', riskLevel: 'HR3' });
      expect(res.journeys.every((j) => j.ancRiskLevel === 'HR3')).toBe(true);
      expect(res.pagination.total).toBe(1); // list filtered to HR3
      expect(res.counts!.low).toBe(1); // counts still see LOW
      expect(res.counts!.hr3).toBe(1);
      expect(res.counts!.total).toBe(2);
    });

    it('counts respect an explicit hospital filter', async () => {
      await insertJourney(db, { currentHospitalId: HOSP_A, ancRiskLevel: 'LOW', gaWeeks: 30 });
      await insertJourney(db, { currentHospitalId: HOSP_B, ancRiskLevel: 'HR2', gaWeeks: 30 });

      const res = await listJourneys(db, { stage: 'PREGNANCY', hospitalId: HOSP_A });
      expect(res.counts!.total).toBe(1);
      expect(res.counts!.low).toBe(1);
      expect(res.counts!.hr2).toBe(0);
    });
  });

  describe('ops counts, cohort filters, sort (province ANC board)', () => {
    it('opsCounts summarise the gated PREGNANCY set independent of risk/q filters', async () => {
      // dueSoon + nearTerm
      await insertJourney(db, {
        gaWeeks: 38,
        edc: daysAheadIso(5),
        ancVisitCount: 6,
        lastAncDate: daysAgoIso(5),
      });
      // dueSoon + overdueEdc + nearTerm (EDC passed but inside the 14d grace)
      await insertJourney(db, {
        gaWeeks: 40,
        edc: daysAgoIso(3),
        ancVisitCount: 5,
        lastAncDate: daysAgoIso(10),
      });
      // ancStale (last visit 40 days ago — inside gate, past warn threshold)
      await insertJourney(db, {
        gaWeeks: 20,
        edc: daysAheadIso(60),
        ancVisitCount: 1,
        lastAncDate: daysAgoIso(40),
      });
      // lowVisits (GA >= 32 with < 5 visits), not nearTerm
      await insertJourney(db, {
        gaWeeks: 33,
        edc: daysAheadIso(40),
        ancVisitCount: 3,
        lastAncDate: daysAgoIso(10),
      });
      // LTFU — outside the 60d gate but inside the 120d worklist window
      await insertJourney(db, {
        gaWeeks: 30,
        edc: daysAheadIso(30),
        ancVisitCount: 2,
        lastAncDate: daysAgoIso(80),
      });
      // Other stage — never counted
      await insertJourney(db, { careStage: 'LABOR', gaWeeks: 39, edc: daysAheadIso(2) });

      const result = await listJourneys(db, { stage: 'PREGNANCY', riskLevel: 'HR3' });

      expect(result.opsCounts).toEqual({
        dueSoon: 2,
        overdueEdc: 1,
        ancStale: 1,
        lowVisits: 1,
        nearTerm: 2,
        ltfu: 1,
      });
    });

    it('cohort=due_soon returns only women whose EDC falls within the window', async () => {
      const dueA = await insertJourney(db, { edc: daysAheadIso(5), lastAncDate: daysAgoIso(5) });
      const dueB = await insertJourney(db, { edc: daysAgoIso(3), lastAncDate: daysAgoIso(5) });
      await insertJourney(db, {
        edc: daysAheadIso(ANC_OPS.dueSoonDays + 10),
        lastAncDate: daysAgoIso(5),
      });

      const result = await listJourneys(db, { stage: 'PREGNANCY', cohort: 'due_soon' });

      expect(result.journeys.map((j) => j.id).sort()).toEqual([dueA, dueB].sort());
    });

    it('cohort=ltfu relaxes the last-ANC gate and returns the 60–120 day cohort', async () => {
      await insertJourney(db, { lastAncDate: daysAgoIso(10), edc: daysAheadIso(30) }); // active — not LTFU
      const ltfu = await insertJourney(db, { lastAncDate: daysAgoIso(80), edc: daysAheadIso(30) });
      await insertJourney(db, { lastAncDate: daysAgoIso(130), edc: daysAheadIso(30) }); // beyond worklist window

      const result = await listJourneys(db, { stage: 'PREGNANCY', cohort: 'ltfu' });

      expect(result.journeys.map((j) => j.id)).toEqual([ltfu]);
    });

    it('sort=due orders by soonest EDC with unknown EDC last', async () => {
      const later = await insertJourney(db, { edc: daysAheadIso(20), lastAncDate: daysAgoIso(5) });
      const soonest = await insertJourney(db, { edc: daysAheadIso(5), lastAncDate: daysAgoIso(5) });
      const unknown = await insertJourney(db, { edc: null, lastAncDate: daysAgoIso(5) });

      const result = await listJourneys(db, { stage: 'PREGNANCY', sort: 'due' });

      expect(result.journeys.map((j) => j.id)).toEqual([soonest, later, unknown]);
    });

    it('q also matches the hospital name', async () => {
      await insertJourney(db, { hospitalId: HOSP_A, lastAncDate: daysAgoIso(5) });
      const atB = await insertJourney(db, { hospitalId: HOSP_B, lastAncDate: daysAgoIso(5) });

      const result = await listJourneys(db, { stage: 'PREGNANCY', q: 'รพ.B' });

      expect(result.journeys.map((j) => j.id)).toEqual([atB]);
    });

    it('derives GA from EDC when ga_weeks is missing', async () => {
      // EDC 42 days out → 280 - 42 = 238 gestational days → 34 weeks.
      await insertJourney(db, { gaWeeks: null, edc: daysAheadIso(42), lastAncDate: daysAgoIso(5) });

      const result = await listJourneys(db, { stage: 'PREGNANCY' });

      expect(result.journeys[0].gaWeeks).toBe(34);
    });

    it('returns a hospitalCounts facet over the gated set', async () => {
      await insertJourney(db, { hospitalId: HOSP_A, lastAncDate: daysAgoIso(5) });
      await insertJourney(db, { hospitalId: HOSP_A, lastAncDate: daysAgoIso(5) });
      await insertJourney(db, { hospitalId: HOSP_B, lastAncDate: daysAgoIso(5) });

      const result = await listJourneys(db, { stage: 'PREGNANCY' });

      expect(result.hospitalCounts).toEqual([
        { id: HOSP_A, name: 'รพ.A', count: 2 },
        { id: HOSP_B, name: 'รพ.B', count: 1 },
      ]);
    });
  });

  describe('listHospitalJourneys', () => {
    it('scopes to the hospital by hcode', async () => {
      await insertJourney(db, { currentHospitalId: HOSP_A, gaWeeks: 30 });
      await insertJourney(db, { currentHospitalId: HOSP_B, gaWeeks: 30 });

      const res = await listHospitalJourneys(db, '10670', { stage: 'PREGNANCY' });
      expect(res).not.toBeNull();
      expect(res!.journeys).toHaveLength(1);
    });

    // The hospital console KPI strip showed `journeys.length` from a capped
    // fetch — hospitals above the cap displayed the cap (e.g. "200" for 435
    // pregnancies) and every risk-mix number undercounted. True totals must
    // come from the service, independent of pagination.
    it('returns DB-wide risk counts independent of pagination', async () => {
      for (let i = 0; i < 3; i++) {
        await insertJourney(db, { currentHospitalId: HOSP_A, gaWeeks: 30, ancRiskLevel: 'LOW' });
      }
      await insertJourney(db, { currentHospitalId: HOSP_A, gaWeeks: 30, ancRiskLevel: 'HR2' });
      await insertJourney(db, { currentHospitalId: HOSP_A, gaWeeks: 30, ancRiskLevel: 'HR3' });
      await insertJourney(db, { currentHospitalId: HOSP_A, gaWeeks: 30, ancRiskLevel: 'HR3' });
      // Out-of-population rows that must NOT leak into the counts:
      await insertJourney(db, { currentHospitalId: HOSP_B, gaWeeks: 30, ancRiskLevel: 'HR3' });
      await insertJourney(db, {
        currentHospitalId: HOSP_A,
        careStage: 'DELIVERED',
        ancRiskLevel: 'HR3',
      });

      const res = await listHospitalJourneys(db, '10670', { stage: 'PREGNANCY', perPage: 2 });
      expect(res!.journeys).toHaveLength(2);
      expect(res!.pagination.total).toBe(6);
      expect(res!.counts).toEqual({ low: 3, hr1: 0, hr2: 1, hr3: 2, total: 6 });
    });

    it('counts ignore the riskLevel filter (stable KPI contract, same as province board)', async () => {
      await insertJourney(db, { currentHospitalId: HOSP_A, gaWeeks: 30, ancRiskLevel: 'LOW' });
      await insertJourney(db, { currentHospitalId: HOSP_A, gaWeeks: 30, ancRiskLevel: 'HR3' });

      const res = await listHospitalJourneys(db, '10670', {
        stage: 'PREGNANCY',
        riskLevel: 'HR3',
      });
      expect(res!.journeys).toHaveLength(1);
      expect(res!.pagination.total).toBe(1);
      expect(res!.counts).toEqual({ low: 1, hr1: 0, hr2: 0, hr3: 1, total: 2 });
    });

    it('applies PREGNANCY freshness gates (count query uses a consistent alias)', async () => {
      await insertJourney(db, { currentHospitalId: HOSP_A, gaWeeks: 30 });
      await insertJourney(db, { currentHospitalId: HOSP_A, gaWeeks: 99 }); // stale

      const res = await listHospitalJourneys(db, '10670', { stage: 'PREGNANCY' });
      expect(res!.pagination.total).toBe(1);
      expect(res!.journeys).toHaveLength(1);
    });

    it('returns null for an unknown hcode', async () => {
      const res = await listHospitalJourneys(db, '99999', {});
      expect(res).toBeNull();
    });
  });

  // WHO containment T6 — pure function, tested directly (valid / legacy `{}`
  // / malformed / webhook items-shape / already-parsed pg JSONB object).
  describe('parseAncAssessment', () => {
    it('parses a valid completeness object (string JSON, as SQLite/text columns would return)', () => {
      const result = parseAncAssessment(
        JSON.stringify({ missingRequired: ['bpSystolic'], assessmentIncomplete: true }),
      );
      expect(result).toEqual({ incomplete: true, missingRequired: ['bpSystolic'] });
    });

    it('accepts an already-parsed object (pg JSONB passthrough)', () => {
      const result = parseAncAssessment({ missingRequired: [], assessmentIncomplete: false });
      expect(result).toEqual({ incomplete: false, missingRequired: [] });
    });

    it('returns null for legacy empty object {}', () => {
      expect(parseAncAssessment('{}')).toBeNull();
      expect(parseAncAssessment({})).toBeNull();
    });

    it('returns null for malformed JSON', () => {
      expect(parseAncAssessment('{not json')).toBeNull();
    });

    it('returns null for the webhook items-based shape (no missingRequired/assessmentIncomplete keys)', () => {
      expect(parseAncAssessment(JSON.stringify({ itemIds: [16] }))).toBeNull();
    });

    it('returns null for null/undefined', () => {
      expect(parseAncAssessment(null)).toBeNull();
      expect(parseAncAssessment(undefined)).toBeNull();
    });
  });

  describe('getJourneyDetail', () => {
    it('returns null when the journey does not exist', async () => {
      const res = await getJourneyDetail(db, 'does-not-exist');
      expect(res).toBeNull();
    });

    it('maps journey + empty sub-collections and decrypts the name', async () => {
      const id = await insertJourney(db, { name: 'Detail Person', gaWeeks: 30 });
      const res = await getJourneyDetail(db, id);
      expect(res).not.toBeNull();
      expect(res!.journey.id).toBe(id);
      expect(res!.journey.name).toBe('Detail Person');
      expect(res!.ancVisits).toEqual([]);
      expect(res!.newborns).toEqual([]);
      expect(res!.referrals).toEqual([]);
      expect(res!.latestRisk).toBeNull();
      expect(res!.ancAssessment).toBeNull();
      // No labor record linked → no cross-link; syncedAt always present.
      expect(res!.laborAdmission).toBeNull();
      expect(res!.journey.syncedAt).toBeTruthy();
    });

    it('ancAssessment is null when there is no cached_anc_risks row at all', async () => {
      const id = await insertJourney(db, { name: 'No Screening', gaWeeks: 30 });
      const res = await getJourneyDetail(db, id);
      expect(res!.ancAssessment).toBeNull();
    });

    // WHO containment T6 — T3 persists {missingRequired, assessmentIncomplete}
    // into cached_anc_risks.risk_factors on the POLLING path. getJourneyDetail
    // must surface it so an incomplete LOW never displays as a bare confirmed
    // LOW chip.
    it('exposes ancAssessment parsed from the latest cached_anc_risks.risk_factors (WHO containment T6)', async () => {
      const id = await insertJourney(db, { name: 'Incomplete Person', gaWeeks: 30 });
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO cached_anc_risks (id, journey_id, risk_level, triggered_rules, risk_factors, screened_at, created_at)
         VALUES (?, ?, 'LOW', '[]', ?, ?, ?)`,
        [
          crypto.randomUUID(),
          id,
          JSON.stringify({ missingRequired: ['bpSystolic', 'hb'], assessmentIncomplete: true }),
          now,
          now,
        ],
      );
      const res = await getJourneyDetail(db, id);
      expect(res!.ancAssessment).toEqual({
        incomplete: true,
        missingRequired: ['bpSystolic', 'hb'],
      });
    });

    it('ancAssessment is null for legacy {} risk_factors (pre-T3 rows)', async () => {
      const id = await insertJourney(db, { name: 'Legacy Row', gaWeeks: 30 });
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO cached_anc_risks (id, journey_id, risk_level, triggered_rules, risk_factors, screened_at, created_at)
         VALUES (?, ?, 'LOW', '[]', '{}', ?, ?)`,
        [crypto.randomUUID(), id, now, now],
      );
      const res = await getJourneyDetail(db, id);
      expect(res!.ancAssessment).toBeNull();
    });

    it('ancAssessment is null for the webhook items-based risk_factors shape (no missingRequired key)', async () => {
      const id = await insertJourney(db, { name: 'Webhook Screened', gaWeeks: 30 });
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO cached_anc_risks (id, journey_id, risk_level, triggered_rules, risk_factors, screened_at, created_at)
         VALUES (?, ?, 'LOW', '[]', ?, ?, ?)`,
        [crypto.randomUUID(), id, JSON.stringify({ itemIds: [16] }), now, now],
      );
      const res = await getJourneyDetail(db, id);
      expect(res!.ancAssessment).toBeNull();
    });

    it('returns the linked labor admission (latest by admit date) for the cross-link', async () => {
      const id = await insertJourney(db, { careStage: 'LABOR', gaWeeks: 39 });
      const now = new Date().toISOString();
      const insertLabor = (rowId: string, an: string, admitDate: string) =>
        db.execute(
          `INSERT INTO cached_patients
             (id, hospital_id, journey_id, hn, an, name, age, admit_date, labor_status,
              synced_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [rowId, HOSP_A, id, 'HN-L1', an, 'enc', 28, admitDate, 'ACTIVE', now, now, now],
        );
      await insertLabor('cp-old', '69000001', daysAgoIso(30));
      await insertLabor('cp-new', '69000002', daysAgoIso(1));

      const res = await getJourneyDetail(db, id);

      expect(res!.laborAdmission).toEqual({
        an: '69000002',
        hcode: '10670',
        laborStatus: 'ACTIVE',
        admitDate: expect.any(String),
      });
    });
  });
});
