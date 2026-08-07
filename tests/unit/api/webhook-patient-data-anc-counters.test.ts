// WHO containment T6 — regression lock. /api/webhooks/patient-data already
// spreads the full processAncWebhook result (`...result`) into its response,
// so the T4/T5 anomaly counters (downgradesBlocked, visitConflicts) were
// already reaching the response JSON before this task — this test pins that
// down so a future refactor of the anc_data branch can't silently drop them.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { generateKey } from '@/lib/encryption';
import { createApiKey } from '@/services/webhook';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? generateKey();

let db: DatabaseAdapter;

vi.mock('@/db/connection', () => ({ getDatabase: async () => db }));
vi.mock('@/lib/ensure-init', () => ({ ensureInit: async () => {} }));

import { POST } from '@/app/api/webhooks/patient-data/route';

const HCODE = '10670';

function jsonRequest(body: unknown, rawKey: string): Request {
  return new Request('http://test/api/webhooks/patient-data', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${rawKey}` },
    body: JSON.stringify(body),
  });
}

const patient = (cid: string, riskLevel: string) => ({
  hn: 'WH-DOWNGRADE-1',
  name: 'นาง ทดสอบ เว็บฮุก',
  cid,
  birthday: '1994-06-20',
  pregNo: 1,
  riskLevel,
});

describe('POST /api/webhooks/patient-data (anc_data) — surfaces T4/T5 counters', () => {
  let hospitalId: string;
  let rawKey: string;

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    const rows = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [
      HCODE,
    ]);
    hospitalId = rows[0].id;
    const key = await createApiKey(db, hospitalId, 'test key');
    rawKey = key.rawKey;
  });

  it('response JSON includes downgradesBlocked and visitConflicts (additive to the existing anc_data shape)', async () => {
    const first = await POST(
      jsonRequest(
        { type: 'anc_data', hospitalCode: HCODE, patients: [patient('1007000100131', 'HR2')] },
        rawKey,
      ) as never,
    );
    expect(first.status).toBe(200);

    const second = await POST(
      jsonRequest(
        { type: 'anc_data', hospitalCode: HCODE, patients: [patient('1007000100140', 'LOW')] },
        rawKey,
      ) as never,
    );
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.success).toBe(true);
    expect(body.downgradesBlocked).toBe(1);
    expect(body.visitConflicts).toBe(0);
    // Existing fields untouched — additive only.
    expect(body.patientsProcessed).toBe(1);
  });
});
