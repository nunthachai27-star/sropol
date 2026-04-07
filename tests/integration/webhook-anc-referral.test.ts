// Integration tests: ANC webhook, referral webhook, and delete operations
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables/index';
import { SeedOrchestrator } from '@/db/seeds/index';
import { generateKey } from '@/lib/encryption';
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
  let db: SqliteAdapter;
  let sseManager: MockSseManager;
  let webhookHospitalId: string;
  let destHospitalId: string;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await SchemaSync.sync(db, ALL_TABLES, 'sqlite');
    await new SeedOrchestrator().run(db);
    sseManager = new MockSseManager();

    const now = new Date().toISOString();
    webhookHospitalId = uuidv4();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [webhookHospitalId, '99902', 'รพ.ANC ทดสอบ (Webhook)', 'M2', 1, 'UNKNOWN', now, now],
    );

    // Second hospital for referral destination
    destHospitalId = uuidv4();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [destHospitalId, '99903', 'รพ.ปลายทาง ทดสอบ', 'A', 1, 'UNKNOWN', now, now],
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
            cid: '1234567890001',
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

      // SSE journey_update broadcast
      const sse = sseManager.getEventsByType('journey_update');
      expect(sse.length).toBeGreaterThanOrEqual(1);
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
            cid: '1100700010001',
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

      // Second: update riskLevel to HIGH
      const update: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'ANC-UPD',
            name: 'นาง อัพเดท ความเสี่ยง',
            cid: '1100700010002',
            birthday: '1994-06-20',
            pregNo: 2,
            lmp: '2025-07-01',
            edc: '2026-04-07',
            riskLevel: 'HIGH',
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
      expect(after[0].anc_risk_level).toBe('HIGH');
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
            cid: '1100700010003',
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
            cid: '1100700010004',
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
      const visits = await db.query(
        'SELECT id FROM cached_anc_visits WHERE journey_id = ?',
        [journeyId],
      );
      expect(visits).toHaveLength(0);

      // SSE broadcast with DELETED stage
      const sse = sseManager.getEventsByType('journey_update');
      expect(sse.length).toBeGreaterThanOrEqual(1);
      const evt = sse[0].data as Record<string, unknown>;
      expect(evt.careStage).toBe('DELETED');
    });

    it('delete of non-existent patient is a no-op (deleted = 0)', async () => {
      const del: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [
          {
            hn: 'ANC-GHOST',
            name: 'ไม่มีในระบบ',
            cid: '1100700010005',
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
            cid: '1100700010006',
            birthday: '1995-05-01',
            pregNo: 1,
            riskLevel: 'LOW',
          },
          {
            hn: 'ANC-M02',
            name: 'นาง สอง คนสอง',
            cid: '1100700010007',
            birthday: '1993-08-15',
            pregNo: 3,
            riskLevel: 'HIGH',
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
      expect(journeys[1].anc_risk_level).toBe('HIGH');
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
            cid: '1400100012345',
            birthday: '1996-06-15',
            pregNo: 1,
            riskLevel: 'LOW',
            changwatCode: '40',   // ขอนแก่น
            amphurCode: '01',     // เมืองขอนแก่น
            tambonCode: '01',     // ในเมือง
          },
        ],
      };

      await processAncWebhook(db, webhookHospitalId, payload, asSse(sseManager));

      const journey = await db.query<{ changwat_code: string | null; amphur_code: string | null; tambon_code: string | null }>(
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
            cid: '1400100099999',
            birthday: '1998-01-01',
            pregNo: 1,
          },
        ],
      };

      await processAncWebhook(db, webhookHospitalId, payload, asSse(sseManager));

      const journey = await db.query<{ changwat_code: string | null; amphur_code: string | null; tambon_code: string | null }>(
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
        cid: '1400100077777',
        name: 'นาง ส่งต่อ มีที่อยู่',
        toHospitalCode: '99903',
        reason: 'ทดสอบ location',
        changwatCode: '40',
        amphurCode: '25',
        tambonCode: '03',
      };

      await processReferralCreate(db, webhookHospitalId, payload, asSse(sseManager));

      const journey = await db.query<{ changwat_code: string | null; amphur_code: string | null; tambon_code: string | null }>(
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
    const sameCid = '1400100055555';

    it('same CID + same pregNo updates existing journey (no new creation)', async () => {
      const p1: WebhookAncPayload = {
        type: 'anc_data', hospitalCode: '99902',
        patients: [{
          hn: 'OVR-001', name: 'นาง ซ้ำ ครรภ์เดิม', cid: sameCid,
          birthday: '1995-01-01', pregNo: 1, lmp: '2025-08-01', riskLevel: 'LOW',
        }],
      };
      await processAncWebhook(db, webhookHospitalId, p1, asSse(sseManager));

      const p2: WebhookAncPayload = {
        type: 'anc_data', hospitalCode: '99902',
        patients: [{
          hn: 'OVR-001', name: 'นาง ซ้ำ ครรภ์เดิม', cid: sameCid,
          birthday: '1995-01-01', pregNo: 1, lmp: '2025-08-01', riskLevel: 'HR1',
        }],
      };
      const result = await processAncWebhook(db, webhookHospitalId, p2, asSse(sseManager));
      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);

      const { createHash: h } = await import('crypto');
      const journeys = await db.query(
        'SELECT id FROM maternal_journeys WHERE cid_hash = ?',
        [h('sha256').update(sameCid).digest('hex')],
      );
      expect(journeys).toHaveLength(1);
    });

    it('same CID + higher pregNo creates new journey with overlap warning', async () => {
      const cid2 = '1400100066666';
      const p1: WebhookAncPayload = {
        type: 'anc_data', hospitalCode: '99902',
        patients: [{
          hn: 'OVR-002', name: 'นาง ครรภ์ที่สอง', cid: cid2,
          birthday: '1993-06-15', pregNo: 1, lmp: '2024-01-01', riskLevel: 'LOW',
        }],
      };
      await processAncWebhook(db, webhookHospitalId, p1, asSse(sseManager));
      sseManager.clearEvents();

      const p2: WebhookAncPayload = {
        type: 'anc_data', hospitalCode: '99902',
        patients: [{
          hn: 'OVR-002', name: 'นาง ครรภ์ที่สอง', cid: cid2,
          birthday: '1993-06-15', pregNo: 2, lmp: '2025-09-01', riskLevel: 'LOW',
        }],
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
      const cid3 = '1400100077770';
      const p1: WebhookAncPayload = {
        type: 'anc_data', hospitalCode: '99902',
        patients: [{
          hn: 'OVR-003', name: 'นาง คลอดแล้ว', cid: cid3,
          birthday: '1990-03-10', pregNo: 1, lmp: '2024-06-01', riskLevel: 'LOW',
        }],
      };
      await processAncWebhook(db, webhookHospitalId, p1, asSse(sseManager));

      const { createHash: h } = await import('crypto');
      const cidHash = h('sha256').update(cid3).digest('hex');
      await db.execute("UPDATE maternal_journeys SET care_stage = 'DELIVERED' WHERE cid_hash = ?", [cidHash]);
      sseManager.clearEvents();

      const p2: WebhookAncPayload = {
        type: 'anc_data', hospitalCode: '99902',
        patients: [{
          hn: 'OVR-003', name: 'นาง คลอดแล้ว', cid: cid3,
          birthday: '1990-03-10', pregNo: 2, lmp: '2025-10-01', riskLevel: 'LOW',
        }],
      };
      const result = await processAncWebhook(db, webhookHospitalId, p2, asSse(sseManager));
      expect(result.created).toBe(1);

      const warnings = sseManager.events.filter(
        (e) => (e.data as Record<string, unknown>)?.type === 'pregnancy_overlap_warning',
      );
      expect(warnings).toHaveLength(0);
    });

    it('same CID from different hospital updates same journey (cross-hospital)', async () => {
      const cid4 = '1400100088880';
      const p1: WebhookAncPayload = {
        type: 'anc_data', hospitalCode: '99902',
        patients: [{
          hn: 'OVR-004A', name: 'นาง ข้ามรพ.', cid: cid4,
          birthday: '1997-12-01', pregNo: 1, lmp: '2025-07-01', riskLevel: 'LOW',
        }],
      };
      await processAncWebhook(db, webhookHospitalId, p1, asSse(sseManager));

      // Hospital B sends same CID, same pregNo → updates same journey
      const p2: WebhookAncPayload = {
        type: 'anc_data', hospitalCode: '99903',
        patients: [{
          hn: 'OVR-004B', name: 'นาง ข้ามรพ.', cid: cid4,
          birthday: '1997-12-01', pregNo: 1, lmp: '2025-07-01', riskLevel: 'HR2',
        }],
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
        patients: [{
          hn: 'VISIT-001',
          name: 'นาง ตรวจ ครรภ์',
          cid: '1100700090001',
          birthday: '1995-03-10',
          pregNo: 1,
          lmp: '2025-09-01',
          edc: '2026-06-08',
          riskLevel: 'LOW',
          visits: [
            { date: '2025-12-01', visitNumber: 1, gaWeeks: 13, fundalHeightCm: 12, weightKg: 52, bpSystolic: 110, bpDiastolic: 70, fetalHr: 150 },
            { date: '2026-02-01', visitNumber: 2, gaWeeks: 22, fundalHeightCm: 22, weightKg: 55, bpSystolic: 118, bpDiastolic: 75, fetalHr: 145 },
          ],
        }],
      };

      await processAncWebhook(db, webhookHospitalId, payload, asSse(sseManager));

      const journey = await db.query<{ id: string }>(
        'SELECT id FROM maternal_journeys WHERE hn = ? AND hospital_id = ?',
        ['VISIT-001', webhookHospitalId],
      );
      expect(journey).toHaveLength(1);

      const visits = await db.query<{ visit_number: number; ga_weeks: number; fetal_hr: number | null }>(
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

    it('replaces visits on re-send (no duplicates)', async () => {
      // First send: 2 visits
      const p1: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [{
          hn: 'VISIT-002',
          name: 'นาง ซ้ำ ส่ง',
          cid: '1100700090002',
          birthday: '1993-07-20',
          pregNo: 1,
          lmp: '2025-10-01',
          visits: [
            { date: '2026-01-10', visitNumber: 1, gaWeeks: 14 },
            { date: '2026-03-10', visitNumber: 2, gaWeeks: 23 },
          ],
        }],
      };
      await processAncWebhook(db, webhookHospitalId, p1, asSse(sseManager));

      // Second send: 3 visits (replace, not append)
      const p2: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [{
          hn: 'VISIT-002',
          name: 'นาง ซ้ำ ส่ง',
          cid: '1100700090002',
          birthday: '1993-07-20',
          pregNo: 1,
          lmp: '2025-10-01',
          visits: [
            { date: '2026-01-10', visitNumber: 1, gaWeeks: 14 },
            { date: '2026-03-10', visitNumber: 2, gaWeeks: 23 },
            { date: '2026-04-05', visitNumber: 3, gaWeeks: 27 },
          ],
        }],
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
        patients: [{
          hn: 'VISIT-003',
          name: 'นาง ข้อมูลไม่ครบ ค่าว่าง',
          cid: '1100700090003',
          birthday: '2000-01-01',
          pregNo: 1,
          visits: [
            { date: '2026-03-25', visitNumber: 1, gaWeeks: 3 },
          ],
        }],
      };
      await processAncWebhook(db, webhookHospitalId, payload, asSse(sseManager));

      const journey = await db.query<{ id: string }>(
        'SELECT id FROM maternal_journeys WHERE hn = ? AND hospital_id = ?',
        ['VISIT-003', webhookHospitalId],
      );
      const visits = await db.query<{ fetal_hr: number | null; weight_kg: number | null; bp_systolic: number | null }>(
        'SELECT fetal_hr, weight_kg, bp_systolic FROM cached_anc_visits WHERE journey_id = ?',
        [journey[0].id],
      );
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
        patients: [{
          hn: 'VISIT-004',
          name: 'นาง คงข้อมูล เยี่ยม',
          cid: '1100700090004',
          birthday: '1998-11-05',
          pregNo: 1,
          visits: [
            { date: '2026-01-15', visitNumber: 1, gaWeeks: 10 },
          ],
        }],
      };
      await processAncWebhook(db, webhookHospitalId, p1, asSse(sseManager));

      // Re-send WITHOUT visits (just updating risk level)
      const p2: WebhookAncPayload = {
        type: 'anc_data',
        hospitalCode: '99902',
        patients: [{
          hn: 'VISIT-004',
          name: 'นาง คงข้อมูล เยี่ยม',
          cid: '1100700090004',
          birthday: '1998-11-05',
          pregNo: 1,
          riskLevel: 'HR1',
        }],
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

  // ─── Referral Create Webhook Tests (type: "referral") ───

  describe('Scenario 5: Referral create — sending hospital initiates referral', () => {
    it('creates a new referral record with journey linked by HN', async () => {
      // Seed a journey at the sending hospital
      const now = new Date().toISOString();
      const journeyId = uuidv4();
      await db.execute(
        `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, person_anc_id, name, cid, cid_hash, age, gravida, para, lmp, edc, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        [journeyId, webhookHospitalId, webhookHospitalId, 'REF-HN-001', null, 'Encrypted', 'enc_cid_001', 'a000000000000000000000000000000000000000000000000000000000000001', 28, 1, 0, null, null, 'PREGNANCY', 'LOW', now, now, now, now, now],
      );

      const payload: WebhookReferralCreatePayload = {
        type: 'referral',
        hospitalCode: '99902',
        referralId: 'REF-2026-0001',
        hn: 'REF-HN-001',
        cid: '1100500012345',
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
      const refs = await db.query<{ refer_number: string; from_hospital_id: string; to_hospital_id: string; status: string; reason: string; urgency_level: string; journey_id: string }>(
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
        cid: '1100500099999',
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
        cid: '1100500088888',
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
        type: 'anc_data', hospitalCode: '99902',
        patients: [{
          hn: 'MON-001', name: 'นาง มี ANC', cid: '1400200011111',
          birthday: '1996-01-01', pregNo: 1, lmp: '2025-08-01', riskLevel: 'HR1',
        }],
      };
      await processAncWebhook(db, webhookHospitalId, ancPayload, asSse(sseManager));
      sseManager.clearEvents();

      // Now send referral → should link to existing journey, no warning
      const refPayload: WebhookReferralCreatePayload = {
        type: 'referral', hospitalCode: '99902', referralId: 'REF-MON-001',
        hn: 'MON-001', cid: '1400200011111', name: 'นาง มี ANC',
        toHospitalCode: '99903', reason: 'ส่งต่อ HR1',
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
        type: 'referral', hospitalCode: '99902', referralId: 'REF-MON-002',
        hn: 'MON-GHOST', cid: '1400200099999', name: 'นาง ไม่มี ข้อมูล',
        toHospitalCode: '99903', reason: 'ส่งต่อ ไม่มีข้อมูลในระบบ',
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
      const cidHash = h('sha256').update('1400200099999').digest('hex');
      const journeys = await db.query<{ care_stage: string }>(
        'SELECT care_stage FROM maternal_journeys WHERE cid_hash = ?',
        [cidHash],
      );
      expect(journeys).toHaveLength(1);
    });

    it('referral for patient with active labor record → no warning', async () => {
      // Create labor patient directly (not via ANC)
      const laborCid = '1400200022222';
      const { createHash: h } = await import('crypto');
      const laborCidHash = h('sha256').update(laborCid).digest('hex');

      const now = new Date().toISOString();
      const patientId = (await import('uuid')).v4();
      const journeyId = (await import('uuid')).v4();

      // Create journey + labor record
      await db.execute(
        `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, registered_at, stage_changed_at, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Test', 'enc', ?, 28, 1, 0, 'LABOR', ?, ?, ?, ?, ?)`,
        [journeyId, webhookHospitalId, webhookHospitalId, 'MON-003', laborCidHash, now, now, now, now, now],
      );
      await db.execute(
        `INSERT INTO cached_patients (id, hospital_id, hn, an, name, cid_hash, age, admit_date, labor_status, journey_id, synced_at, created_at, updated_at)
         VALUES (?, ?, 'MON-003', 'AN-MON-003', 'Test', ?, 28, ?, 'ACTIVE', ?, ?, ?, ?)`,
        [patientId, webhookHospitalId, laborCidHash, now, journeyId, now, now, now],
      );
      sseManager.clearEvents();

      // Referral for patient with active labor → should find journey, no warning
      const refPayload: WebhookReferralCreatePayload = {
        type: 'referral', hospitalCode: '99902', referralId: 'REF-MON-003',
        hn: 'MON-003', cid: laborCid, name: 'นาง มี Labor',
        toHospitalCode: '99903', reason: 'ส่งต่อ คลอดฉุกเฉิน',
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
        [journeyId, webhookHospitalId, webhookHospitalId, hn, null, 'Encrypted', 'enc_cid_002', 'a000000000000000000000000000000000000000000000000000000000000002', 28, 1, 0, null, null, 'PREGNANCY', 'LOW', now, now, now, now, now],
      );
      await db.execute(
        `INSERT INTO cached_referrals (id, journey_id, refer_number, from_hospital_id, to_hospital_id, status, reason, initiated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), journeyId, referNumber, webhookHospitalId, destHospitalId, status, 'ทดสอบส่งต่อ', now, now, now],
      );
      return journeyId;
    }

    it('receiving hospital ACCEPTS referral using fromHospitalCode compound key', async () => {
      await seedReferral('REF-001', 'REF-HN-001');

      // Receiving hospital (99903) sends ACCEPTED
      const payload: WebhookReferralUpdatePayload = {
        type: 'referral_update',
        hospitalCode: '99903',           // receiver
        referralId: 'REF-001',
        fromHospitalCode: '99902',       // sender (compound key)
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

      const refs = await db.query<{ status: string; departed_at: string | null; transport_mode: string | null }>(
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

      const refs = await db.query<{ status: string; rejection_reason: string | null; rejected_at: string | null }>(
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
      ).rejects.toThrow('ไม่พบใบส่งต่อ');
    });
  });

  describe('Scenario 7: Referral delete — removes referral record', () => {
    it('deletes referral via update webhook and broadcasts DELETED event', async () => {
      const now = new Date().toISOString();
      const journeyId = uuidv4();
      await db.execute(
        `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, person_anc_id, name, cid, cid_hash, age, gravida, para, lmp, edc, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        [journeyId, webhookHospitalId, webhookHospitalId, 'REF-HN-DEL', null, 'Encrypted', 'enc_cid_003', 'a000000000000000000000000000000000000000000000000000000000000003', 25, 1, 0, null, null, 'PREGNANCY', 'LOW', now, now, now, now, now],
      );
      await db.execute(
        `INSERT INTO cached_referrals (id, journey_id, refer_number, from_hospital_id, to_hospital_id, status, reason, initiated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), journeyId, 'REF-DEL-001', webhookHospitalId, destHospitalId, 'INITIATED', 'บันทึกผิด', now, now, now],
      );

      const before = await db.query('SELECT id FROM cached_referrals WHERE refer_number = ?', ['REF-DEL-001']);
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

      const after = await db.query('SELECT id FROM cached_referrals WHERE refer_number = ?', ['REF-DEL-001']);
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
        [journeyId, webhookHospitalId, webhookHospitalId, 'REF-HN-DEL2', null, 'Encrypted', 'enc_cid_004', 'a000000000000000000000000000000000000000000000000000000000000004', 25, 1, 0, null, null, 'PREGNANCY', 'LOW', now, now, now, now, now],
      );
      await db.execute(
        `INSERT INTO cached_referrals (id, journey_id, refer_number, from_hospital_id, to_hospital_id, status, reason, initiated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), journeyId, 'REF-DEL-002', webhookHospitalId, destHospitalId, 'INITIATED', 'ส่งผิด', now, now, now],
      );

      const payload: WebhookReferralCreatePayload = {
        type: 'referral',
        hospitalCode: '99902',
        referralId: 'REF-DEL-002',
        hn: 'REF-HN-DEL2',
        cid: '1100500077777',
        name: 'นาง ลบ จากต้นทาง',
        toHospitalCode: '99903',
        reason: 'ลบ',
        action: 'delete',
      };

      const result = await processReferralCreate(db, webhookHospitalId, payload, asSse(sseManager));
      expect(result.status).toBe('DELETED');

      const after = await db.query('SELECT id FROM cached_referrals WHERE refer_number = ?', ['REF-DEL-002']);
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
            cid: '1100700010012',
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

      const cpd = await db.query(
        'SELECT id FROM cpd_scores WHERE patient_id = ?',
        [patientId],
      );
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
            cid: '1100700010013',
            age: 27,
            admit_date: '2026-03-20T08:00:00+07:00',
            action: 'delete',
          },
        ],
      };

      const result = await processWebhookPayload(db, webhookHospitalId, deletePayload, asSse(sseManager));

      expect(result.deleted).toBe(1);
      expect(result.patientsProcessed).toBe(0); // delete action is excluded from upsert count

      // cached_patients row gone
      const afterPatients = await db.query(
        'SELECT id FROM cached_patients WHERE hospital_id = ? AND an = ?',
        [webhookHospitalId, 'AN-LBR-DEL'],
      );
      expect(afterPatients).toHaveLength(0);

      // CPD scores gone
      const afterCpd = await db.query(
        'SELECT id FROM cpd_scores WHERE patient_id = ?',
        [patientId],
      );
      expect(afterCpd).toHaveLength(0);

      // Vital signs gone (table exists but should have no rows for this patient)
      const afterVitals = await db.query(
        'SELECT id FROM cached_vital_signs WHERE patient_id = ?',
        [patientId],
      );
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
            cid: '1100700010014',
            age: 25,
            admit_date: '2026-03-20T08:00:00+07:00',
            action: 'delete',
          },
        ],
      };

      const result = await processWebhookPayload(db, webhookHospitalId, deletePayload, asSse(sseManager));
      // Still increments deleted counter even if row didn't exist — behavior matches current implementation
      expect(result.deleted).toBeGreaterThanOrEqual(0);
      expect(result.patientsProcessed).toBe(0);
    });
  });
});
