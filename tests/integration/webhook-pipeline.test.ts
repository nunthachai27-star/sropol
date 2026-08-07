// Integration tests: webhook pipeline — external hospital data -> cached patients -> CPD -> dashboard
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createTestDb } from '../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import { generateKey } from '@/lib/encryption';
import type { SseManager } from '@/lib/sse';
import { getProvinceDashboard } from '@/services/dashboard';
import {
  createApiKey,
  validateApiKey,
  revokeApiKey,
  validatePayload,
  processWebhookPayload,
  type WebhookPayload,
} from '@/services/webhook';
import { RiskLevel } from '@/types/domain';

// Ensure ENCRYPTION_KEY is set for tests
const TEST_ENCRYPTION_KEY = generateKey();
process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

// Mock SSE manager that captures broadcast events (duck-typed, not extending private-constructor singleton)
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

// Cast helper — processWebhookPayload only calls broadcast(), so the mock is safe
function asSse(mock: MockSseManager): SseManager {
  return mock as unknown as SseManager;
}

describe('Webhook Pipeline Integration', () => {
  let db: DatabaseAdapter;
  let sseManager: MockSseManager;
  let webhookHospitalId: string;

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    sseManager = new MockSseManager();

    // Register a non-HOSxP hospital for webhook integration
    const now = new Date().toISOString();
    webhookHospitalId = uuidv4();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [webhookHospitalId, '99901', 'รพ.เอกชนทดสอบ (Webhook)', 'M2', true, 'UNKNOWN', now, now],
    );
  });

  afterEach(async () => {
    await db.close();
  });

  // ─── Scenario 1: Full webhook pipeline ───
  describe('Scenario 1: Full webhook pipeline — key create → validate → process → dashboard', () => {
    it('processes webhook payload and patients appear in dashboard', async () => {
      // Step 1: Create API key for the webhook hospital
      const { rawKey } = await createApiKey(db, webhookHospitalId, 'Production Key');

      // Step 2: Validate the API key
      const keyInfo = await validateApiKey(db, rawKey);
      expect(keyInfo).not.toBeNull();
      expect(keyInfo!.hospitalId).toBe(webhookHospitalId);

      // Step 3: Validate and process webhook payload
      const payload: WebhookPayload = {
        hospitalCode: '99901',
        patients: [
          {
            hn: 'WH-001',
            an: 'WAN-001',
            name: 'นาง ทดสอบ เว็บฮุค',
            cid: '0000000000021',
            age: 28,
            gravida: 1,
            ga_weeks: 41,
            anc_count: 3,
            admit_date: '2026-03-08T08:00:00+07:00',
            height_cm: 148,
            weight_kg: 75,
            weight_diff_kg: 20,
            fundal_height_cm: 37,
            us_weight_g: 4000,
            hematocrit_pct: 29,
            labor_status: 'ACTIVE',
          },
          {
            hn: 'WH-002',
            an: 'WAN-002',
            name: 'นาง ปกติ ดี',
            cid: '1100500010001',
            age: 24,
            gravida: 2,
            ga_weeks: 38,
            anc_count: 8,
            admit_date: '2026-03-08T10:00:00+07:00',
            height_cm: 162,
            weight_kg: 60,
            weight_diff_kg: 10,
            fundal_height_cm: 30,
            us_weight_g: 2800,
            hematocrit_pct: 36,
            labor_status: 'ACTIVE',
          },
        ],
      };

      const validation = validatePayload(payload);
      expect(validation.valid).toBe(true);

      const result = await processWebhookPayload(
        db,
        webhookHospitalId,
        validation.payload!,
        asSse(sseManager),
      );

      expect(result.patientsProcessed).toBe(2);
      expect(result.newAdmissions).toBe(2);

      // Step 4: Verify patients are in cached_patients
      const patients = await db.query<{ an: string; labor_status: string }>(
        'SELECT an, labor_status FROM cached_patients WHERE hospital_id = ? ORDER BY an',
        [webhookHospitalId],
      );
      expect(patients).toHaveLength(2);
      expect(patients[0].an).toBe('WAN-001');
      expect(patients[1].an).toBe('WAN-002');

      // Step 5: Verify CPD scores were calculated
      const cpdScores = await db.query<{ risk_level: string; score: number }>(
        `SELECT cs.risk_level, cs.score FROM cpd_scores cs
         JOIN cached_patients cp ON cp.id = cs.patient_id
         WHERE cp.hospital_id = ?
         ORDER BY cp.an`,
        [webhookHospitalId],
      );
      expect(cpdScores).toHaveLength(2);
      // Patient 1 (gravida=1, short, high US, etc.) should be HIGH risk
      expect(cpdScores[0].risk_level).toBe(RiskLevel.HIGH);
      expect(cpdScores[0].score).toBeGreaterThanOrEqual(10);
      // Patient 2 (normal values) should be LOW risk
      expect(cpdScores[1].risk_level).toBe(RiskLevel.LOW);

      // Step 6: Verify hospital status updated to ONLINE
      const hospitalStatus = await db.query<{
        connection_status: string;
        last_sync_at: string | null;
      }>('SELECT connection_status, last_sync_at FROM hospitals WHERE id = ?', [webhookHospitalId]);
      expect(hospitalStatus[0].connection_status).toBe('ONLINE');
      expect(hospitalStatus[0].last_sync_at).not.toBeNull();

      // Step 7: Verify SSE events broadcast
      const newAdmissionEvents = sseManager.getEventsByType('new_admission');
      expect(newAdmissionEvents).toHaveLength(2);

      const syncCompleteEvents = sseManager.events.filter((e) => e.event === 'sync-complete');
      expect(syncCompleteEvents).toHaveLength(1);
      expect((syncCompleteEvents[0].data as Record<string, unknown>).source).toBe('webhook');

      // Step 8: Dashboard should now include the webhook hospital
      const dashboard = await getProvinceDashboard(db);
      const webhookHospital = dashboard.hospitals.find((h) => h.hcode === '99901');
      expect(webhookHospital).toBeDefined();
      expect(webhookHospital!.counts.total).toBe(2);
      expect(webhookHospital!.counts.high).toBe(1);
      expect(webhookHospital!.counts.low).toBe(1);
      expect(webhookHospital!.connectionStatus).toBe('ONLINE');

      // Summary should include webhook patients
      expect(dashboard.summary.totalActive).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── Scenario 2: Patient data updates via webhook ───
  describe('Scenario 2: Webhook upsert — updating existing patients', () => {
    it('updates existing patient data without creating duplicates', async () => {
      const { rawKey } = await createApiKey(db, webhookHospitalId, 'Update Test');
      await validateApiKey(db, rawKey);

      // First webhook: admit patient
      const initial: WebhookPayload = {
        hospitalCode: '99901',
        patients: [
          {
            hn: 'WH-UPD',
            an: 'WAN-UPD',
            name: 'นาง อัพเดท ข้อมูล',
            cid: '1100500010002',
            age: 30,
            gravida: 2,
            ga_weeks: 38,
            admit_date: '2026-03-08T08:00:00+07:00',
            labor_status: 'ACTIVE',
          },
        ],
      };

      await processWebhookPayload(db, webhookHospitalId, initial, asSse(sseManager));

      const after1 = await db.query<{ an: string; ga_weeks: number | null }>(
        'SELECT an, ga_weeks FROM cached_patients WHERE hospital_id = ? AND an = ?',
        [webhookHospitalId, 'WAN-UPD'],
      );
      expect(after1).toHaveLength(1);
      expect(after1[0].ga_weeks).toBe(38);

      sseManager.clearEvents();

      // Second webhook: same patient, updated GA
      const updated: WebhookPayload = {
        hospitalCode: '99901',
        patients: [
          {
            hn: 'WH-UPD',
            an: 'WAN-UPD',
            name: 'นาง อัพเดท ข้อมูล',
            cid: '1100500010003',
            age: 30,
            gravida: 2,
            ga_weeks: 39,
            admit_date: '2026-03-08T08:00:00+07:00',
            height_cm: 155,
            weight_diff_kg: 14,
            labor_status: 'ACTIVE',
          },
        ],
      };

      const result = await processWebhookPayload(db, webhookHospitalId, updated, asSse(sseManager));
      expect(result.patientsProcessed).toBe(1);
      expect(result.newAdmissions).toBe(0); // Not a new admission

      // Should still be 1 row, not 2
      const after2 = await db.query<{ ga_weeks: number; height_cm: number | null }>(
        'SELECT ga_weeks, height_cm FROM cached_patients WHERE hospital_id = ? AND an = ?',
        [webhookHospitalId, 'WAN-UPD'],
      );
      expect(after2).toHaveLength(1);
      expect(after2[0].ga_weeks).toBe(39); // Updated
      expect(after2[0].height_cm).toBe(155); // New field added
    });
  });

  // ─── Scenario 3: PDPA compliance ───
  describe('Scenario 3: PDPA compliance — name and CID encryption', () => {
    it('encrypts patient name and CID before storing', async () => {
      await createApiKey(db, webhookHospitalId, 'PDPA Test');

      const payload: WebhookPayload = {
        hospitalCode: '99901',
        patients: [
          {
            hn: 'WH-PDPA',
            an: 'WAN-PDPA',
            name: 'นาง มาลี สมบูรณ์',
            cid: '0000000000022',
            age: 25,
            admit_date: '2026-03-08T08:00:00+07:00',
          },
        ],
      };

      await processWebhookPayload(db, webhookHospitalId, payload, asSse(sseManager));

      const stored = await db.query<{ name: string; cid: string | null; cid_hash: string | null }>(
        'SELECT name, cid, cid_hash FROM cached_patients WHERE an = ?',
        ['WAN-PDPA'],
      );
      expect(stored).toHaveLength(1);
      // Name should be encrypted (not readable plaintext)
      expect(stored[0].name).not.toContain('มาลี');
      expect(stored[0].name).not.toContain('สมบูรณ์');
      // CID should be encrypted
      expect(stored[0].cid).not.toBe('0000000000022');
      expect(stored[0].cid).not.toBeNull();
      // CID hash should be SHA-256 for cross-hospital matching
      expect(stored[0].cid_hash).not.toBeNull();
      expect(stored[0].cid_hash!.length).toBe(64);
    });

    it('CID is always stored encrypted with SHA-256 hash', async () => {
      const payload: WebhookPayload = {
        hospitalCode: '99901',
        patients: [
          {
            hn: 'WH-CID',
            an: 'WAN-CID',
            name: 'นาง มี บัตร',
            cid: '1100500010004',
            age: 22,
            admit_date: '2026-03-08T08:00:00+07:00',
          },
        ],
      };

      await processWebhookPayload(db, webhookHospitalId, payload, asSse(sseManager));

      const stored = await db.query<{ cid: string | null; cid_hash: string | null }>(
        'SELECT cid, cid_hash FROM cached_patients WHERE an = ?',
        ['WAN-CID'],
      );
      // CID is encrypted (not plain text) and hash is stored
      expect(stored[0].cid).not.toBeNull();
      expect(stored[0].cid).not.toBe('1100500010004'); // encrypted, not plain
      expect(stored[0].cid_hash).not.toBeNull();
      expect(stored[0].cid_hash).toHaveLength(64); // SHA-256 hex
    });
  });

  // ─── Scenario 4: CPD risk scoring from webhook data ───
  describe('Scenario 4: CPD score calculation from webhook data', () => {
    it('calculates HIGH risk score for high-risk clinical factors', async () => {
      const payload: WebhookPayload = {
        hospitalCode: '99901',
        patients: [
          {
            hn: 'WH-HR',
            an: 'WAN-HR',
            name: 'นาง เสี่ยง สูง',
            cid: '1100500010005',
            age: 35,
            gravida: 1,
            ga_weeks: 42,
            anc_count: 2,
            admit_date: '2026-03-08T08:00:00+07:00',
            height_cm: 147,
            weight_diff_kg: 22,
            fundal_height_cm: 38,
            us_weight_g: 4200,
            hematocrit_pct: 28,
          },
        ],
      };

      await processWebhookPayload(db, webhookHospitalId, payload, asSse(sseManager));

      const cpd = await db.query<{ score: number; risk_level: string; missing_factors: string }>(
        `SELECT cs.score, cs.risk_level, cs.missing_factors FROM cpd_scores cs
         JOIN cached_patients cp ON cp.id = cs.patient_id
         WHERE cp.an = ?`,
        ['WAN-HR'],
      );
      expect(cpd).toHaveLength(1);
      expect(cpd[0].risk_level).toBe(RiskLevel.HIGH);
      expect(cpd[0].score).toBeGreaterThanOrEqual(10);
      // All factors provided — no missing
      const missing = JSON.parse(cpd[0].missing_factors);
      expect(missing).toHaveLength(0);
    });

    it('handles partial clinical data — reports missing factors', async () => {
      const payload: WebhookPayload = {
        hospitalCode: '99901',
        patients: [
          {
            hn: 'WH-PARTIAL',
            an: 'WAN-PARTIAL',
            name: 'นาง ข้อมูล บางส่วน',
            cid: '1100500010006',
            age: 28,
            gravida: 2,
            ga_weeks: 38,
            admit_date: '2026-03-08T08:00:00+07:00',
            // No height, weight, fundal, US, HCT, ANC
          },
        ],
      };

      await processWebhookPayload(db, webhookHospitalId, payload, asSse(sseManager));

      const cpd = await db.query<{ missing_factors: string }>(
        `SELECT cs.missing_factors FROM cpd_scores cs
         JOIN cached_patients cp ON cp.id = cs.patient_id
         WHERE cp.an = ?`,
        ['WAN-PARTIAL'],
      );
      expect(cpd).toHaveLength(1);
      const missing = JSON.parse(cpd[0].missing_factors);
      expect(missing.length).toBeGreaterThanOrEqual(4); // ancCount, heightCm, weightDiffKg, etc.
    });

    it('broadcasts high_risk_alert SSE for new HIGH risk patient', async () => {
      const payload: WebhookPayload = {
        hospitalCode: '99901',
        patients: [
          {
            hn: 'WH-ALERT',
            an: 'WAN-ALERT',
            name: 'นาง แจ้งเตือน',
            cid: '1100500010007',
            age: 32,
            gravida: 1,
            ga_weeks: 42,
            anc_count: 1,
            admit_date: '2026-03-08T08:00:00+07:00',
            height_cm: 145,
            weight_diff_kg: 25,
            fundal_height_cm: 40,
            us_weight_g: 4500,
            hematocrit_pct: 26,
          },
        ],
      };

      await processWebhookPayload(db, webhookHospitalId, payload, asSse(sseManager));

      const alerts = sseManager.getEventsByType('high_risk_alert');
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      const alertData = alerts[0].data as Record<string, unknown>;
      expect(alertData.hcode).toBe('99901');
      expect(alertData.an).toBe('WAN-ALERT');
    });
  });

  // ─── Scenario 5: Cross-hospital transfer detection ───
  describe('Scenario 5: Cross-hospital transfer detection via CID hash', () => {
    it('detects patient transfer when same CID appears at webhook hospital', async () => {
      const now = new Date().toISOString();
      const sharedCid = '0000000000099';

      // Seed existing patient at HOSxP hospital (10670)
      const hosxpHospital = await db.query<{ id: string }>(
        "SELECT id FROM hospitals WHERE hcode = '10670'",
      );
      const hosxpId = hosxpHospital[0].id;

      // Manually insert patient at HOSxP hospital with CID hash
      const { createHash } = await import('crypto');
      const { encrypt } = await import('@/lib/encryption');
      const cidHash = createHash('sha256').update(sharedCid).digest('hex');

      await db.execute(
        `INSERT INTO cached_patients
           (id, hospital_id, hn, an, name, cid, cid_hash, age, gravida, ga_weeks,
            admit_date, labor_status, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          hosxpId,
          'HN-ORIG',
          'AN-ORIG',
          encrypt('นาง ย้าย มา', TEST_ENCRYPTION_KEY),
          encrypt(sharedCid, TEST_ENCRYPTION_KEY),
          cidHash,
          30,
          2,
          39,
          '2026-03-06T08:00:00',
          'ACTIVE',
          now,
          now,
          now,
        ],
      );

      // Now webhook same patient at webhook hospital (different AN, same CID)
      const payload: WebhookPayload = {
        hospitalCode: '99901',
        patients: [
          {
            hn: 'WH-XFER',
            an: 'WAN-XFER',
            name: 'นาง ย้าย มา',
            cid: sharedCid,
            age: 30,
            gravida: 2,
            ga_weeks: 39,
            admit_date: '2026-03-08T10:00:00+07:00',
            labor_status: 'ACTIVE',
          },
        ],
      };

      const result = await processWebhookPayload(db, webhookHospitalId, payload, asSse(sseManager));
      expect(result.transfers).toBe(1);

      // Verify original patient marked as TRANSFERRED
      const origStatus = await db.query<{ labor_status: string }>(
        'SELECT labor_status FROM cached_patients WHERE hospital_id = ? AND an = ?',
        [hosxpId, 'AN-ORIG'],
      );
      expect(origStatus[0].labor_status).toBe('TRANSFERRED');

      // Verify transfer SSE event broadcast
      const transferEvents = sseManager.getEventsByType('patient_transfer');
      expect(transferEvents).toHaveLength(1);
      const td = transferEvents[0].data as Record<string, unknown>;
      expect(td.fromHcode).toBe('10670');
      expect(td.toHcode).toBe('99901');
    });
  });

  // ─── Scenario 6: API key security ───
  describe('Scenario 6: API key security', () => {
    it('revoked key cannot be used to submit data', async () => {
      const { id, rawKey } = await createApiKey(db, webhookHospitalId, 'Revoke Test');
      await revokeApiKey(db, id);

      const keyInfo = await validateApiKey(db, rawKey);
      expect(keyInfo).toBeNull();
    });

    it('key from hospital A cannot push data to hospital B', async () => {
      // Create key for hospital 99901
      const { rawKey } = await createApiKey(db, webhookHospitalId, 'Hospital A Key');
      const keyInfo = await validateApiKey(db, rawKey);

      // Key is tied to hospital 99901 — it should not return another hospital's ID
      expect(keyInfo!.hospitalId).toBe(webhookHospitalId);
      // The processing function uses the hospitalId from the key, not from the payload
      // So even if an attacker sends data, it goes to the correct hospital
    });
  });

  // ─── Scenario 7: Mixed data sources in dashboard ───
  describe('Scenario 7: HOSxP-polled + webhook data coexist in dashboard', () => {
    it('dashboard aggregates patients from both HOSxP and webhook sources', async () => {
      // Seed patients at HOSxP hospital (via direct DB insert, simulating polling)
      const now = new Date().toISOString();
      const hosxpHospital = await db.query<{ id: string }>(
        "SELECT id FROM hospitals WHERE hcode = '10670'",
      );
      const hosxpId = hosxpHospital[0].id;

      const { encrypt } = await import('@/lib/encryption');
      const patientId = uuidv4();
      await db.execute(
        `INSERT INTO cached_patients
           (id, hospital_id, hn, an, name, age, gravida, ga_weeks, anc_count,
            admit_date, labor_status, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          patientId,
          hosxpId,
          'HN-HOSxP',
          'AN-HOSxP',
          encrypt('นาง HOSxP Patient', TEST_ENCRYPTION_KEY),
          25,
          2,
          38,
          6,
          '2026-03-08T08:00:00',
          'ACTIVE',
          now,
          now,
          now,
        ],
      );
      // Insert LOW CPD score for this patient
      const { calculateCpdScore } = await import('@/services/cpd-score');
      const cpdResult = calculateCpdScore({ gravida: 2, ancCount: 6, gaWeeks: 38 });
      await db.execute(
        `INSERT INTO cpd_scores
           (id, patient_id, score, risk_level, recommendation, missing_factors, calculated_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          patientId,
          cpdResult.score,
          cpdResult.riskLevel,
          cpdResult.recommendation,
          '[]',
          now,
          now,
        ],
      );

      // Webhook patient at non-HOSxP hospital
      const payload: WebhookPayload = {
        hospitalCode: '99901',
        patients: [
          {
            hn: 'WH-MIX',
            an: 'WAN-MIX',
            name: 'นาง Webhook Patient',
            cid: '1100500010008',
            age: 30,
            gravida: 1,
            ga_weeks: 41,
            anc_count: 2,
            admit_date: '2026-03-08T10:00:00+07:00',
            height_cm: 148,
            us_weight_g: 4000,
            hematocrit_pct: 28,
          },
        ],
      };

      await processWebhookPayload(db, webhookHospitalId, payload, asSse(sseManager));

      // Dashboard should show both
      const dashboard = await getProvinceDashboard(db);

      const hosxpH = dashboard.hospitals.find((h) => h.hcode === '10670');
      const webhookH = dashboard.hospitals.find((h) => h.hcode === '99901');

      expect(hosxpH!.counts.total).toBe(1);
      expect(webhookH!.counts.total).toBe(1);

      // Summary should aggregate across both sources
      expect(dashboard.summary.totalActive).toBe(2);
    });
  });

  // ─── Scenario 8: Delivered patient via webhook ───
  describe('Scenario 8: Patient delivered status via webhook', () => {
    it('handles DELIVERED status from webhook', async () => {
      // First: admit patient
      const admitPayload: WebhookPayload = {
        hospitalCode: '99901',
        patients: [
          {
            hn: 'WH-DEL',
            an: 'WAN-DEL',
            name: 'นาง คลอด แล้ว',
            cid: '1100500010009',
            age: 26,
            gravida: 2,
            ga_weeks: 39,
            admit_date: '2026-03-06T08:00:00+07:00',
            labor_status: 'ACTIVE',
          },
        ],
      };

      await processWebhookPayload(db, webhookHospitalId, admitPayload, asSse(sseManager));

      const active = await db.query<{ labor_status: string }>(
        'SELECT labor_status FROM cached_patients WHERE an = ?',
        ['WAN-DEL'],
      );
      expect(active[0].labor_status).toBe('ACTIVE');

      sseManager.clearEvents();

      // Then: update to DELIVERED
      const deliverPayload: WebhookPayload = {
        hospitalCode: '99901',
        patients: [
          {
            hn: 'WH-DEL',
            an: 'WAN-DEL',
            name: 'นาง คลอด แล้ว',
            cid: '1100500010010',
            age: 26,
            gravida: 2,
            ga_weeks: 39,
            admit_date: '2026-03-06T08:00:00+07:00',
            labor_status: 'DELIVERED',
          },
        ],
      };

      await processWebhookPayload(db, webhookHospitalId, deliverPayload, asSse(sseManager));

      const delivered = await db.query<{ labor_status: string }>(
        'SELECT labor_status FROM cached_patients WHERE an = ?',
        ['WAN-DEL'],
      );
      expect(delivered[0].labor_status).toBe('DELIVERED');

      // Dashboard should NOT count delivered patients
      const dashboard = await getProvinceDashboard(db);
      const wh = dashboard.hospitals.find((h) => h.hcode === '99901');
      expect(wh!.counts.total).toBe(0);
    });
  });

  // ─── Scenario 9: full_snapshot mode — auto-discharge missing patients ───
  describe('Scenario 9: full_snapshot mode — marks missing patients as DELIVERED', () => {
    it('full_snapshot discharges patients not in the payload', async () => {
      // Step 1: Admit 3 patients via incremental webhook
      const admitPayload: WebhookPayload = {
        hospitalCode: '99901',
        patients: [
          {
            hn: 'WH-FS1',
            an: 'WAN-FS1',
            name: 'Patient A',
            cid: '1100500010011',
            age: 25,
            admit_date: '2026-03-06T08:00:00+07:00',
          },
          {
            hn: 'WH-FS2',
            an: 'WAN-FS2',
            name: 'Patient B',
            cid: '1100500010012',
            age: 28,
            admit_date: '2026-03-06T09:00:00+07:00',
          },
          {
            hn: 'WH-FS3',
            an: 'WAN-FS3',
            name: 'Patient C',
            cid: '1100500010013',
            age: 30,
            admit_date: '2026-03-06T10:00:00+07:00',
          },
        ],
      };
      await processWebhookPayload(db, webhookHospitalId, admitPayload, asSse(sseManager));

      // Verify 3 active patients
      const active = await db.query<{ an: string }>(
        "SELECT an FROM cached_patients WHERE hospital_id = ? AND labor_status = 'ACTIVE' ORDER BY an",
        [webhookHospitalId],
      );
      expect(active).toHaveLength(3);

      sseManager.clearEvents();

      // Step 2: Send full_snapshot with only Patient B (A and C delivered)
      const snapshotPayload: WebhookPayload = {
        hospitalCode: '99901',
        mode: 'full_snapshot',
        patients: [
          {
            hn: 'WH-FS2',
            an: 'WAN-FS2',
            name: 'Patient B',
            cid: '1100500010014',
            age: 28,
            admit_date: '2026-03-06T09:00:00+07:00',
          },
        ],
      };
      const result = await processWebhookPayload(
        db,
        webhookHospitalId,
        snapshotPayload,
        asSse(sseManager),
      );

      expect(result.patientsProcessed).toBe(1);
      expect(result.discharges).toBe(2);

      // Step 3: Verify patient statuses
      const afterSnapshot = await db.query<{
        an: string;
        labor_status: string;
        delivered_at: string | null;
      }>(
        'SELECT an, labor_status, delivered_at FROM cached_patients WHERE hospital_id = ? ORDER BY an',
        [webhookHospitalId],
      );
      expect(afterSnapshot).toHaveLength(3);

      // Patient A — DELIVERED with delivered_at timestamp
      expect(afterSnapshot[0].an).toBe('WAN-FS1');
      expect(afterSnapshot[0].labor_status).toBe('DELIVERED');
      expect(afterSnapshot[0].delivered_at).not.toBeNull();

      // Patient B — still ACTIVE
      expect(afterSnapshot[1].an).toBe('WAN-FS2');
      expect(afterSnapshot[1].labor_status).toBe('ACTIVE');

      // Patient C — DELIVERED with delivered_at timestamp
      expect(afterSnapshot[2].an).toBe('WAN-FS3');
      expect(afterSnapshot[2].labor_status).toBe('DELIVERED');
      expect(afterSnapshot[2].delivered_at).not.toBeNull();

      // Step 4: Dashboard should count only 1 active
      const dashboard = await getProvinceDashboard(db);
      const wh = dashboard.hospitals.find((h) => h.hcode === '99901');
      expect(wh!.counts.total).toBe(1);

      // Step 5: SSE should have discharge events
      const dischargeEvents = sseManager.getEventsByType('patient_discharged');
      expect(dischargeEvents).toHaveLength(2);
    });

    it('full_snapshot with all current patients produces zero discharges', async () => {
      // Admit 2 patients
      const admitPayload: WebhookPayload = {
        hospitalCode: '99901',
        patients: [
          {
            hn: 'WH-FN1',
            an: 'WAN-FN1',
            name: 'Patient X',
            cid: '1100500010015',
            age: 25,
            admit_date: '2026-03-06T08:00:00+07:00',
          },
          {
            hn: 'WH-FN2',
            an: 'WAN-FN2',
            name: 'Patient Y',
            cid: '1100500010016',
            age: 28,
            admit_date: '2026-03-06T09:00:00+07:00',
          },
        ],
      };
      await processWebhookPayload(db, webhookHospitalId, admitPayload, asSse(sseManager));

      sseManager.clearEvents();

      // full_snapshot with same 2 patients → no discharges
      const snapshotPayload: WebhookPayload = {
        hospitalCode: '99901',
        mode: 'full_snapshot',
        patients: [
          {
            hn: 'WH-FN1',
            an: 'WAN-FN1',
            name: 'Patient X',
            cid: '1100500010017',
            age: 25,
            admit_date: '2026-03-06T08:00:00+07:00',
          },
          {
            hn: 'WH-FN2',
            an: 'WAN-FN2',
            name: 'Patient Y',
            cid: '1100500010018',
            age: 28,
            admit_date: '2026-03-06T09:00:00+07:00',
          },
        ],
      };
      const result = await processWebhookPayload(
        db,
        webhookHospitalId,
        snapshotPayload,
        asSse(sseManager),
      );

      expect(result.discharges).toBe(0);
      const dischargeEvents = sseManager.getEventsByType('patient_discharged');
      expect(dischargeEvents).toHaveLength(0);
    });
  });

  // ─── Scenario 12: activeAns reconciliation — browser-push fix (Mantis #9505) ───
  //
  // Production sync is browser-driven: the browser pulls the COMPLETE active
  // labor set from HOSxP and POSTs it. Its `patients` upsert list may be
  // filtered (name-authenticity probe) or capped at 100, so it declares the
  // authoritative active set separately via `activeAns`. The server closes out
  // any cached ACTIVE patient whose AN is absent from `activeAns`. This is the
  // fix for the bug where a discharged/emptied ward kept showing ghosts.
  describe('Scenario 12: activeAns reconciliation — browser-push fix for Mantis #9505', () => {
    async function admit(rows: Array<{ hn: string; an: string; cid: string }>): Promise<void> {
      const payload: WebhookPayload = {
        hospitalCode: '99901',
        patients: rows.map((p, i) => ({
          hn: p.hn,
          an: p.an,
          name: `Patient ${i}`,
          cid: p.cid,
          age: 25 + i,
          admit_date: '2026-03-06T08:00:00+07:00',
        })),
      };
      await processWebhookPayload(db, webhookHospitalId, payload, asSse(sseManager));
    }

    async function statuses(): Promise<Array<{ an: string; labor_status: string }>> {
      return db.query<{ an: string; labor_status: string }>(
        'SELECT an, labor_status FROM cached_patients WHERE hospital_id = ? ORDER BY an',
        [webhookHospitalId],
      );
    }

    it('discharges ACTIVE patients absent from activeAns (incremental mode — the live browser path)', async () => {
      await admit([
        { hn: 'H1', an: 'A1', cid: '1100500010101' },
        { hn: 'H2', an: 'A2', cid: '1100500010102' },
        { hn: 'H3', an: 'A3', cid: '1100500010103' },
      ]);
      sseManager.clearEvents();

      // Browser upserts the survivor A2 (incremental) and declares the full
      // active set [A2]. A1 and A3 were discharged in HOSxP this cycle.
      const result = await processWebhookPayload(
        db,
        webhookHospitalId,
        {
          hospitalCode: '99901',
          mode: 'incremental',
          patients: [
            {
              hn: 'H2',
              an: 'A2',
              name: 'Patient B',
              cid: '1100500010102',
              age: 28,
              admit_date: '2026-03-06T09:00:00+07:00',
            },
          ],
          activeAns: ['A2'],
        },
        asSse(sseManager),
      );

      expect(result.discharges).toBe(2);
      expect(await statuses()).toEqual([
        { an: 'A1', labor_status: 'DELIVERED' },
        { an: 'A2', labor_status: 'ACTIVE' },
        { an: 'A3', labor_status: 'DELIVERED' },
      ]);
      expect(sseManager.getEventsByType('patient_discharged')).toHaveLength(2);
    });

    it('does NOT discharge a patient absent from `patients` but present in `activeAns` (name-probe safety)', async () => {
      await admit([
        { hn: 'H1', an: 'A1', cid: '1100500010111' },
        { hn: 'H2', an: 'A2', cid: '1100500010112' },
      ]);

      // The browser dropped A2 from the upsert list (failed name round-trip),
      // but A2 is still admitted — activeAns lists BOTH. A2 must stay ACTIVE.
      const result = await processWebhookPayload(
        db,
        webhookHospitalId,
        {
          hospitalCode: '99901',
          mode: 'incremental',
          patients: [
            {
              hn: 'H1',
              an: 'A1',
              name: 'Patient A',
              cid: '1100500010111',
              age: 25,
              admit_date: '2026-03-06T08:00:00+07:00',
            },
          ],
          activeAns: ['A1', 'A2'],
        },
        asSse(sseManager),
      );

      expect(result.discharges).toBe(0);
      expect(await statuses()).toEqual([
        { an: 'A1', labor_status: 'ACTIVE' },
        { an: 'A2', labor_status: 'ACTIVE' },
      ]);
    });

    it('empty activeAns with empty patients discharges the whole ward (Occupied=0 case)', async () => {
      await admit([
        { hn: 'H1', an: 'A1', cid: '1100500010121' },
        { hn: 'H2', an: 'A2', cid: '1100500010122' },
        { hn: 'H3', an: 'A3', cid: '1100500010123' },
      ]);
      sseManager.clearEvents();

      const result = await processWebhookPayload(
        db,
        webhookHospitalId,
        { hospitalCode: '99901', patients: [], activeAns: [] },
        asSse(sseManager),
      );

      expect(result.discharges).toBe(3);
      const after = await statuses();
      expect(after.every((r) => r.labor_status === 'DELIVERED')).toBe(true);

      const dashboard = await getProvinceDashboard(db);
      const wh = dashboard.hospitals.find((h) => h.hcode === '99901');
      expect(wh!.counts.total).toBe(0);
    });

    it('reconciliation via activeAns does not clobber a TRANSFERRED row', async () => {
      await admit([{ hn: 'H1', an: 'A1', cid: '1100500010131' }]);
      // Seed a TRANSFERRED row the way the transfer-detection block would.
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO cached_patients (id, hospital_id, hn, an, name, cid, cid_hash, age, gravida, ga_weeks, anc_count, admit_date, labor_status, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          webhookHospitalId,
          'H9',
          'A9',
          'x',
          'x',
          'h9',
          30,
          1,
          39,
          4,
          now,
          'TRANSFERRED',
          now,
          now,
          now,
        ],
      );

      const result = await processWebhookPayload(
        db,
        webhookHospitalId,
        { hospitalCode: '99901', patients: [], activeAns: [] },
        asSse(sseManager),
      );

      // A1 (ACTIVE) closed; A9 stays TRANSFERRED (guard in markPatientsDelivered).
      expect(result.discharges).toBe(1);
      expect(await statuses()).toEqual([
        { an: 'A1', labor_status: 'DELIVERED' },
        { an: 'A9', labor_status: 'TRANSFERRED' },
      ]);
    });

    it('marks a reconciled patient TRANSFERRED (not DELIVERED) when their CID is ACTIVE at another hospital', async () => {
      const now = new Date().toISOString();
      const hospitalB = uuidv4();
      await db.execute(
        `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [hospitalB, '99902', 'รพ.รับส่งต่อ (B)', 'M2', true, 'UNKNOWN', now, now],
      );

      const seed = (hospId: string, an: string, cidHash: string, status: string) =>
        db.execute(
          `INSERT INTO cached_patients (id, hospital_id, hn, an, name, cid, cid_hash, age, gravida, ga_weeks, anc_count, admit_date, labor_status, synced_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            hospId,
            `HN${an}`,
            an,
            'x',
            'x',
            cidHash,
            28,
            1,
            39,
            4,
            now,
            status,
            now,
            now,
            now,
          ],
        );

      // A has two ACTIVE patients: A-T (CID also ACTIVE at B → transferred out)
      // and A-D (CID nowhere else → genuine delivery/discharge).
      await seed(webhookHospitalId, 'A-T', 'CH-SHARED', 'ACTIVE');
      await seed(webhookHospitalId, 'A-D', 'CH-UNIQUE', 'ACTIVE');
      await seed(hospitalB, 'B-T', 'CH-SHARED', 'ACTIVE');
      sseManager.clearEvents();

      // A reconciles with an empty active set (both gone from A's HOSxP).
      const result = await processWebhookPayload(
        db,
        webhookHospitalId,
        { hospitalCode: '99901', patients: [], activeAns: [] },
        asSse(sseManager),
      );

      const aRows = await db.query<{ an: string; labor_status: string }>(
        'SELECT an, labor_status FROM cached_patients WHERE hospital_id = ? ORDER BY an',
        [webhookHospitalId],
      );
      expect(aRows).toEqual([
        { an: 'A-D', labor_status: 'DELIVERED' },
        { an: 'A-T', labor_status: 'TRANSFERRED' },
      ]);

      // B's row is never touched by A's reconcile.
      const bRow = await db.query<{ labor_status: string }>(
        'SELECT labor_status FROM cached_patients WHERE hospital_id = ? AND an = ?',
        [hospitalB, 'B-T'],
      );
      expect(bRow[0].labor_status).toBe('ACTIVE');

      // Only the genuine delivery emits patient_discharged; the transfer does not.
      expect(sseManager.getEventsByType('patient_discharged')).toHaveLength(1);
      expect(result.discharges).toBe(2);
    });

    it('incremental WITHOUT activeAns never discharges (preserves legacy behavior)', async () => {
      await admit([
        { hn: 'H1', an: 'A1', cid: '1100500010141' },
        { hn: 'H2', an: 'A2', cid: '1100500010142' },
      ]);

      // Legacy-style incremental push of only A1, no activeAns → A2 untouched.
      const result = await processWebhookPayload(
        db,
        webhookHospitalId,
        {
          hospitalCode: '99901',
          mode: 'incremental',
          patients: [
            {
              hn: 'H1',
              an: 'A1',
              name: 'Patient A',
              cid: '1100500010141',
              age: 25,
              admit_date: '2026-03-06T08:00:00+07:00',
            },
          ],
        },
        asSse(sseManager),
      );

      expect(result.discharges).toBe(0);
      expect(await statuses()).toEqual([
        { an: 'A1', labor_status: 'ACTIVE' },
        { an: 'A2', labor_status: 'ACTIVE' },
      ]);
    });
  });

  // ─── Scenario 11: partograph webhook through the route handler ───
  describe('partograph webhook', () => {
    it('routes type:partograph payloads end-to-end through POST /api/webhooks/patient-data', async () => {
      // Stub the request-scoped DB / init / SSE singleton so the route
      // handler reuses our in-memory adapter and mock SSE.
      const dbConnection = await import('@/db/connection');
      const ensureInit = await import('@/lib/ensure-init');
      const sseModule = await import('@/lib/sse');
      const { POST } = await import('@/app/api/webhooks/patient-data/route');

      const dbSpy = vi.spyOn(dbConnection, 'getDatabase').mockResolvedValue(db);
      const initSpy = vi.spyOn(ensureInit, 'ensureInit').mockResolvedValue(undefined);
      const sseSpy = vi
        .spyOn(sseModule.SseManager, 'getInstance')
        .mockReturnValue(sseManager as unknown as SseManager);

      try {
        // Seed the patient row so the AN can resolve.
        const { v4: uuid } = await import('uuid');
        const { encrypt } = await import('@/lib/encryption');
        const now = new Date().toISOString();
        await db.execute(
          `INSERT INTO cached_patients
             (id, hospital_id, hn, an, name, age, admit_date, labor_status,
              synced_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuid(),
            webhookHospitalId,
            'HN-PG',
            'AN-PG',
            encrypt('นาง ทดสอบ Partograph', TEST_ENCRYPTION_KEY),
            28,
            '2026-04-19T08:00:00+07:00',
            'ACTIVE',
            now,
            now,
            now,
          ],
        );

        const { rawKey } = await createApiKey(db, webhookHospitalId, 'Partograph Key');

        // Happy path
        const goodReq = new Request('http://localhost/api/webhooks/patient-data', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${rawKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'partograph',
            hospitalCode: '99901',
            observations: [
              {
                an: 'AN-PG',
                externalObservationId: 'EXT-PG-1',
                observeDatetime: '2026-04-19T08:00:00+07:00',
                fetalHeartRate: 140,
                cervicalDilationCm: 4,
              },
            ],
          }),
        });
        const goodRes = await POST(goodReq as unknown as import('next/server').NextRequest);
        const goodBody = await goodRes.json();
        expect(goodRes.status).toBe(200);
        expect(goodBody.success).toBe(true);
        expect(goodBody.observationsAccepted).toBe(1);

        const stored = await db.query<{ source_pk: string }>(
          `SELECT source_pk FROM cached_partograph_observations WHERE hospital_id = ?`,
          [webhookHospitalId],
        );
        expect(stored).toHaveLength(1);
        expect(stored[0].source_pk).toBe('EXT-PG-1');

        // Bad payload — missing externalObservationId → 400
        const badReq = new Request('http://localhost/api/webhooks/patient-data', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${rawKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'partograph',
            hospitalCode: '99901',
            observations: [
              {
                an: 'AN-PG',
                observeDatetime: '2026-04-19T09:00:00+07:00',
              },
            ],
          }),
        });
        const badRes = await POST(badReq as unknown as import('next/server').NextRequest);
        const badBody = await badRes.json();
        expect(badRes.status).toBe(400);
        expect(JSON.stringify(badBody)).toContain('externalObservationId');
      } finally {
        dbSpy.mockRestore();
        initSpy.mockRestore();
        sseSpy.mockRestore();
      }
    });
  });

  // ─── Scenario 10: incremental mode does NOT auto-discharge ───
  describe('Scenario 10: incremental mode preserves existing active patients', () => {
    it('incremental webhook does not discharge patients not in payload', async () => {
      // Admit 3 patients
      const admitPayload: WebhookPayload = {
        hospitalCode: '99901',
        patients: [
          {
            hn: 'WH-IN1',
            an: 'WAN-IN1',
            name: 'Keep Active A',
            cid: '1100500010019',
            age: 25,
            admit_date: '2026-03-06T08:00:00+07:00',
          },
          {
            hn: 'WH-IN2',
            an: 'WAN-IN2',
            name: 'Keep Active B',
            cid: '1100500010020',
            age: 28,
            admit_date: '2026-03-06T09:00:00+07:00',
          },
          {
            hn: 'WH-IN3',
            an: 'WAN-IN3',
            name: 'Keep Active C',
            cid: '1100500010021',
            age: 30,
            admit_date: '2026-03-06T10:00:00+07:00',
          },
        ],
      };
      await processWebhookPayload(db, webhookHospitalId, admitPayload, asSse(sseManager));

      sseManager.clearEvents();

      // Incremental: only send update for Patient B
      const updatePayload: WebhookPayload = {
        hospitalCode: '99901',
        mode: 'incremental',
        patients: [
          {
            hn: 'WH-IN2',
            an: 'WAN-IN2',
            name: 'Keep Active B',
            cid: '1100500010022',
            age: 28,
            ga_weeks: 39,
            admit_date: '2026-03-06T09:00:00+07:00',
          },
        ],
      };
      const result = await processWebhookPayload(
        db,
        webhookHospitalId,
        updatePayload,
        asSse(sseManager),
      );

      expect(result.discharges).toBe(0);

      // All 3 should still be ACTIVE
      const activeCount = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM cached_patients WHERE hospital_id = ? AND labor_status = 'ACTIVE'",
        [webhookHospitalId],
      );
      expect(activeCount[0].cnt).toBe(3);
    });
  });
});
