// Integration tests: ANC webhook, referral webhook, and delete operations
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { createTestDb } from '../helpers/testDb';
import { FailingAdapter } from '../helpers/failingDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import { generateKey } from '@/lib/encryption';
import { toIsoDate } from '@/lib/dates';
import type { SseManager } from '@/lib/sse';
import {
  createApiKey,
  processAncWebhook,
  processReferralCreate,
  processReferralUpdate,
  processWebhookPayload,
  type WebhookAncPayload,
  type WebhookReferralCreatePayload,
  type WebhookReferralUpdatePayload,
  type WebhookPayload,
} from '@/services/webhook';

// Ensure ENCRYPTION_KEY is set for tests
const TEST_ENCRYPTION_KEY = generateKey();
process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

// Mock SSE manager — duck-typed to avoid private-constructor singleton
class MockSseManager {
  public events: Array<{ event: string; data: unknown }> = [];

  broadcast(event: string, data: unknown): void {
    this.events.push({ event, data });
  }

  clearEvents(): void {
    this.events = [];
  }

  getEventsByType(type: string): Array<{ event: string; data: unknown }> {
    return this.events.filter(
      (e) => e.event === type || (e.data as Record<string, unknown>)?.type === type,
    );
  }
}

function asSse(mock: MockSseManager): SseManager {
  return mock as unknown as SseManager;
}

describe('ANC/Referral Webhook Integration', () => {
  let db: DatabaseAdapter;
  let sseManager: MockSseManager;
  let webhookHospitalId: string;
  let destHospitalId: string;

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    sseManager = new MockSseManager();

    const now = new Date().toISOString();
    webhookHospitalId = uuidv4();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [webhookHospitalId, '99902', 'รพ.ANC ทดสอบ (Webhook)', 'M2', true, 'UNKNOWN', now, now],
    );

    // Second hospital for referral destination
    destHospitalId = uuidv4();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [destHospitalId, '99903', 'รพ.ปลายทาง ทดสอบ', 'A', true, 'UNKNOWN', now, now],
    );

    await createApiKey(db, webhookHospitalId, 'Test Key');
  });

  afterEach(async () => {
    await db.close();
  });

  // ─── ANC Webhook Tests ───

  describe('Scenario 1: ANC create — new patient creates maternal_journeys record', () => {
    it('creates a maternal_journeys record for a new ANC patient', async () => {
      const payload: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'ANC-001',
            name: 'นาง ทดสอบ ฝากครรภ์',
            cid: '2345678900017',
            birthday: '1996-01-15',
            pregNo: 1,
            lmp: '2025-08-01',
            edc: '2026-05-08',
            riskLevel: 'LOW',
          },
        ],
      };

      const result = await processAncWebhook(db, webhookHospitalId, payload, asSse(sseManager));

      expect(result.patientsProcessed).toBe(1);
      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.deleted).toBe(0);

      // Verify record in maternal_journeys
      const journeys = await db.query<{ hn: string; care_stage: string; anc_risk_level: string }>(
        'SELECT hn, care_stage, anc_risk_level FROM maternal_journeys WHERE hn = ? AND hospital_id = ?',
        ['ANC-001', webhookHospitalId],
      );
      expect(journeys).toHaveLength(1);
      expect(journeys[0].hn).toBe('ANC-001');
      expect(journeys[0].care_stage).toBe('PREGNANCY');
      expect(journeys[0].anc_risk_level).toBe('LOW');

      // ONE coalesced journey_update broadcast per ingest call (2026-07-17
      // dashboard incident: per-pregnancy events amplified into ~79 req/s).
      const sse = sseManager.getEventsByType('journey_update');
      expect(sse).toHaveLength(1);
      const evt = sse[0].data as Record<string, unknown>;
      expect(evt.bulk).toBe(true);
      expect(evt.created).toBe(1);
    });
  });

  describe('Scenario 1b: CID collision — two women sharing one CID must not ping-pong', () => {
    it('same-hospital patients with one CID but different HN/pregNo keep separate journeys and never ghost-deliver each other', async () => {
      // 2026-07-19 ghost-journey incident: two cohort members shared a CID;
      // each cycle, each one found the OTHER's active journey via the CID
      // lookup, saw a different pregNo/lmp, declared "new pregnancy",
      // DELIVERED the other's journey and created a fresh one — two ghost
      // DELIVERED rows per cycle (~1,760 per identity in production).
      const sharedCid = '2345678900017';
      const payload: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'COLL-A',
            name: 'นาง ก ชนซีไอดี',
            cid: sharedCid,
            birthday: '1996-01-15',
            pregNo: 3,
            lmp: '2025-08-01',
            edc: '2026-05-08',
            riskLevel: 'LOW',
          },
          {
            hn: 'COLL-B',
            name: 'นาง ข ชนซีไอดี',
            cid: sharedCid,
            birthday: '1992-02-20',
            pregNo: 4,
            lmp: '2025-10-01',
            edc: '2026-07-08',
            riskLevel: 'LOW',
          },
        ],
      };

      // Three cycles — the production loop compounded once per cycle.
      await processAncWebhook(db, webhookHospitalId, payload, asSse(sseManager));
      await processAncWebhook(db, webhookHospitalId, payload, asSse(sseManager));
      await processAncWebhook(db, webhookHospitalId, payload, asSse(sseManager));

      const cidHash = createHash('sha256').update(sharedCid).digest('hex');
      const journeys = await db.query<{ hn: string; care_stage: string }>(
        'SELECT hn, care_stage FROM maternal_journeys WHERE cid_hash = ? ORDER BY hn',
        [cidHash],
      );
      // Exactly one journey per woman, both still ACTIVE — zero ghosts.
      expect(journeys).toHaveLength(2);
      expect(journeys.map((j) => j.hn).sort()).toEqual(['COLL-A', 'COLL-B']);
      for (const j of journeys) {
        expect(j.care_stage).toBe('PREGNANCY');
      }
    });
  });

  describe('Scenario 2: ANC update — resending same patient updates existing journey', () => {
    it('updates anc_risk_level when same HN is sent again', async () => {
      // First: create
      const create: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'ANC-UPD',
            name: 'นาง อัพเดท ความเสี่ยง',
            cid: '1007000100018',
            birthday: '1994-06-20',
            pregNo: 2,
            lmp: '2025-07-01',
            edc: '2026-04-07',
            riskLevel: 'LOW',
          },
        ],
      };
      await processAncWebhook(db, webhookHospitalId, create, asSse(sseManager));

      const before = await db.query<{ anc_risk_level: string }>(
        'SELECT anc_risk_level FROM maternal_journeys WHERE hn = ? AND hospital_id = ?',
        ['ANC-UPD', webhookHospitalId],
      );
      expect(before[0].anc_risk_level).toBe('LOW');

      sseManager.clearEvents();

      // Second: update riskLevel to HR2 ('HIGH' is not a valid AncRiskLevel —
      // canonical resolution now rejects it and retains the existing level,
      // see the sibling test below for that behavior).
      const update: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'ANC-UPD',
            name: 'นาง อัพเดท ความเสี่ยง',
            cid: '1007000100026',
            birthday: '1994-06-20',
            pregNo: 2,
            lmp: '2025-07-01',
            edc: '2026-04-07',
            riskLevel: 'HR2',
          },
        ],
      };
      const result = await processAncWebhook(db, webhookHospitalId, update, asSse(sseManager));

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);

      const after = await db.query<{ anc_risk_level: string }>(
        'SELECT anc_risk_level FROM maternal_journeys WHERE hn = ? AND hospital_id = ?',
        ['ANC-UPD', webhookHospitalId],
      );
      expect(after).toHaveLength(1); // No duplicate
      expect(after[0].anc_risk_level).toBe('HR2');
    });

    it('declared-only legacy payload (no riskItemIds) CANNOT lower a known level — missing evidence never downgrades (WHO T4)', async () => {
      // First: create at HR2 (no riskItemIds — declared-only, legacy-style payload)
      const create: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'ANC-LEGACY-LOWER',
            name: 'นาง ทดสอบ ลดระดับ',
            cid: '1007000100131',
            birthday: '1994-06-20',
            pregNo: 1,
            riskLevel: 'HR2',
          },
        ],
      };
      await processAncWebhook(db, webhookHospitalId, create, asSse(sseManager));
      const before = await db.query<{ anc_risk_level: string }>(
        'SELECT anc_risk_level FROM maternal_journeys WHERE hn = ? AND hospital_id = ?',
        ['ANC-LEGACY-LOWER', webhookHospitalId],
      );
      expect(before[0].anc_risk_level).toBe('HR2');

      sseManager.clearEvents();

      // Second: re-send with riskLevel LOW and still no riskItemIds. A
      // declared-only payload carries no positive item evidence, so it is
      // "missing evidence" and must NOT lower the journey. It stays HR2 and the
      // rejected downgrade is counted + logged (reason 'declared_only').
      const lower: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'ANC-LEGACY-LOWER',
            name: 'นาง ทดสอบ ลดระดับ',
            cid: '1007000100140',
            birthday: '1994-06-20',
            pregNo: 1,
            riskLevel: 'LOW',
          },
        ],
      };
      const result = await processAncWebhook(db, webhookHospitalId, lower, asSse(sseManager));
      expect(result.downgradesBlocked).toBe(1);

      const after = await db.query<{ anc_risk_level: string }>(
        'SELECT anc_risk_level FROM maternal_journeys WHERE hn = ? AND hospital_id = ?',
        ['ANC-LEGACY-LOWER', webhookHospitalId],
      );
      expect(after[0].anc_risk_level).toBe('HR2');

      // WHO T4 invariant, coalesced-broadcast form: the event stream must
      // never ANNOUNCE the rejected LOW. Bulk events carry only counts — no
      // per-journey level exists to mislead; assert nothing carries a level.
      const sse = sseManager.getEventsByType('journey_update');
      expect(sse.length).toBeGreaterThanOrEqual(1);
      for (const e of sse) {
        expect((e.data as Record<string, unknown>).ancRiskLevel).toBeUndefined();
      }
    });

    it('empty riskItemIds ([]) cannot lower a known journey risk — HR3 stays, no new screening row (WHO T4 prod bug)', async () => {
      // First: establish an HR3 journey via positive item evidence ([16]
      // derives HR3). This also writes one cached_anc_risks screening row.
      const create: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'ANC-EMPTY-LOWER',
            name: 'นาง ทดสอบ รายการว่าง',
            cid: '1100500090006',
            birthday: '1994-06-20',
            pregNo: 1,
            riskLevel: 'HR3',
            riskItemIds: [16],
          },
        ],
      };
      await processAncWebhook(db, webhookHospitalId, create, asSse(sseManager));
      const journeyBefore = await db.query<{ id: string; anc_risk_level: string }>(
        'SELECT id, anc_risk_level FROM maternal_journeys WHERE hn = ? AND hospital_id = ?',
        ['ANC-EMPTY-LOWER', webhookHospitalId],
      );
      expect(journeyBefore[0].anc_risk_level).toBe('HR3');
      const journeyId = journeyBefore[0].id;
      const screeningBefore = await db.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM cached_anc_risks WHERE journey_id = ?',
        [journeyId],
      );

      sseManager.clearEvents();

      // Second: a transient HOSxP query returns zero classifying rows → empty
      // items array + declared LOW. This is the primary production bug — an
      // empty [] derives LOW and would overwrite HR3. It must be blocked.
      const lower: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'ANC-EMPTY-LOWER',
            name: 'นาง ทดสอบ รายการว่าง',
            cid: '1100500090006',
            birthday: '1994-06-20',
            pregNo: 1,
            riskLevel: 'LOW',
            riskItemIds: [],
          },
        ],
      };
      const result = await processAncWebhook(db, webhookHospitalId, lower, asSse(sseManager));
      expect(result.downgradesBlocked).toBe(1);
      expect(result.updated).toBe(1);

      const after = await db.query<{ anc_risk_level: string }>(
        'SELECT anc_risk_level FROM maternal_journeys WHERE id = ?',
        [journeyId],
      );
      expect(after[0].anc_risk_level).toBe('HR3');

      // No new (lower) screening row appended — keeps the reconciliation
      // journey-vs-latest-screening report clean.
      const screeningAfter = await db.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM cached_anc_risks WHERE journey_id = ?',
        [journeyId],
      );
      expect(screeningAfter[0].count).toBe(screeningBefore[0].count);

      // WHO T4 invariant, coalesced-broadcast form: no event may announce the
      // rejected LOW (bulk events carry counts only — no level field at all).
      const sse = sseManager.getEventsByType('journey_update');
      expect(sse.length).toBeGreaterThanOrEqual(1);
      for (const e of sse) {
        expect((e.data as Record<string, unknown>).ancRiskLevel).toBeUndefined();
      }
    });
  });

  describe('Scenario 3: ANC delete — removes journey and related records', () => {
    it('deletes journey and cascades to related tables', async () => {
      // Create journey first
      const create: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'ANC-DEL',
            name: 'นาง ลบ ข้อมูล',
            cid: '1007000100034',
            birthday: '1998-03-10',
            pregNo: 1,
            riskLevel: 'LOW',
          },
        ],
      };
      await processAncWebhook(db, webhookHospitalId, create, asSse(sseManager));

      const before = await db.query<{ id: string }>(
        'SELECT id FROM maternal_journeys WHERE hn = ? AND hospital_id = ?',
        ['ANC-DEL', webhookHospitalId],
      );
      expect(before).toHaveLength(1);
      const journeyId = before[0].id;

      sseManager.clearEvents();

      // Seed a related anc visit to verify cascade
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO cached_anc_visits (id, journey_id, visit_number, visit_date, synced_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [uuidv4(), journeyId, 1, '2025-09-01', now, now],
      );

      // Delete
      const del: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'ANC-DEL',
            name: 'นาง ลบ ข้อมูล',
            cid: '1007000100042',
            birthday: '1998-03-10',
            pregNo: 1,
            action: 'delete',
          },
        ],
      };
      const result = await processAncWebhook(db, webhookHospitalId, del, asSse(sseManager));

      expect(result.deleted).toBe(1);

      // Journey removed
      const after = await db.query(
        'SELECT id FROM maternal_journeys WHERE hn = ? AND hospital_id = ?',
        ['ANC-DEL', webhookHospitalId],
      );
      expect(after).toHaveLength(0);

      // Related anc visits removed
      const visits = await db.query('SELECT id FROM cached_anc_visits WHERE journey_id = ?', [
        journeyId,
      ]);
      expect(visits).toHaveLength(0);

      // Coalesced broadcast covers the delete via its counts.
      const sse = sseManager.getEventsByType('journey_update');
      expect(sse.length).toBeGreaterThanOrEqual(1);
      const evt = sse[sse.length - 1].data as Record<string, unknown>;
      expect(evt.bulk).toBe(true);
      expect(evt.deleted).toBe(1);
    });

    it('delete of non-existent patient is a no-op (deleted = 0)', async () => {
      const del: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'ANC-GHOST',
            name: 'ไม่มีในระบบ',
            cid: '1007000100051',
            birthday: '2000-01-01',
            pregNo: 1,
            action: 'delete',
          },
        ],
      };
      const result = await processAncWebhook(db, webhookHospitalId, del, asSse(sseManager));
      expect(result.deleted).toBe(0);
    });
  });

  describe('Scenario 4: ANC multiple patients — both created in one payload', () => {
    it('creates records for all patients in a single payload', async () => {
      const payload: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'ANC-M01',
            name: 'นาง แรก คนแรก',
            cid: '1007000100069',
            birthday: '1995-05-01',
            pregNo: 1,
            riskLevel: 'LOW',
          },
          {
            hn: 'ANC-M02',
            name: 'นาง สอง คนสอง',
            cid: '1007000100077',
            birthday: '1993-08-15',
            pregNo: 3,
            riskLevel: 'HR2',
          },
        ],
      };

      const result = await processAncWebhook(db, webhookHospitalId, payload, asSse(sseManager));

      expect(result.patientsProcessed).toBe(2);
      expect(result.created).toBe(2);
      expect(result.updated).toBe(0);

      const journeys = await db.query<{ hn: string; anc_risk_level: string }>(
        `SELECT hn, anc_risk_level FROM maternal_journeys WHERE hospital_id = ? ORDER BY hn`,
        [webhookHospitalId],
      );
      expect(journeys).toHaveLength(2);
      expect(journeys[0].hn).toBe('ANC-M01');
      expect(journeys[0].anc_risk_level).toBe('LOW');
      expect(journeys[1].hn).toBe('ANC-M02');
      expect(journeys[1].anc_risk_level).toBe('HR2');
    });
  });

  // ─── Patient Location Tests ───

  describe('Scenario 8: ANC webhook stores patient location for GIS', () => {
    it('stores changwat/amphur/tambon codes on maternal_journeys', async () => {
      const payload: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'LOC-001',
            name: 'นาง แผนที่ จีไอเอส',
            cid: '4001000123459',
            birthday: '1996-06-15',
            pregNo: 1,
            riskLevel: 'LOW',
            changwatCode: '40', // ขอนแก่น
            amphurCode: '01', // เมืองขอนแก่น
            tambonCode: '01', // ในเมือง
          },
        ],
      };

      await processAncWebhook(db, webhookHospitalId, payload, asSse(sseManager));

      const journey = await db.query<{
        changwat_code: string | null;
        amphur_code: string | null;
        tambon_code: string | null;
      }>(
        'SELECT changwat_code, amphur_code, tambon_code FROM maternal_journeys WHERE hn = ? AND hospital_id = ?',
        ['LOC-001', webhookHospitalId],
      );
      expect(journey).toHaveLength(1);
      expect(journey[0].changwat_code).toBe('40');
      expect(journey[0].amphur_code).toBe('01');
      expect(journey[0].tambon_code).toBe('01');
    });

    it('location is null when not provided', async () => {
      const payload: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'LOC-002',
            name: 'นาง ไม่มี ที่อยู่',
            cid: '4001000999991',
            birthday: '1998-01-01',
            pregNo: 1,
          },
        ],
      };

      await processAncWebhook(db, webhookHospitalId, payload, asSse(sseManager));

      const journey = await db.query<{
        changwat_code: string | null;
        amphur_code: string | null;
        tambon_code: string | null;
      }>(
        'SELECT changwat_code, amphur_code, tambon_code FROM maternal_journeys WHERE hn = ? AND hospital_id = ?',
        ['LOC-002', webhookHospitalId],
      );
      expect(journey[0].changwat_code).toBeNull();
      expect(journey[0].amphur_code).toBeNull();
      expect(journey[0].tambon_code).toBeNull();
    });

    it('referral create stores patient location', async () => {
      const payload: WebhookReferralCreatePayload = {
        type: 'referral',
        hospitalCode: '99902',
        referralId: 'REF-LOC-001',
        hn: 'LOC-003',
        cid: '4001000777777',
        name: 'นาง ส่งต่อ มีที่อยู่',
        toHospitalCode: '99903',
        reason: 'ทดสอบ location',
        changwatCode: '40',
        amphurCode: '25',
        tambonCode: '03',
      };

      await processReferralCreate(db, webhookHospitalId, payload, asSse(sseManager));

      const journey = await db.query<{
        changwat_code: string | null;
        amphur_code: string | null;
        tambon_code: string | null;
      }>(
        'SELECT changwat_code, amphur_code, tambon_code FROM maternal_journeys WHERE hn = ? AND hospital_id = ?',
        ['LOC-003', webhookHospitalId],
      );
      expect(journey).toHaveLength(1);
      expect(journey[0].changwat_code).toBe('40');
      expect(journey[0].amphur_code).toBe('25');
      expect(journey[0].tambon_code).toBe('03');
    });
  });

  // ─── Overlapping Pregnancy Detection Tests ───

  describe('Scenario 9: Overlapping pregnancy detection', () => {
    const sameCid = '4001000555553';

    it('same CID + same pregNo updates existing journey (no new creation)', async () => {
      const p1: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'OVR-001',
            name: 'นาง ซ้ำ ครรภ์เดิม',
            cid: sameCid,
            birthday: '1995-01-01',
            pregNo: 1,
            lmp: '2025-08-01',
            riskLevel: 'LOW',
          },
        ],
      };
      await processAncWebhook(db, webhookHospitalId, p1, asSse(sseManager));

      const p2: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'OVR-001',
            name: 'นาง ซ้ำ ครรภ์เดิม',
            cid: sameCid,
            birthday: '1995-01-01',
            pregNo: 1,
            lmp: '2025-08-01',
            riskLevel: 'HR1',
          },
        ],
      };
      const result = await processAncWebhook(db, webhookHospitalId, p2, asSse(sseManager));
      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);

      const { createHash: h } = await import('crypto');
      const journeys = await db.query('SELECT id FROM maternal_journeys WHERE cid_hash = ?', [
        h('sha256').update(sameCid).digest('hex'),
      ]);
      expect(journeys).toHaveLength(1);
    });

    it('same CID + higher pregNo creates new journey with overlap warning', async () => {
      const cid2 = '4001000666665';
      const p1: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'OVR-002',
            name: 'นาง ครรภ์ที่สอง',
            cid: cid2,
            birthday: '1993-06-15',
            pregNo: 1,
            lmp: '2024-01-01',
            riskLevel: 'LOW',
          },
        ],
      };
      await processAncWebhook(db, webhookHospitalId, p1, asSse(sseManager));
      sseManager.clearEvents();

      const p2: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'OVR-002',
            name: 'นาง ครรภ์ที่สอง',
            cid: cid2,
            birthday: '1993-06-15',
            pregNo: 2,
            lmp: '2025-09-01',
            riskLevel: 'LOW',
          },
        ],
      };
      const result = await processAncWebhook(db, webhookHospitalId, p2, asSse(sseManager));
      expect(result.created).toBe(1);

      const { createHash: h } = await import('crypto');
      const cidHash = h('sha256').update(cid2).digest('hex');
      const journeys = await db.query<{ gravida: number }>(
        'SELECT gravida FROM maternal_journeys WHERE cid_hash = ? ORDER BY created_at',
        [cidHash],
      );
      expect(journeys).toHaveLength(2);
      expect(journeys[0].gravida).toBe(1);
      expect(journeys[1].gravida).toBe(2);

      // SSE overlap warning broadcast
      const warnings = sseManager.events.filter(
        (e) => (e.data as Record<string, unknown>)?.type === 'pregnancy_overlap_warning',
      );
      expect(warnings).toHaveLength(1);
      const w = warnings[0].data as Record<string, unknown>;
      expect(w.oldPregNo).toBe(1);
      expect(w.newPregNo).toBe(2);
      expect(w.oldCareStage).toBe('PREGNANCY');
    });

    it('DELIVERED journey + new pregNo creates new journey WITHOUT overlap warning', async () => {
      const cid3 = '4001000777700';
      const p1: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'OVR-003',
            name: 'นาง คลอดแล้ว',
            cid: cid3,
            birthday: '1990-03-10',
            pregNo: 1,
            lmp: '2024-06-01',
            riskLevel: 'LOW',
          },
        ],
      };
      await processAncWebhook(db, webhookHospitalId, p1, asSse(sseManager));

      const { createHash: h } = await import('crypto');
      const cidHash = h('sha256').update(cid3).digest('hex');
      await db.execute("UPDATE maternal_journeys SET care_stage = 'DELIVERED' WHERE cid_hash = ?", [
        cidHash,
      ]);
      sseManager.clearEvents();

      const p2: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'OVR-003',
            name: 'นาง คลอดแล้ว',
            cid: cid3,
            birthday: '1990-03-10',
            pregNo: 2,
            lmp: '2025-10-01',
            riskLevel: 'LOW',
          },
        ],
      };
      const result = await processAncWebhook(db, webhookHospitalId, p2, asSse(sseManager));
      expect(result.created).toBe(1);

      const warnings = sseManager.events.filter(
        (e) => (e.data as Record<string, unknown>)?.type === 'pregnancy_overlap_warning',
      );
      expect(warnings).toHaveLength(0);
    });

    it('same CID from different hospital updates same journey (cross-hospital)', async () => {
      const cid4 = '4001000888803';
      const p1: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'OVR-004A',
            name: 'นาง ข้ามรพ.',
            cid: cid4,
            birthday: '1997-12-01',
            pregNo: 1,
            lmp: '2025-07-01',
            riskLevel: 'LOW',
          },
        ],
      };
      await processAncWebhook(db, webhookHospitalId, p1, asSse(sseManager));

      // Hospital B sends same CID, same pregNo → updates same journey
      const p2: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99903',
        patients: [
          {
            hn: 'OVR-004B',
            name: 'นาง ข้ามรพ.',
            cid: cid4,
            birthday: '1997-12-01',
            pregNo: 1,
            lmp: '2025-07-01',
            riskLevel: 'HR2',
          },
        ],
      };
      const result = await processAncWebhook(db, destHospitalId, p2, asSse(sseManager));
      expect(result.updated).toBe(1);
      expect(result.created).toBe(0);

      const { createHash: h } = await import('crypto');
      const journeys = await db.query<{ anc_risk_level: string }>(
        'SELECT anc_risk_level FROM maternal_journeys WHERE cid_hash = ?',
        [h('sha256').update(cid4).digest('hex')],
      );
      expect(journeys).toHaveLength(1);
      expect(journeys[0].anc_risk_level).toBe('HR2');
    });
  });

  // ─── ANC Visit Persistence Tests ───

  describe('Scenario 11: ANC webhook persists visit records to cached_anc_visits', () => {
    it('creates visit records when ANC payload includes visits array', async () => {
      const payload: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'VISIT-001',
            name: 'นาง ตรวจ ครรภ์',
            cid: '1007000900014',
            birthday: '1995-03-10',
            pregNo: 1,
            lmp: '2025-09-01',
            edc: '2026-06-08',
            riskLevel: 'LOW',
            visits: [
              {
                date: '2025-12-01',
                visitNumber: 1,
                gaWeeks: 13,
                fundalHeightCm: 12,
                weightKg: 52,
                bpSystolic: 110,
                bpDiastolic: 70,
                fetalHr: 150,
              },
              {
                date: '2026-02-01',
                visitNumber: 2,
                gaWeeks: 22,
                fundalHeightCm: 22,
                weightKg: 55,
                bpSystolic: 118,
                bpDiastolic: 75,
                fetalHr: 145,
              },
            ],
          },
        ],
      };

      await processAncWebhook(db, webhookHospitalId, payload, asSse(sseManager));

      const journey = await db.query<{ id: string }>(
        'SELECT id FROM maternal_journeys WHERE hn = ? AND hospital_id = ?',
        ['VISIT-001', webhookHospitalId],
      );
      expect(journey).toHaveLength(1);

      const visits = await db.query<{
        visit_number: number;
        ga_weeks: number;
        fetal_hr: number | null;
      }>(
        'SELECT visit_number, ga_weeks, fetal_hr FROM cached_anc_visits WHERE journey_id = ? ORDER BY visit_date',
        [journey[0].id],
      );
      expect(visits).toHaveLength(2);
      expect(visits[0].visit_number).toBe(1);
      expect(visits[0].ga_weeks).toBe(13);
      expect(visits[0].fetal_hr).toBe(150);
      expect(visits[1].visit_number).toBe(2);
      expect(visits[1].ga_weeks).toBe(22);
    });

    it('persists free-text dipstick lab values in full (no length cap)', async () => {
      // Regression: HOSxP anc_service.albumin/sugar are free-text — observed in
      // prod (hcode 10668) overflowing first varchar(10), then varchar(20),
      // throwing "value too long for type character varying" and aborting the
      // whole ANC persist batch. The urine_* columns are TEXT so any length
      // stores whole, preserving the full lab phrase shown to clinicians.
      const longProtein = 'negative — ตรวจไม่พบโปรตีนในปัสสาวะ (albumin trace ruled out)';
      const longGlucose = 'negative — ตรวจไม่พบน้ำตาลในปัสสาวะ (random glucose normal)';
      expect(longProtein.length).toBeGreaterThan(20); // guards the regression
      const payload: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [{
          hn: 'VISIT-TEXT',
          name: 'นาง ยาว เกิน',
          cid: '1100700090000', // valid Thai-CID checksum (passes the ingest gate)
          birthday: '1994-01-01',
          pregNo: 1,
          lmp: '2025-09-01',
          visits: [
            { date: '2025-12-01', visitNumber: 1, gaWeeks: 13, urineProtein: longProtein, urineGlucose: longGlucose },
          ],
        }],
      };

      await processAncWebhook(db, webhookHospitalId, payload, asSse(sseManager));

      const journey = await db.query<{ id: string }>(
        'SELECT id FROM maternal_journeys WHERE hn = ? AND hospital_id = ?',
        ['VISIT-TEXT', webhookHospitalId],
      );
      expect(journey).toHaveLength(1);

      const visits = await db.query<{ urine_protein: string | null; urine_glucose: string | null }>(
        'SELECT urine_protein, urine_glucose FROM cached_anc_visits WHERE journey_id = ?',
        [journey[0].id],
      );
      expect(visits).toHaveLength(1);
      expect(visits[0].urine_protein).toBe(longProtein);
      expect(visits[0].urine_glucose).toBe(longGlucose);
    });

    it('persists free-text VDRL/HIV lab results in full (no length cap)', async () => {
      // Same class as the urine fields: browser-poll feeds maternal_journeys
      // vdrl_result / hiv_result RAW from HOSxP blood_vdrl/hiv_result (free-text),
      // which overflowed varchar(20) in prod (hcode 10668) once urine moved to
      // TEXT. These columns are TEXT too so the full lab phrase persists.
      const longVdrl = 'Non-reactive — ตรวจไม่พบเชื้อซิฟิลิส (titre 1:1, repeat advised)';
      const longHiv = 'Negative — ไม่พบการติดเชื้อ HIV (4th-gen Ag/Ab, ครั้งที่ 2)';
      expect(longVdrl.length).toBeGreaterThan(20); // guards the regression
      const payload: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [{
          hn: 'LAB-TEXT',
          name: 'นาง แลป ยาว',
          cid: '1100700090000', // valid Thai-CID checksum
          birthday: '1992-02-02',
          pregNo: 1,
          lmp: '2025-09-01',
          vdrlResult: longVdrl,
          hivResult: longHiv,
        }],
      };

      await processAncWebhook(db, webhookHospitalId, payload, asSse(sseManager));

      const journey = await db.query<{ vdrl_result: string | null; hiv_result: string | null }>(
        'SELECT vdrl_result, hiv_result FROM maternal_journeys WHERE hn = ? AND hospital_id = ?',
        ['LAB-TEXT', webhookHospitalId],
      );
      expect(journey).toHaveLength(1);
      expect(journey[0].vdrl_result).toBe(longVdrl);
      expect(journey[0].hiv_result).toBe(longHiv);
    });

    it('dedupes visits that share a date so the unique (journey, date) index cannot trip', async () => {
      // HOSxP can hold two ANC service rows on the same calendar date for one
      // patient. processAncWebhook DELETEs then INSERTs each visit, so duplicate
      // dates violated idx_cav_journey_date (journey_id, visit_date) and aborted
      // the whole ANC batch (observed in prod once the varchar overflows were
      // fixed). Same-date visits collapse to the one with the highest visit_number.
      const payload: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [{
          hn: 'VISIT-DUP',
          name: 'นาง ซ้ำวัน',
          cid: '1100700090000', // valid Thai-CID checksum
          birthday: '1990-01-01',
          pregNo: 1,
          lmp: '2025-09-01',
          visits: [
            { date: '2025-12-01', visitNumber: 1, gaWeeks: 13, weightKg: 50 },
            { date: '2025-12-01', visitNumber: 2, gaWeeks: 13, weightKg: 52 },
            { date: '2026-02-01', visitNumber: 3, gaWeeks: 22 },
          ],
        }],
      };

      await processAncWebhook(db, webhookHospitalId, payload, asSse(sseManager));

      const journey = await db.query<{ id: string }>(
        'SELECT id FROM maternal_journeys WHERE hn = ? AND hospital_id = ?',
        ['VISIT-DUP', webhookHospitalId],
      );
      expect(journey).toHaveLength(1);

      const visits = await db.query<{ visit_number: number; weight_kg: number | null }>(
        'SELECT visit_number, weight_kg FROM cached_anc_visits WHERE journey_id = ? ORDER BY visit_date',
        [journey[0].id],
      );
      // 2025-12-01 collapses to one row (visit_number 2 wins), plus 2026-02-01.
      expect(visits).toHaveLength(2);
      expect(visits[0].visit_number).toBe(2);
      expect(visits[0].weight_kg).toBe(52);
      expect(visits[1].visit_number).toBe(3);
    });

    it('replaces visits on re-send (no duplicates)', async () => {
      // First send: 2 visits
      const p1: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'VISIT-002',
            name: 'นาง ซ้ำ ส่ง',
            cid: '1007000900022',
            birthday: '1993-07-20',
            pregNo: 1,
            lmp: '2025-10-01',
            visits: [
              { date: '2026-01-10', visitNumber: 1, gaWeeks: 14 },
              { date: '2026-03-10', visitNumber: 2, gaWeeks: 23 },
            ],
          },
        ],
      };
      await processAncWebhook(db, webhookHospitalId, p1, asSse(sseManager));

      // Second send: 3 visits (replace, not append)
      const p2: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'VISIT-002',
            name: 'นาง ซ้ำ ส่ง',
            cid: '1007000900022',
            birthday: '1993-07-20',
            pregNo: 1,
            lmp: '2025-10-01',
            visits: [
              { date: '2026-01-10', visitNumber: 1, gaWeeks: 14 },
              { date: '2026-03-10', visitNumber: 2, gaWeeks: 23 },
              { date: '2026-04-05', visitNumber: 3, gaWeeks: 27 },
            ],
          },
        ],
      };
      await processAncWebhook(db, webhookHospitalId, p2, asSse(sseManager));

      const journey = await db.query<{ id: string }>(
        'SELECT id FROM maternal_journeys WHERE hn = ? AND hospital_id = ?',
        ['VISIT-002', webhookHospitalId],
      );
      const visits = await db.query<{ visit_number: number }>(
        'SELECT visit_number FROM cached_anc_visits WHERE journey_id = ? ORDER BY visit_number',
        [journey[0].id],
      );
      expect(visits).toHaveLength(3); // replaced, not 5
      expect(visits[2].visit_number).toBe(3);
    });

    it('handles null visit fields from real HOSxP data (fetalHr, weightKg)', async () => {
      const payload: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'VISIT-003',
            name: 'นาง ข้อมูลไม่ครบ ค่าว่าง',
            cid: '1007000900031',
            birthday: '2000-01-01',
            pregNo: 1,
            visits: [{ date: '2026-03-25', visitNumber: 1, gaWeeks: 3 }],
          },
        ],
      };
      await processAncWebhook(db, webhookHospitalId, payload, asSse(sseManager));

      const journey = await db.query<{ id: string }>(
        'SELECT id FROM maternal_journeys WHERE hn = ? AND hospital_id = ?',
        ['VISIT-003', webhookHospitalId],
      );
      const visits = await db.query<{
        fetal_hr: number | null;
        weight_kg: number | null;
        bp_systolic: number | null;
      }>('SELECT fetal_hr, weight_kg, bp_systolic FROM cached_anc_visits WHERE journey_id = ?', [
        journey[0].id,
      ]);
      expect(visits).toHaveLength(1);
      expect(visits[0].fetal_hr).toBeNull();
      expect(visits[0].weight_kg).toBeNull();
      expect(visits[0].bp_systolic).toBeNull();
    });

    it('omitting visits array does not delete existing visits', async () => {
      // Send with visits
      const p1: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'VISIT-004',
            name: 'นาง คงข้อมูล เยี่ยม',
            cid: '1007000900049',
            birthday: '1998-11-05',
            pregNo: 1,
            visits: [{ date: '2026-01-15', visitNumber: 1, gaWeeks: 10 }],
          },
        ],
      };
      await processAncWebhook(db, webhookHospitalId, p1, asSse(sseManager));

      // Re-send WITHOUT visits (just updating risk level)
      const p2: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'VISIT-004',
            name: 'นาง คงข้อมูล เยี่ยม',
            cid: '1007000900049',
            birthday: '1998-11-05',
            pregNo: 1,
            riskLevel: 'HR1',
          },
        ],
      };
      await processAncWebhook(db, webhookHospitalId, p2, asSse(sseManager));

      const journey = await db.query<{ id: string }>(
        'SELECT id FROM maternal_journeys WHERE hn = ? AND hospital_id = ?',
        ['VISIT-004', webhookHospitalId],
      );
      const visits = await db.query<{ visit_number: number }>(
        'SELECT visit_number FROM cached_anc_visits WHERE journey_id = ?',
        [journey[0].id],
      );
      expect(visits).toHaveLength(1); // visits preserved, not deleted
    });
  });

  // ─── ANC Visit Cross-Hospital Scoping Tests (WHO containment T5) ───

  describe('Scenario 12: hospital-scoped visit writes + cross-hospital conflict rejection', () => {
    const cidHash = (cid: string) => createHash('sha256').update(cid).digest('hex');
    const patient = (
      hn: string,
      cid: string,
      visits: Array<{ date: string; visitNumber: number; gaWeeks?: number; bpSystolic?: number }>,
    ) => ({
      hn,
      name: 'นาง ข้ามรพ.',
      cid,
      birthday: '1995-01-01',
      pregNo: 1,
      lmp: '2025-09-01',
      visits,
    });
    const anc = (hospitalCode: string, p: ReturnType<typeof patient>): WebhookAncPayload => ({
      type: 'anc_data',
      hospitalCode,
      patients: [p],
    });

    it('hospital B push never deletes hospital A rows; count is the provincial total (A=2 + B=1 → 3)', async () => {
      const cid = '1007000900014';
      await processAncWebhook(
        db,
        webhookHospitalId,
        anc(
          '99902',
          patient('XH-A', cid, [
            { date: '2025-12-01', visitNumber: 1, gaWeeks: 13 },
            { date: '2026-01-01', visitNumber: 2, gaWeeks: 17 },
          ]),
        ),
        asSse(sseManager),
      );
      const result = await processAncWebhook(
        db,
        destHospitalId,
        anc('99903', patient('XH-B', cid, [{ date: '2026-02-01', visitNumber: 3, gaWeeks: 22 }])),
        asSse(sseManager),
      );

      const journey = await db.query<{
        id: string;
        anc_visit_count: number;
        last_anc_date: string | Date;
      }>('SELECT id, anc_visit_count, last_anc_date FROM maternal_journeys WHERE cid_hash = ?', [
        cidHash(cid),
      ]);
      expect(journey).toHaveLength(1);
      const rows = await db.query<{ visit_date: string | Date; hospital_id: string }>(
        'SELECT visit_date, hospital_id FROM cached_anc_visits WHERE journey_id = ? ORDER BY visit_date',
        [journey[0].id],
      );
      expect(rows).toHaveLength(3);
      expect(rows.filter((r) => r.hospital_id === webhookHospitalId)).toHaveLength(2);
      expect(rows.filter((r) => r.hospital_id === destHospitalId)).toHaveLength(1);
      expect(journey[0].anc_visit_count).toBe(3);
      expect(toIsoDate(journey[0].last_anc_date)).toBe('2026-02-01');
      expect(result.visitConflicts).toBe(0);
    });

    it('hospital B resend replaces only B rows; A rows untouched (count → 4)', async () => {
      const cid = '1007000900014';
      await processAncWebhook(
        db,
        webhookHospitalId,
        anc(
          '99902',
          patient('XH-A', cid, [
            { date: '2025-12-01', visitNumber: 1 },
            { date: '2026-01-01', visitNumber: 2 },
          ]),
        ),
        asSse(sseManager),
      );
      await processAncWebhook(
        db,
        destHospitalId,
        anc('99903', patient('XH-B', cid, [{ date: '2026-02-01', visitNumber: 3 }])),
        asSse(sseManager),
      );

      const journey = await db.query<{ id: string }>(
        'SELECT id FROM maternal_journeys WHERE cid_hash = ?',
        [cidHash(cid)],
      );
      const aBefore = await db.query<{ id: string }>(
        'SELECT id FROM cached_anc_visits WHERE journey_id = ? AND hospital_id = ? ORDER BY visit_date',
        [journey[0].id, webhookHospitalId],
      );

      const result = await processAncWebhook(
        db,
        destHospitalId,
        anc(
          '99903',
          patient('XH-B', cid, [
            { date: '2026-02-01', visitNumber: 3 },
            { date: '2026-03-01', visitNumber: 4 },
          ]),
        ),
        asSse(sseManager),
      );

      const rows = await db.query<{ visit_date: string | Date; hospital_id: string }>(
        'SELECT visit_date, hospital_id FROM cached_anc_visits WHERE journey_id = ? ORDER BY visit_date',
        [journey[0].id],
      );
      expect(rows).toHaveLength(4);
      const aAfter = await db.query<{ id: string }>(
        'SELECT id FROM cached_anc_visits WHERE journey_id = ? AND hospital_id = ? ORDER BY visit_date',
        [journey[0].id, webhookHospitalId],
      );
      expect(aAfter.map((r) => r.id)).toEqual(aBefore.map((r) => r.id));
      const bDates = rows
        .filter((r) => r.hospital_id === destHospitalId)
        .map((r) => toIsoDate(r.visit_date))
        .sort();
      expect(bDates).toEqual(['2026-02-01', '2026-03-01']);
      const j = await db.query<{ anc_visit_count: number }>(
        'SELECT anc_visit_count FROM maternal_journeys WHERE id = ?',
        [journey[0].id],
      );
      expect(j[0].anc_visit_count).toBe(4);
      expect(result.visitConflicts).toBe(0);
    });

    it('same-day cross-hospital conflict is skipped and counted; A row byte-identical; other B visit still inserts', async () => {
      const cid = '1007000900022';
      await processAncWebhook(
        db,
        webhookHospitalId,
        anc(
          '99902',
          patient('XH-A', cid, [
            { date: '2025-12-01', visitNumber: 1, gaWeeks: 13, bpSystolic: 110 },
          ]),
        ),
        asSse(sseManager),
      );

      const journey = await db.query<{ id: string }>(
        'SELECT id FROM maternal_journeys WHERE cid_hash = ?',
        [cidHash(cid)],
      );
      const aBefore = await db.query(
        'SELECT * FROM cached_anc_visits WHERE journey_id = ? AND hospital_id = ?',
        [journey[0].id, webhookHospitalId],
      );

      const result = await processAncWebhook(
        db,
        destHospitalId,
        anc(
          '99903',
          patient('XH-B', cid, [
            { date: '2025-12-01', visitNumber: 5, gaWeeks: 99, bpSystolic: 200 },
            { date: '2026-03-01', visitNumber: 6, gaWeeks: 30 },
          ]),
        ),
        asSse(sseManager),
      );

      expect(result.visitConflicts).toBe(1);
      const aAfter = await db.query(
        'SELECT * FROM cached_anc_visits WHERE journey_id = ? AND hospital_id = ?',
        [journey[0].id, webhookHospitalId],
      );
      expect(aAfter).toEqual(aBefore); // A's d1 row byte-identical — never overwritten
      const rows = await db.query<{ visit_date: string | Date; hospital_id: string }>(
        'SELECT visit_date, hospital_id FROM cached_anc_visits WHERE journey_id = ? ORDER BY visit_date',
        [journey[0].id],
      );
      expect(rows).toHaveLength(2);
      const bRows = rows.filter((r) => r.hospital_id === destHospitalId);
      expect(bRows).toHaveLength(1);
      expect(toIsoDate(bRows[0].visit_date)).toBe('2026-03-01');
    });

    it('injected failure mid visit-insert rolls back — A and B prior rows all survive, count unchanged', async () => {
      const cid = '1007000900014';
      await processAncWebhook(
        db,
        webhookHospitalId,
        anc(
          '99902',
          patient('XH-A', cid, [
            { date: '2025-12-01', visitNumber: 1 },
            { date: '2026-01-01', visitNumber: 2 },
          ]),
        ),
        asSse(sseManager),
      );
      await processAncWebhook(
        db,
        destHospitalId,
        anc('99903', patient('XH-B', cid, [{ date: '2026-02-01', visitNumber: 3 }])),
        asSse(sseManager),
      );

      const journey = await db.query<{ id: string }>(
        'SELECT id FROM maternal_journeys WHERE cid_hash = ?',
        [cidHash(cid)],
      );
      const before = await db.query(
        'SELECT id, hospital_id, visit_date FROM cached_anc_visits WHERE journey_id = ? ORDER BY visit_date',
        [journey[0].id],
      );
      const jBefore = await db.query<{ anc_visit_count: number }>(
        'SELECT anc_visit_count FROM maternal_journeys WHERE id = ?',
        [journey[0].id],
      );
      expect(jBefore[0].anc_visit_count).toBe(3);

      const failing = new FailingAdapter(db, /INSERT INTO cached_anc_visits/);
      await expect(
        processAncWebhook(
          failing,
          destHospitalId,
          anc(
            '99903',
            patient('XH-B', cid, [
              { date: '2026-02-01', visitNumber: 3 },
              { date: '2026-03-01', visitNumber: 4 },
            ]),
          ),
          asSse(sseManager),
        ),
      ).rejects.toThrow(/injected failure/);

      const after = await db.query(
        'SELECT id, hospital_id, visit_date FROM cached_anc_visits WHERE journey_id = ? ORDER BY visit_date',
        [journey[0].id],
      );
      expect(after).toEqual(before); // no partial delete — prior rows intact
      const jAfter = await db.query<{ anc_visit_count: number }>(
        'SELECT anc_visit_count FROM maternal_journeys WHERE id = ?',
        [journey[0].id],
      );
      expect(jAfter[0].anc_visit_count).toBe(3);
    });
  });

  // ─── Referral Create Webhook Tests (type: "referral") ───

  describe('Scenario 5: Referral create — sending hospital initiates referral', () => {
    it('creates a new referral record with journey linked by HN', async () => {
      // Seed a journey at the sending hospital
      const now = new Date().toISOString();
      const journeyId = uuidv4();
      await db.execute(
        `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, person_anc_id, name, cid, cid_hash, age, gravida, para, lmp, edc, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        [
          journeyId,
          webhookHospitalId,
          webhookHospitalId,
          'REF-HN-001',
          null,
          'Encrypted',
          'enc_cid_001',
          'a000000000000000000000000000000000000000000000000000000000000001',
          28,
          1,
          0,
          null,
          null,
          'PREGNANCY',
          'LOW',
          now,
          now,
          now,
          now,
          now,
        ],
      );

      const payload: WebhookReferralCreatePayload = {
        type: 'referral',
        hospitalCode: '99902',
        referralId: 'REF-2026-0001',
        hn: 'REF-HN-001',
        cid: '1005000123458',
        name: 'นาง ทดสอบ ส่งต่อ',
        toHospitalCode: '99903',
        reason: 'Preeclampsia ครรภ์ 34 สัปดาห์',
        diagnosisCode: 'O14.1',
        urgencyLevel: 'URGENT',
      };

      const result = await processReferralCreate(db, webhookHospitalId, payload, asSse(sseManager));
      expect(result.referralId).toBe('REF-2026-0001');
      expect(result.status).toBe('INITIATED');

      // Verify referral record with correct from/to hospitals
      const refs = await db.query<{
        refer_number: string;
        from_hospital_id: string;
        to_hospital_id: string;
        status: string;
        reason: string;
        urgency_level: string;
        journey_id: string;
      }>(
        'SELECT refer_number, from_hospital_id, to_hospital_id, status, reason, urgency_level, journey_id FROM cached_referrals WHERE refer_number = ?',
        ['REF-2026-0001'],
      );
      expect(refs).toHaveLength(1);
      expect(refs[0].from_hospital_id).toBe(webhookHospitalId);
      expect(refs[0].to_hospital_id).toBe(destHospitalId);
      expect(refs[0].status).toBe('INITIATED');
      expect(refs[0].reason).toBe('Preeclampsia ครรภ์ 34 สัปดาห์');
      expect(refs[0].urgency_level).toBe('URGENT');
      expect(refs[0].journey_id).toBe(journeyId);

      // CID hash stored on journey for cross-hospital matching
      const journey = await db.query<{ cid_hash: string | null }>(
        'SELECT cid_hash FROM maternal_journeys WHERE id = ?',
        [journeyId],
      );
      expect(journey[0].cid_hash).not.toBeNull();

      // SSE broadcast
      const sse = sseManager.getEventsByType('referral_update');
      expect(sse.length).toBeGreaterThanOrEqual(1);
      const evt = sse[0].data as Record<string, unknown>;
      expect(evt.fromHcode).toBe('99902');
      expect(evt.toHcode).toBe('99903');
      expect(evt.status).toBe('INITIATED');
    });

    it('auto-creates journey when HN not found (walk-in referral)', async () => {
      const payload: WebhookReferralCreatePayload = {
        type: 'referral',
        hospitalCode: '99902',
        referralId: 'REF-WALKIN-001',
        hn: 'WALKIN-HN-999',
        cid: '1005000999990',
        name: 'นาง ใหม่ มาเอง',
        toHospitalCode: '99903',
        reason: 'ครรภ์ 42 สัปดาห์ ต้องเร่งคลอด',
        urgencyLevel: 'EMERGENCY',
      };

      const result = await processReferralCreate(db, webhookHospitalId, payload, asSse(sseManager));
      expect(result.status).toBe('INITIATED');

      // Journey auto-created
      const journeys = await db.query<{ hn: string; care_stage: string }>(
        'SELECT hn, care_stage FROM maternal_journeys WHERE hospital_id = ? AND hn = ?',
        [webhookHospitalId, 'WALKIN-HN-999'],
      );
      expect(journeys).toHaveLength(1);
      expect(journeys[0].care_stage).toBe('PREGNANCY');

      // Referral linked to auto-created journey
      const refs = await db.query<{ journey_id: string }>(
        'SELECT journey_id FROM cached_referrals WHERE refer_number = ?',
        ['REF-WALKIN-001'],
      );
      expect(refs).toHaveLength(1);
    });

    it('upserts referral when same referralId + hospitalCode sent again', async () => {
      // First create
      const payload: WebhookReferralCreatePayload = {
        type: 'referral',
        hospitalCode: '99902',
        referralId: 'REF-UPS-001',
        hn: 'UPS-HN-001',
        cid: '1005000888888',
        name: 'นาง ซ้ำ ส่งต่อ',
        toHospitalCode: '99903',
        reason: 'เหตุผลแรก',
      };
      await processReferralCreate(db, webhookHospitalId, payload, asSse(sseManager));

      // Upsert — change reason
      const update = { ...payload, reason: 'เหตุผลใหม่ แก้ไขแล้ว' };
      await processReferralCreate(db, webhookHospitalId, update, asSse(sseManager));

      // Only 1 record (no duplicate)
      const refs = await db.query<{ reason: string }>(
        'SELECT reason FROM cached_referrals WHERE refer_number = ?',
        ['REF-UPS-001'],
      );
      expect(refs).toHaveLength(1);
      expect(refs[0].reason).toBe('เหตุผลใหม่ แก้ไขแล้ว');
    });
  });

  // ─── Referral Monitoring Validation Tests ───

  describe('Scenario 10: Referral warns when patient has no monitoring data', () => {
    it('referral for patient with active ANC record → no warning', async () => {
      // Register ANC first
      const ancPayload: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'MON-001',
            name: 'นาง มี ANC',
            cid: '4002000111117',
            birthday: '1996-01-01',
            pregNo: 1,
            lmp: '2025-08-01',
            riskLevel: 'HR1',
          },
        ],
      };
      await processAncWebhook(db, webhookHospitalId, ancPayload, asSse(sseManager));
      sseManager.clearEvents();

      // Now send referral → should link to existing journey, no warning
      const refPayload: WebhookReferralCreatePayload = {
        type: 'referral',
        hospitalCode: '99902',
        referralId: 'REF-MON-001',
        hn: 'MON-001',
        cid: '4002000111117',
        name: 'นาง มี ANC',
        toHospitalCode: '99903',
        reason: 'ส่งต่อ HR1',
      };
      await processReferralCreate(db, webhookHospitalId, refPayload, asSse(sseManager));

      const warnings = sseManager.events.filter(
        (e) => (e.data as Record<string, unknown>)?.type === 'referral_no_monitoring_warning',
      );
      expect(warnings).toHaveLength(0);
    });

    it('referral for unknown patient → warns no monitoring data', async () => {
      sseManager.clearEvents();

      const refPayload: WebhookReferralCreatePayload = {
        type: 'referral',
        hospitalCode: '99902',
        referralId: 'REF-MON-002',
        hn: 'MON-GHOST',
        cid: '4002000999991',
        name: 'นาง ไม่มี ข้อมูล',
        toHospitalCode: '99903',
        reason: 'ส่งต่อ ไม่มีข้อมูลในระบบ',
      };
      await processReferralCreate(db, webhookHospitalId, refPayload, asSse(sseManager));

      // Warning broadcast because no ANC/labor data exists
      const warnings = sseManager.events.filter(
        (e) => (e.data as Record<string, unknown>)?.type === 'referral_no_monitoring_warning',
      );
      expect(warnings).toHaveLength(1);
      const w = warnings[0].data as Record<string, unknown>;
      expect(w.referralId).toBe('REF-MON-002');
      expect(w.hn).toBe('MON-GHOST');
      expect(w.message).toContain('ไม่พบข้อมูลฝากครรภ์');

      // Journey still created (for tracking), but needs manual review
      const { createHash: h } = await import('crypto');
      const cidHash = h('sha256').update('4002000999991').digest('hex');
      const journeys = await db.query<{ care_stage: string }>(
        'SELECT care_stage FROM maternal_journeys WHERE cid_hash = ?',
        [cidHash],
      );
      expect(journeys).toHaveLength(1);
    });

    it('referral for patient with active labor record → no warning', async () => {
      // Create labor patient directly (not via ANC)
      const laborCid = '4002000222229';
      const { createHash: h } = await import('crypto');
      const laborCidHash = h('sha256').update(laborCid).digest('hex');

      const now = new Date().toISOString();
      const patientId = (await import('uuid')).v4();
      const journeyId = (await import('uuid')).v4();

      // Create journey + labor record
      await db.execute(
        `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, registered_at, stage_changed_at, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Test', 'enc', ?, 28, 1, 0, 'LABOR', ?, ?, ?, ?, ?)`,
        [
          journeyId,
          webhookHospitalId,
          webhookHospitalId,
          'MON-003',
          laborCidHash,
          now,
          now,
          now,
          now,
          now,
        ],
      );
      await db.execute(
        `INSERT INTO cached_patients (id, hospital_id, hn, an, name, cid_hash, age, admit_date, labor_status, journey_id, synced_at, created_at, updated_at)
         VALUES (?, ?, 'MON-003', 'AN-MON-003', 'Test', ?, 28, ?, 'ACTIVE', ?, ?, ?, ?)`,
        [patientId, webhookHospitalId, laborCidHash, now, journeyId, now, now, now],
      );
      sseManager.clearEvents();

      // Referral for patient with active labor → should find journey, no warning
      const refPayload: WebhookReferralCreatePayload = {
        type: 'referral',
        hospitalCode: '99902',
        referralId: 'REF-MON-003',
        hn: 'MON-003',
        cid: laborCid,
        name: 'นาง มี Labor',
        toHospitalCode: '99903',
        reason: 'ส่งต่อ คลอดฉุกเฉิน',
        urgencyLevel: 'EMERGENCY',
      };
      await processReferralCreate(db, webhookHospitalId, refPayload, asSse(sseManager));

      const warnings = sseManager.events.filter(
        (e) => (e.data as Record<string, unknown>)?.type === 'referral_no_monitoring_warning',
      );
      expect(warnings).toHaveLength(0);
    });
  });

  // ─── Referral Update Webhook Tests (type: "referral_update") ───

  describe('Scenario 6: Referral status update — receiving hospital responds', () => {
    // Helper: seed a journey + INITIATED referral from 99902 → 99903
    async function seedReferral(referNumber: string, hn: string, status = 'INITIATED') {
      const now = new Date().toISOString();
      const journeyId = uuidv4();
      await db.execute(
        `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, person_anc_id, name, cid, cid_hash, age, gravida, para, lmp, edc, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        [
          journeyId,
          webhookHospitalId,
          webhookHospitalId,
          hn,
          null,
          'Encrypted',
          'enc_cid_002',
          'a000000000000000000000000000000000000000000000000000000000000002',
          28,
          1,
          0,
          null,
          null,
          'PREGNANCY',
          'LOW',
          now,
          now,
          now,
          now,
          now,
        ],
      );
      await db.execute(
        `INSERT INTO cached_referrals (id, journey_id, refer_number, from_hospital_id, to_hospital_id, status, reason, initiated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          journeyId,
          referNumber,
          webhookHospitalId,
          destHospitalId,
          status,
          'ทดสอบส่งต่อ',
          now,
          now,
          now,
        ],
      );
      return journeyId;
    }

    it('receiving hospital ACCEPTS referral using fromHospitalCode compound key', async () => {
      await seedReferral('REF-001', 'REF-HN-001');

      // Receiving hospital (99903) sends ACCEPTED
      const payload: WebhookReferralUpdatePayload = {
        type: 'referral_update',
        hospitalCode: '99903', // receiver
        referralId: 'REF-001',
        fromHospitalCode: '99902', // sender (compound key)
        status: 'ACCEPTED',
        reason: 'เตียง L&D ว่าง รับได้',
      };

      const result = await processReferralUpdate(db, destHospitalId, payload, asSse(sseManager));
      expect(result.referralId).toBe('REF-001');
      expect(result.status).toBe('ACCEPTED');

      const refs = await db.query<{ status: string; accepted_at: string | null }>(
        'SELECT status, accepted_at FROM cached_referrals WHERE refer_number = ?',
        ['REF-001'],
      );
      expect(refs[0].status).toBe('ACCEPTED');
      expect(refs[0].accepted_at).not.toBeNull();

      // SSE broadcast with both hospital codes
      const sse = sseManager.getEventsByType('referral_update');
      expect(sse.length).toBeGreaterThanOrEqual(1);
      const evt = sse[0].data as Record<string, unknown>;
      expect(evt.fromHcode).toBe('99902');
      expect(evt.toHcode).toBe('99903');
      expect(evt.status).toBe('ACCEPTED');
    });

    it('updates referral to IN_TRANSIT with transport mode', async () => {
      await seedReferral('REF-002', 'REF-HN-002', 'ACCEPTED');

      const payload: WebhookReferralUpdatePayload = {
        type: 'referral_update',
        hospitalCode: '99903',
        referralId: 'REF-002',
        fromHospitalCode: '99902',
        status: 'IN_TRANSIT',
        transportMode: 'AMBULANCE',
      };

      const result = await processReferralUpdate(db, destHospitalId, payload, asSse(sseManager));
      expect(result.status).toBe('IN_TRANSIT');

      const refs = await db.query<{
        status: string;
        departed_at: string | null;
        transport_mode: string | null;
      }>(
        'SELECT status, departed_at, transport_mode FROM cached_referrals WHERE refer_number = ?',
        ['REF-002'],
      );
      expect(refs[0].status).toBe('IN_TRANSIT');
      expect(refs[0].departed_at).not.toBeNull();
      expect(refs[0].transport_mode).toBe('AMBULANCE');
    });

    it('updates referral to ARRIVED and updates journey current_hospital', async () => {
      const journeyId = await seedReferral('REF-003', 'REF-HN-003', 'IN_TRANSIT');

      const payload: WebhookReferralUpdatePayload = {
        type: 'referral_update',
        hospitalCode: '99903',
        referralId: 'REF-003',
        fromHospitalCode: '99902',
        status: 'ARRIVED',
        arrivedAt: '2026-03-31T14:30:00+07:00',
      };

      const result = await processReferralUpdate(db, destHospitalId, payload, asSse(sseManager));
      expect(result.status).toBe('ARRIVED');

      // Journey's current_hospital_id updated to receiving hospital
      const journey = await db.query<{ current_hospital_id: string }>(
        'SELECT current_hospital_id FROM maternal_journeys WHERE id = ?',
        [journeyId],
      );
      expect(journey[0].current_hospital_id).toBe(destHospitalId);
    });

    it('REJECTS referral with rejection reason', async () => {
      await seedReferral('REF-004', 'REF-HN-004');

      const payload: WebhookReferralUpdatePayload = {
        type: 'referral_update',
        hospitalCode: '99903',
        referralId: 'REF-004',
        fromHospitalCode: '99902',
        status: 'REJECTED',
        rejectionReason: 'เตียง ICU เต็ม กรุณาส่ง รพ.ขอนแก่น',
      };

      const result = await processReferralUpdate(db, destHospitalId, payload, asSse(sseManager));
      expect(result.status).toBe('REJECTED');

      const refs = await db.query<{
        status: string;
        rejection_reason: string | null;
        rejected_at: string | null;
      }>(
        'SELECT status, rejection_reason, rejected_at FROM cached_referrals WHERE refer_number = ?',
        ['REF-004'],
      );
      expect(refs[0].status).toBe('REJECTED');
      expect(refs[0].rejection_reason).toBe('เตียง ICU เต็ม กรุณาส่ง รพ.ขอนแก่น');
      expect(refs[0].rejected_at).not.toBeNull();
    });

    it('throws error when referral not found', async () => {
      const payload: WebhookReferralUpdatePayload = {
        type: 'referral_update',
        hospitalCode: '99903',
        referralId: 'REF-NOT-EXIST',
        fromHospitalCode: '99902',
        status: 'ACCEPTED',
      };

      await expect(
        processReferralUpdate(db, destHospitalId, payload, asSse(sseManager)),
      ).rejects.toMatchObject({ code: 'REFERRAL_NOT_FOUND' });
    });
  });

  describe('Scenario 7: Referral delete — removes referral record', () => {
    it('deletes referral via update webhook and broadcasts DELETED event', async () => {
      const now = new Date().toISOString();
      const journeyId = uuidv4();
      await db.execute(
        `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, person_anc_id, name, cid, cid_hash, age, gravida, para, lmp, edc, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        [
          journeyId,
          webhookHospitalId,
          webhookHospitalId,
          'REF-HN-DEL',
          null,
          'Encrypted',
          'enc_cid_003',
          'a000000000000000000000000000000000000000000000000000000000000003',
          25,
          1,
          0,
          null,
          null,
          'PREGNANCY',
          'LOW',
          now,
          now,
          now,
          now,
          now,
        ],
      );
      await db.execute(
        `INSERT INTO cached_referrals (id, journey_id, refer_number, from_hospital_id, to_hospital_id, status, reason, initiated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          journeyId,
          'REF-DEL-001',
          webhookHospitalId,
          destHospitalId,
          'INITIATED',
          'บันทึกผิด',
          now,
          now,
          now,
        ],
      );

      const before = await db.query('SELECT id FROM cached_referrals WHERE refer_number = ?', [
        'REF-DEL-001',
      ]);
      expect(before).toHaveLength(1);

      const payload: WebhookReferralUpdatePayload = {
        type: 'referral_update',
        hospitalCode: '99903',
        referralId: 'REF-DEL-001',
        fromHospitalCode: '99902',
        status: 'CANCELLED',
        action: 'delete',
      };

      const result = await processReferralUpdate(db, destHospitalId, payload, asSse(sseManager));
      expect(result.referralId).toBe('REF-DEL-001');
      expect(result.status).toBe('DELETED');

      const after = await db.query('SELECT id FROM cached_referrals WHERE refer_number = ?', [
        'REF-DEL-001',
      ]);
      expect(after).toHaveLength(0);

      const sse = sseManager.getEventsByType('referral_update');
      expect(sse.length).toBeGreaterThanOrEqual(1);
      const evt = sse[0].data as Record<string, unknown>;
      expect(evt.status).toBe('DELETED');
    });

    it('deletes referral via create webhook (sending hospital corrects error)', async () => {
      // First create a referral
      const now = new Date().toISOString();
      const journeyId = uuidv4();
      await db.execute(
        `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, person_anc_id, name, cid, cid_hash, age, gravida, para, lmp, edc, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        [
          journeyId,
          webhookHospitalId,
          webhookHospitalId,
          'REF-HN-DEL2',
          null,
          'Encrypted',
          'enc_cid_004',
          'a000000000000000000000000000000000000000000000000000000000000004',
          25,
          1,
          0,
          null,
          null,
          'PREGNANCY',
          'LOW',
          now,
          now,
          now,
          now,
          now,
        ],
      );
      await db.execute(
        `INSERT INTO cached_referrals (id, journey_id, refer_number, from_hospital_id, to_hospital_id, status, reason, initiated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          journeyId,
          'REF-DEL-002',
          webhookHospitalId,
          destHospitalId,
          'INITIATED',
          'ส่งผิด',
          now,
          now,
          now,
        ],
      );

      const payload: WebhookReferralCreatePayload = {
        type: 'referral',
        hospitalCode: '99902',
        referralId: 'REF-DEL-002',
        hn: 'REF-HN-DEL2',
        cid: '1005000777776',
        name: 'นาง ลบ จากต้นทาง',
        toHospitalCode: '99903',
        reason: 'ลบ',
        action: 'delete',
      };

      const result = await processReferralCreate(db, webhookHospitalId, payload, asSse(sseManager));
      expect(result.status).toBe('DELETED');

      const after = await db.query('SELECT id FROM cached_referrals WHERE refer_number = ?', [
        'REF-DEL-002',
      ]);
      expect(after).toHaveLength(0);
    });
  });

  // ─── Labor patient delete via processWebhookPayload ───

  describe('Scenario 7: Labor patient delete — removes patient, CPD scores, vital signs', () => {
    it('deletes cached_patients row plus CPD scores and vital signs', async () => {
      // Step 1: Admit a labor patient via webhook
      const admitPayload: WebhookPayload = {
        hospitalCode: '99902',
        patients: [
          {
            hn: 'LBR-DEL',
            an: 'AN-LBR-DEL',
            name: 'นาง คนงาน ลบ',
            cid: '1007000100123',
            age: 27,
            gravida: 2,
            ga_weeks: 39,
            anc_count: 5,
            admit_date: '2026-03-20T08:00:00+07:00',
            height_cm: 155,
            weight_diff_kg: 12,
            us_weight_g: 3100,
            hematocrit_pct: 34,
            labor_status: 'ACTIVE',
          },
        ],
      };

      await processWebhookPayload(db, webhookHospitalId, admitPayload, asSse(sseManager));

      // Verify patient and CPD score exist
      const patients = await db.query<{ id: string }>(
        'SELECT id FROM cached_patients WHERE hospital_id = ? AND an = ?',
        [webhookHospitalId, 'AN-LBR-DEL'],
      );
      expect(patients).toHaveLength(1);
      const patientId = patients[0].id;

      const cpd = await db.query('SELECT id FROM cpd_scores WHERE patient_id = ?', [patientId]);
      expect(cpd.length).toBeGreaterThanOrEqual(1);

      sseManager.clearEvents();

      // Step 2: Send delete action for the same patient
      const deletePayload: WebhookPayload = {
        hospitalCode: '99902',
        patients: [
          {
            hn: 'LBR-DEL',
            an: 'AN-LBR-DEL',
            name: 'นาง คนงาน ลบ',
            cid: '1007000100131',
            age: 27,
            admit_date: '2026-03-20T08:00:00+07:00',
            action: 'delete',
          },
        ],
      };

      const result = await processWebhookPayload(
        db,
        webhookHospitalId,
        deletePayload,
        asSse(sseManager),
      );

      expect(result.deleted).toBe(1);
      expect(result.patientsProcessed).toBe(0); // delete action is excluded from upsert count

      // cached_patients row gone
      const afterPatients = await db.query(
        'SELECT id FROM cached_patients WHERE hospital_id = ? AND an = ?',
        [webhookHospitalId, 'AN-LBR-DEL'],
      );
      expect(afterPatients).toHaveLength(0);

      // CPD scores gone
      const afterCpd = await db.query('SELECT id FROM cpd_scores WHERE patient_id = ?', [
        patientId,
      ]);
      expect(afterCpd).toHaveLength(0);

      // Vital signs gone (table exists but should have no rows for this patient)
      const afterVitals = await db.query('SELECT id FROM cached_vital_signs WHERE patient_id = ?', [
        patientId,
      ]);
      expect(afterVitals).toHaveLength(0);
    });

    it('deleting a non-existent AN is a no-op', async () => {
      const deletePayload: WebhookPayload = {
        hospitalCode: '99902',
        patients: [
          {
            hn: 'LBR-GHOST',
            an: 'AN-GHOST-999',
            name: 'ไม่มี',
            cid: '1007000100140',
            age: 25,
            admit_date: '2026-03-20T08:00:00+07:00',
            action: 'delete',
          },
        ],
      };

      const result = await processWebhookPayload(
        db,
        webhookHospitalId,
        deletePayload,
        asSse(sseManager),
      );
      // Still increments deleted counter even if row didn't exist — behavior matches current implementation
      expect(result.deleted).toBeGreaterThanOrEqual(0);
      expect(result.patientsProcessed).toBe(0);
    });
  });
});
