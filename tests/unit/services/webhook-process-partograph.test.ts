// T20: processPartographWebhook — resolves AN -> patient, calls T17 upsert,
// broadcasts severity changes, updates hospital ONLINE timestamp.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import type { SseManager } from '@/lib/sse';
import { processPartographWebhook, type WebhookPartographPayload } from '@/services/webhook';

// Duck-typed mock — SseManager has a private constructor; we only call broadcast().
class MockSseManager {
  public events: Array<{ event: string; data: unknown }> = [];
  broadcast(event: string, data: unknown): void {
    this.events.push({ event, data });
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

async function seedPatient(
  db: DatabaseAdapter,
  hospitalId: string,
  hn: string,
  an: string,
): Promise<string> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO cached_patients
       (id, hospital_id, hn, an, name, age, admit_date, labor_status,
        synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, hospitalId, hn, an, 'enc:test-name', 28, now, 'ACTIVE', now, now, now],
  );
  return id;
}

describe('processPartographWebhook', () => {
  let db: DatabaseAdapter;
  let sse: MockSseManager;
  let hospitalId: string;

  beforeEach(async () => {
    db = await createTestDb();

    hospitalId = uuidv4();
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [hospitalId, '99901', 'รพ.ทดสอบ Partograph', 'M2', true, 'UNKNOWN', now, now],
    );

    sse = new MockSseManager();
  });

  afterEach(async () => {
    await db.close();
  });

  it('resolves AN -> patient_id and persists observation rows', async () => {
    const patientId = await seedPatient(db, hospitalId, 'HN-1', 'AN-1');

    const payload: WebhookPartographPayload = {
      type: 'partograph',
      hospitalCode: '99901',
      observations: [
        {
          an: 'AN-1',
          externalObservationId: 'EXT-1',
          observeDatetime: '2026-04-19T08:00:00+07:00',
          hourNo: 1,
          fetalHeartRate: 140,
          cervicalDilationCm: 4,
        },
      ],
    };

    const result = await processPartographWebhook(db, hospitalId, payload, asSse(sse));

    expect(result.observationsAccepted).toBe(1);
    expect(result.observationsSkipped).toEqual([]);

    const stored = await db.query<{
      patient_id: string;
      source_system: string;
      source_pk: string;
      fetal_heart_rate: number | null;
    }>(
      `SELECT patient_id, source_system, source_pk, fetal_heart_rate
         FROM cached_partograph_observations WHERE hospital_id = ?`,
      [hospitalId],
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].patient_id).toBe(patientId);
    expect(stored[0].source_system).toBe('webhook');
    expect(stored[0].source_pk).toBe('EXT-1');
    expect(stored[0].fetal_heart_rate).toBe(140);
  });

  it('skips rows for unknown ANs and reports them in observationsSkipped', async () => {
    await seedPatient(db, hospitalId, 'HN-1', 'AN-1');

    const payload: WebhookPartographPayload = {
      type: 'partograph',
      hospitalCode: '99901',
      observations: [
        {
          an: 'AN-1',
          externalObservationId: 'EXT-OK',
          observeDatetime: '2026-04-19T08:00:00+07:00',
        },
        {
          an: 'AN-UNKNOWN',
          externalObservationId: 'EXT-MISS',
          observeDatetime: '2026-04-19T08:00:00+07:00',
        },
      ],
    };

    const result = await processPartographWebhook(db, hospitalId, payload, asSse(sse));

    expect(result.observationsAccepted).toBe(1);
    expect(result.observationsSkipped).toHaveLength(1);
    expect(result.observationsSkipped[0]).toEqual({
      an: 'AN-UNKNOWN',
      externalObservationId: 'EXT-MISS',
      reason: 'patient_not_found',
    });
  });

  it('broadcasts partograph_severity_changed only when severity transitions', async () => {
    await seedPatient(db, hospitalId, 'HN-1', 'AN-1');

    // Send an observation that triggers an alert (FHR=80 is bradycardia).
    // Patient starts with no severity, so this should be a transition.
    const payload: WebhookPartographPayload = {
      type: 'partograph',
      hospitalCode: '99901',
      observations: [
        {
          an: 'AN-1',
          externalObservationId: 'EXT-CRIT',
          observeDatetime: '2026-04-19T08:00:00+07:00',
          fetalHeartRate: 80, // CDSS will flag bradycardia
        },
      ],
    };

    await processPartographWebhook(db, hospitalId, payload, asSse(sse));

    const events = sse.getEventsByType('partograph_severity_changed');
    expect(events.length).toBeGreaterThanOrEqual(1);
    const data = events[0].data as Record<string, unknown>;
    expect(data.an).toBe('AN-1');
    expect(data.hcode).toBe('99901');
    expect(data.severity).toBeTruthy();
  });

  it('does NOT broadcast severity event when severity stays the same', async () => {
    await seedPatient(db, hospitalId, 'HN-1', 'AN-1');

    // First call: establish severity.
    await processPartographWebhook(
      db,
      hospitalId,
      {
        type: 'partograph',
        hospitalCode: '99901',
        observations: [
          {
            an: 'AN-1',
            externalObservationId: 'EXT-1',
            observeDatetime: '2026-04-19T08:00:00+07:00',
            fetalHeartRate: 140,
          },
        ],
      },
      asSse(sse),
    );

    sse.events = [];

    // Second call: same severity (also normal FHR).
    await processPartographWebhook(
      db,
      hospitalId,
      {
        type: 'partograph',
        hospitalCode: '99901',
        observations: [
          {
            an: 'AN-1',
            externalObservationId: 'EXT-2',
            observeDatetime: '2026-04-19T09:00:00+07:00',
            fetalHeartRate: 142,
          },
        ],
      },
      asSse(sse),
    );

    const events = sse.getEventsByType('partograph_severity_changed');
    expect(events).toHaveLength(0);
  });

  it("updates hospital connection_status to 'ONLINE' and bumps last_sync_at", async () => {
    await seedPatient(db, hospitalId, 'HN-1', 'AN-1');

    await processPartographWebhook(
      db,
      hospitalId,
      {
        type: 'partograph',
        hospitalCode: '99901',
        observations: [
          {
            an: 'AN-1',
            externalObservationId: 'EXT-1',
            observeDatetime: '2026-04-19T08:00:00+07:00',
            fetalHeartRate: 140,
          },
        ],
      },
      asSse(sse),
    );

    const rows = await db.query<{ connection_status: string; last_sync_at: string | null }>(
      'SELECT connection_status, last_sync_at FROM hospitals WHERE id = ?',
      [hospitalId],
    );
    expect(rows[0].connection_status).toBe('ONLINE');
    expect(rows[0].last_sync_at).not.toBeNull();
  });

  it('handles delete action through the upsert pipeline', async () => {
    await seedPatient(db, hospitalId, 'HN-1', 'AN-1');

    // Insert first.
    await processPartographWebhook(
      db,
      hospitalId,
      {
        type: 'partograph',
        hospitalCode: '99901',
        observations: [
          {
            an: 'AN-1',
            externalObservationId: 'EXT-DEL',
            observeDatetime: '2026-04-19T08:00:00+07:00',
            fetalHeartRate: 140,
          },
        ],
      },
      asSse(sse),
    );

    // Then delete.
    const result = await processPartographWebhook(
      db,
      hospitalId,
      {
        type: 'partograph',
        hospitalCode: '99901',
        observations: [
          {
            an: 'AN-1',
            externalObservationId: 'EXT-DEL',
            action: 'delete',
          },
        ],
      },
      asSse(sse),
    );

    expect(result.observationsAccepted).toBe(1); // counts deleted

    const remaining = await db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM cached_partograph_observations
         WHERE hospital_id = ? AND source_pk = ?`,
      [hospitalId, 'EXT-DEL'],
    );
    expect(remaining[0].count).toBe(0);
  });
});
