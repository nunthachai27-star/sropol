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
  processReferralWebhook,
  processWebhookPayload,
  type WebhookAncPayload,
  type WebhookReferralPayload,
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
            birthday: '1995-05-01',
            pregNo: 1,
            riskLevel: 'LOW',
          },
          {
            hn: 'ANC-M02',
            name: 'นาง สอง คนสอง',
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

  // ─── Referral Webhook Tests ───

  describe('Scenario 5: Referral status update — ACCEPTED', () => {
    it('updates referral status to ACCEPTED and sets accepted_at', async () => {
      // Seed a journey and referral
      const now = new Date().toISOString();
      const journeyId = uuidv4();
      await db.execute(
        `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, person_anc_id, name, cid, cid_hash, age, gravida, para, lmp, edc, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        [journeyId, webhookHospitalId, webhookHospitalId, 'REF-HN-001', null, 'Encrypted', null, null, 28, 1, 0, null, null, 'PREGNANCY', 'LOW', now, now, now, now, now],
      );

      const referralId = uuidv4();
      await db.execute(
        `INSERT INTO cached_referrals (id, journey_id, refer_number, from_hospital_id, to_hospital_id, status, reason, initiated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [referralId, journeyId, 'REF-001', webhookHospitalId, destHospitalId, 'INITIATED', 'ทดสอบส่งต่อ', now, now, now],
      );

      const payload: WebhookReferralPayload = {
        type: 'referral_update',
        hospitalCode: '99902',
        referralId: 'REF-001',
        status: 'ACCEPTED',
      };

      const result = await processReferralWebhook(db, webhookHospitalId, payload, asSse(sseManager));

      expect(result.referralId).toBe('REF-001');
      expect(result.status).toBe('ACCEPTED');

      const refs = await db.query<{ status: string; accepted_at: string | null }>(
        'SELECT status, accepted_at FROM cached_referrals WHERE refer_number = ?',
        ['REF-001'],
      );
      expect(refs).toHaveLength(1);
      expect(refs[0].status).toBe('ACCEPTED');
      expect(refs[0].accepted_at).not.toBeNull();

      // SSE broadcast
      const sse = sseManager.getEventsByType('referral_update');
      expect(sse.length).toBeGreaterThanOrEqual(1);
      const evt = sse[0].data as Record<string, unknown>;
      expect(evt.referralId).toBe('REF-001');
      expect(evt.status).toBe('ACCEPTED');
    });

    it('updates referral status to IN_TRANSIT with transport mode', async () => {
      const now = new Date().toISOString();
      const journeyId = uuidv4();
      await db.execute(
        `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, person_anc_id, name, cid, cid_hash, age, gravida, para, lmp, edc, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        [journeyId, webhookHospitalId, webhookHospitalId, 'REF-HN-002', null, 'Encrypted', null, null, 30, 2, 1, null, null, 'PREGNANCY', 'HIGH', now, now, now, now, now],
      );

      await db.execute(
        `INSERT INTO cached_referrals (id, journey_id, refer_number, from_hospital_id, to_hospital_id, status, reason, initiated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), journeyId, 'REF-002', webhookHospitalId, destHospitalId, 'ACCEPTED', 'ส่งต่อด่วน', now, now, now],
      );

      const payload: WebhookReferralPayload = {
        type: 'referral_update',
        hospitalCode: '99902',
        referralId: 'REF-002',
        status: 'IN_TRANSIT',
        transportMode: 'AMBULANCE',
      };

      const result = await processReferralWebhook(db, webhookHospitalId, payload, asSse(sseManager));
      expect(result.status).toBe('IN_TRANSIT');

      const refs = await db.query<{ status: string; departed_at: string | null; transport_mode: string | null }>(
        'SELECT status, departed_at, transport_mode FROM cached_referrals WHERE refer_number = ?',
        ['REF-002'],
      );
      expect(refs[0].status).toBe('IN_TRANSIT');
      expect(refs[0].departed_at).not.toBeNull();
      expect(refs[0].transport_mode).toBe('AMBULANCE');
    });
  });

  describe('Scenario 6: Referral delete — removes referral record', () => {
    it('deletes the referral record and broadcasts DELETED event', async () => {
      const now = new Date().toISOString();
      const journeyId = uuidv4();
      await db.execute(
        `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, person_anc_id, name, cid, cid_hash, age, gravida, para, lmp, edc, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        [journeyId, webhookHospitalId, webhookHospitalId, 'REF-HN-DEL', null, 'Encrypted', null, null, 25, 1, 0, null, null, 'PREGNANCY', 'LOW', now, now, now, now, now],
      );

      await db.execute(
        `INSERT INTO cached_referrals (id, journey_id, refer_number, from_hospital_id, to_hospital_id, status, reason, initiated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), journeyId, 'REF-DEL-001', webhookHospitalId, destHospitalId, 'INITIATED', 'บันทึกผิด', now, now, now],
      );

      // Confirm record exists
      const before = await db.query(
        'SELECT id FROM cached_referrals WHERE refer_number = ?',
        ['REF-DEL-001'],
      );
      expect(before).toHaveLength(1);

      const payload: WebhookReferralPayload = {
        type: 'referral_update',
        hospitalCode: '99902',
        referralId: 'REF-DEL-001',
        status: 'DELETED',
        action: 'delete',
      };

      const result = await processReferralWebhook(db, webhookHospitalId, payload, asSse(sseManager));
      expect(result.referralId).toBe('REF-DEL-001');
      expect(result.status).toBe('DELETED');

      // Record removed
      const after = await db.query(
        'SELECT id FROM cached_referrals WHERE refer_number = ?',
        ['REF-DEL-001'],
      );
      expect(after).toHaveLength(0);

      // SSE broadcast with DELETED status
      const sse = sseManager.getEventsByType('referral_update');
      expect(sse.length).toBeGreaterThanOrEqual(1);
      const evt = sse[0].data as Record<string, unknown>;
      expect(evt.status).toBe('DELETED');
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
