// Webhook service tests — API key management, payload validation, processing pipeline
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import {
  generateApiKey,
  hashApiKey,
  validatePayload,
  createApiKey,
  validateApiKey,
  revokeApiKey,
  listApiKeys,
} from '@/services/webhook';

describe('Webhook Service', () => {
  // ─── Pure function tests (no DB) ───

  describe('generateApiKey', () => {
    it('generates key with kklrms_ prefix', () => {
      const key = generateApiKey();
      expect(key.startsWith('kklrms_')).toBe(true);
    });

    it('generates key of correct length (47 chars)', () => {
      const key = generateApiKey();
      // "kklrms_" (7) + 40 hex chars = 47
      expect(key.length).toBe(47);
    });

    it('generates unique keys', () => {
      const keys = new Set(Array.from({ length: 10 }, () => generateApiKey()));
      expect(keys.size).toBe(10);
    });

    it('key suffix is valid hexadecimal', () => {
      const key = generateApiKey();
      const suffix = key.slice(7);
      expect(/^[0-9a-f]{40}$/.test(suffix)).toBe(true);
    });
  });

  describe('hashApiKey', () => {
    it('returns SHA-256 hex hash (64 chars)', () => {
      const hash = hashApiKey('kklrms_test123');
      expect(hash.length).toBe(64);
      expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
    });

    it('same input produces same hash (deterministic)', () => {
      const key = 'kklrms_abc123';
      expect(hashApiKey(key)).toBe(hashApiKey(key));
    });

    it('different inputs produce different hashes', () => {
      expect(hashApiKey('key1')).not.toBe(hashApiKey('key2'));
    });
  });

  describe('validatePayload', () => {
    it('rejects null body', () => {
      const result = validatePayload(null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('JSON object');
    });

    it('rejects non-object body', () => {
      expect(validatePayload('string').valid).toBe(false);
      expect(validatePayload(42).valid).toBe(false);
    });

    it('rejects missing patients array', () => {
      const result = validatePayload({});
      expect(result.valid).toBe(false);
      expect(result.error).toContain('"patients" must be an array');
    });

    it('rejects non-array patients field', () => {
      const result = validatePayload({ patients: 'not-array' });
      expect(result.valid).toBe(false);
    });

    it('rejects empty patients array', () => {
      const result = validatePayload({ patients: [] });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must not be empty');
    });

    it('rejects patients array exceeding 100 items', () => {
      const patients = Array.from({ length: 101 }, (_, i) => ({
        hn: `HN${i}`,
        an: `AN${i}`,
        name: 'Test',
        cid: '1100500090001',
        age: 25,
        admit_date: '2026-03-08T10:00:00+07:00',
      }));
      const result = validatePayload({ patients });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must not exceed 100');
    });

    it('accepts exactly 100 patients', () => {
      const patients = Array.from({ length: 100 }, (_, i) => ({
        hn: `HN${i}`,
        an: `AN${i}`,
        name: 'Test',
        cid: '1100500090002',
        age: 25,
        admit_date: '2026-03-08T10:00:00+07:00',
      }));
      expect(validatePayload({ patients }).valid).toBe(true);
    });

    it('rejects patient missing required hn', () => {
      const result = validatePayload({
        patients: [
          {
            an: 'AN1',
            name: 'Test',
            cid: '1100500090003',
            age: 25,
            admit_date: '2026-03-08T10:00:00',
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('hn is required');
    });

    it('rejects patient missing required an', () => {
      const result = validatePayload({
        patients: [
          {
            hn: 'HN1',
            name: 'Test',
            cid: '1100500090004',
            age: 25,
            admit_date: '2026-03-08T10:00:00',
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('an is required');
    });

    it('rejects patient missing required name', () => {
      const result = validatePayload({
        patients: [{ hn: 'HN1', an: 'AN1', age: 25, admit_date: '2026-03-08T10:00:00' }],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('name is required');
    });

    it('rejects patient missing required age', () => {
      const result = validatePayload({
        patients: [
          {
            hn: 'HN1',
            an: 'AN1',
            name: 'Test',
            cid: '1100500090005',
            admit_date: '2026-03-08T10:00:00',
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('age is required');
    });

    it('rejects patient with non-number age', () => {
      const result = validatePayload({
        patients: [
          {
            hn: 'HN1',
            an: 'AN1',
            name: 'Test',
            cid: '1100500090006',
            age: '25',
            admit_date: '2026-03-08T10:00:00',
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('age is required');
    });

    it('rejects patient missing required admit_date', () => {
      const result = validatePayload({
        patients: [{ hn: 'HN1', an: 'AN1', name: 'Test', cid: '1100500090007', age: 25 }],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('admit_date is required');
    });

    it('rejects CID with fewer than 13 digits', () => {
      const result = validatePayload({
        patients: [
          {
            hn: 'HN1',
            an: 'AN1',
            name: 'Test',
            cid: '123456789012',
            age: 25,
            admit_date: '2026-03-08T10:00:00+07:00',
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('CID must be exactly 13 digits');
    });

    it('rejects CID with more than 13 digits', () => {
      const result = validatePayload({
        patients: [
          {
            hn: 'HN1',
            an: 'AN1',
            name: 'Test',
            cid: '12345678901234',
            age: 25,
            admit_date: '2026-03-08T10:00:00+07:00',
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('CID must be exactly 13 digits');
    });

    it('rejects CID containing non-digit characters', () => {
      const result = validatePayload({
        patients: [
          {
            hn: 'HN1',
            an: 'AN1',
            name: 'Test',
            cid: '110050009000A',
            age: 25,
            admit_date: '2026-03-08T10:00:00+07:00',
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('CID must contain only digits');
    });

    it('rejects invalid ISO 8601 admit_date', () => {
      const result = validatePayload({
        patients: [
          {
            hn: 'HN1',
            an: 'AN1',
            name: 'Test',
            cid: '1100500090099',
            age: 25,
            admit_date: 'not-a-date',
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('admit_date must be a valid ISO 8601');
    });

    it('rejects admit_date with garbage text but ISO-like prefix', () => {
      const result = validatePayload({
        patients: [
          {
            hn: 'HN1',
            an: 'AN1',
            name: 'Test',
            cid: '1100500090099',
            age: 25,
            admit_date: '2026-13-45', // invalid month and day
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('admit_date must be a valid ISO 8601');
    });

    it('reports multiple validation errors at once', () => {
      const result = validatePayload({
        patients: [{ foo: 'bar' }],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('hn is required');
      expect(result.error).toContain('an is required');
      expect(result.error).toContain('name is required');
      expect(result.error).toContain('CID is required');
      expect(result.error).toContain('age is required');
      expect(result.error).toContain('admit_date is required');
    });

    it('accepts valid minimal patient', () => {
      const result = validatePayload({
        patients: [
          {
            hn: 'HN001',
            an: 'AN001',
            name: 'ทดสอบ ระบบ',
            cid: '1100500090008',
            age: 25,
            admit_date: '2026-03-08T10:00:00+07:00',
          },
        ],
      });
      expect(result.valid).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.payload!.patients).toHaveLength(1);
    });

    it('accepts valid patient with all optional fields', () => {
      const result = validatePayload({
        patients: [
          {
            hn: 'HN001',
            an: 'AN001',
            name: 'ทดสอบ ระบบ',
            cid: '0000000000023',
            age: 25,
            gravida: 2,
            ga_weeks: 38,
            anc_count: 8,
            admit_date: '2026-03-08T10:00:00+07:00',
            height_cm: 155,
            weight_kg: 65,
            weight_diff_kg: 12,
            fundal_height_cm: 32,
            us_weight_g: 3200,
            hematocrit_pct: 35,
            labor_status: 'ACTIVE',
          },
        ],
      });
      expect(result.valid).toBe(true);
      expect(result.payload!.patients[0].cid).toBe('0000000000023');
      expect(result.payload!.patients[0].gravida).toBe(2);
    });

    it('accepts multiple patients in single payload', () => {
      const result = validatePayload({
        patients: [
          {
            hn: 'HN001',
            an: 'AN001',
            name: 'Patient 1',
            cid: '1100500090010',
            age: 25,
            admit_date: '2026-03-08T10:00:00',
          },
          {
            hn: 'HN002',
            an: 'AN002',
            name: 'Patient 2',
            cid: '1100500090011',
            age: 30,
            admit_date: '2026-03-08T11:00:00',
          },
          {
            hn: 'HN003',
            an: 'AN003',
            name: 'Patient 3',
            cid: '1100500090012',
            age: 22,
            admit_date: '2026-03-08T12:00:00',
          },
        ],
      });
      expect(result.valid).toBe(true);
      expect(result.payload!.patients).toHaveLength(3);
    });

    it('validates each patient independently — one bad does not skip others', () => {
      const result = validatePayload({
        patients: [
          {
            hn: 'HN001',
            an: 'AN001',
            name: 'Good',
            cid: '1100500090013',
            age: 25,
            admit_date: '2026-03-08T10:00:00',
          },
          { hn: 'HN002' }, // missing fields
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('patients[1]');
    });

    it('accepts mode=incremental', () => {
      const result = validatePayload({
        mode: 'incremental',
        patients: [
          {
            hn: 'HN1',
            an: 'AN1',
            name: 'Test',
            cid: '1100500090014',
            age: 25,
            admit_date: '2026-03-08T10:00:00',
          },
        ],
      });
      expect(result.valid).toBe(true);
      expect(result.payload!.mode).toBe('incremental');
    });

    it('accepts mode=full_snapshot', () => {
      const result = validatePayload({
        mode: 'full_snapshot',
        patients: [
          {
            hn: 'HN1',
            an: 'AN1',
            name: 'Test',
            cid: '1100500090015',
            age: 25,
            admit_date: '2026-03-08T10:00:00',
          },
        ],
      });
      expect(result.valid).toBe(true);
      expect(result.payload!.mode).toBe('full_snapshot');
    });

    it('accepts payload without mode (defaults to incremental)', () => {
      const result = validatePayload({
        patients: [
          {
            hn: 'HN1',
            an: 'AN1',
            name: 'Test',
            cid: '1100500090016',
            age: 25,
            admit_date: '2026-03-08T10:00:00',
          },
        ],
      });
      expect(result.valid).toBe(true);
      expect(result.payload!.mode).toBeUndefined();
    });

    it('rejects invalid mode value', () => {
      const result = validatePayload({
        mode: 'bulk',
        patients: [
          {
            hn: 'HN1',
            an: 'AN1',
            name: 'Test',
            cid: '1100500090017',
            age: 25,
            admit_date: '2026-03-08T10:00:00',
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('"mode"');
    });

    // activeAns — the authoritative complete active-AN set used for discharge
    // reconciliation (browser push, whose `patients` list may be filtered/capped).
    it('accepts activeAns as an array of strings', () => {
      const result = validatePayload({
        patients: [
          {
            hn: 'HN1',
            an: 'AN1',
            name: 'Test',
            cid: '1100500090020',
            age: 25,
            admit_date: '2026-03-08T10:00:00',
          },
        ],
        activeAns: ['AN1', 'AN2', 'AN3'],
      });
      expect(result.valid).toBe(true);
      expect(result.payload!.activeAns).toEqual(['AN1', 'AN2', 'AN3']);
    });

    it('rejects activeAns containing non-string elements', () => {
      const result = validatePayload({
        patients: [
          {
            hn: 'HN1',
            an: 'AN1',
            name: 'Test',
            cid: '1100500090021',
            age: 25,
            admit_date: '2026-03-08T10:00:00',
          },
        ],
        activeAns: ['AN1', 42],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('activeAns');
    });

    it('rejects activeAns that is not an array', () => {
      const result = validatePayload({
        patients: [
          {
            hn: 'HN1',
            an: 'AN1',
            name: 'Test',
            cid: '1100500090022',
            age: 25,
            admit_date: '2026-03-08T10:00:00',
          },
        ],
        activeAns: 'AN1',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('activeAns');
    });
  });

  // ─── DB-dependent tests ───

  describe('API Key CRUD (with DB)', () => {
    let db: DatabaseAdapter;
    const hospitalId = 'hosp-webhook-1';

    beforeEach(async () => {
      db = await createTestDb();

      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [hospitalId, '99901', 'รพ.ทดสอบ Webhook', 'F1', true, 'UNKNOWN', now, now],
      );
    });

    afterEach(async () => {
      await db.close();
    });

    it('createApiKey stores hashed key and returns raw key', async () => {
      const result = await createApiKey(db, hospitalId, 'Test Key');

      expect(result.rawKey).toMatch(/^kklrms_[0-9a-f]{40}$/);
      expect(result.keyPrefix).toBe('kklrms_' + result.rawKey.slice(7, 8));
      expect(result.id).toBeTruthy();

      // Verify stored in DB (hashed, not raw)
      const rows = await db.query<{ key_hash: string; label: string; is_active: boolean }>(
        'SELECT key_hash, label, is_active FROM webhook_api_keys WHERE id = ?',
        [result.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].key_hash).toBe(hashApiKey(result.rawKey));
      expect(rows[0].label).toBe('Test Key');
      expect(rows[0].is_active).toBe(true);
    });

    it('validateApiKey returns hospitalId for valid key', async () => {
      const { rawKey } = await createApiKey(db, hospitalId, 'Valid Key');

      const result = await validateApiKey(db, rawKey);
      expect(result).not.toBeNull();
      expect(result!.hospitalId).toBe(hospitalId);
    });

    it('validateApiKey updates last_used_at on success', async () => {
      const { id, rawKey } = await createApiKey(db, hospitalId, 'Track Usage');

      await validateApiKey(db, rawKey);

      const rows = await db.query<{ last_used_at: string | null }>(
        'SELECT last_used_at FROM webhook_api_keys WHERE id = ?',
        [id],
      );
      expect(rows[0].last_used_at).not.toBeNull();
    });

    it('validateApiKey returns null for invalid key', async () => {
      const result = await validateApiKey(db, 'kklrms_invalid_key_that_does_not_exist');
      expect(result).toBeNull();
    });

    it('validateApiKey returns null for revoked key', async () => {
      const { id, rawKey } = await createApiKey(db, hospitalId, 'Revokable Key');

      await revokeApiKey(db, id);

      const result = await validateApiKey(db, rawKey);
      expect(result).toBeNull();
    });

    it('revokeApiKey sets is_active=false and revoked_at', async () => {
      const { id } = await createApiKey(db, hospitalId, 'To Revoke');

      await revokeApiKey(db, id);

      const rows = await db.query<{ is_active: boolean; revoked_at: string | null }>(
        'SELECT is_active, revoked_at FROM webhook_api_keys WHERE id = ?',
        [id],
      );
      expect(rows[0].is_active).toBe(false);
      expect(rows[0].revoked_at).not.toBeNull();
    });

    it('listApiKeys returns all keys with hospital info', async () => {
      await createApiKey(db, hospitalId, 'Key A');
      await createApiKey(db, hospitalId, 'Key B');

      const keys = await listApiKeys(db);
      expect(keys.length).toBeGreaterThanOrEqual(2);

      const keyA = keys.find((k) => k.label === 'Key A');
      expect(keyA).toBeDefined();
      expect(keyA!.hcode).toBe('99901');
      expect(keyA!.hospitalName).toBe('รพ.ทดสอบ Webhook');
      expect(keyA!.isActive).toBeTruthy();
    });

    it('listApiKeys filters by hospitalId', async () => {
      // Add another hospital
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['hosp-other', '99902', 'รพ.อื่น', 'F2', true, 'UNKNOWN', now, now],
      );
      await createApiKey(db, hospitalId, 'Hospital 1 Key');
      await createApiKey(db, 'hosp-other', 'Hospital 2 Key');

      const filtered = await listApiKeys(db, hospitalId);
      expect(filtered.every((k) => k.hospitalId === hospitalId)).toBe(true);
    });

    it('multiple keys can exist for same hospital', async () => {
      const key1 = await createApiKey(db, hospitalId, 'Primary');
      const key2 = await createApiKey(db, hospitalId, 'Secondary');

      expect(key1.rawKey).not.toBe(key2.rawKey);

      // Both should validate
      const v1 = await validateApiKey(db, key1.rawKey);
      const v2 = await validateApiKey(db, key2.rawKey);
      expect(v1).not.toBeNull();
      expect(v2).not.toBeNull();
      expect(v1!.hospitalId).toBe(v2!.hospitalId);
    });

    it('revoking one key does not affect other keys for same hospital', async () => {
      const key1 = await createApiKey(db, hospitalId, 'Keep Active');
      const key2 = await createApiKey(db, hospitalId, 'Will Revoke');

      await revokeApiKey(db, key2.id);

      expect(await validateApiKey(db, key1.rawKey)).not.toBeNull();
      expect(await validateApiKey(db, key2.rawKey)).toBeNull();
    });
  });
});
