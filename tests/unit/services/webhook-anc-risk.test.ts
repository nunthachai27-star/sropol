// ANC webhook risk screening — the browser/webhook path must persist a
// cached_anc_risks row (level + Thai item labels + recommendation) so the
// journey detail "Risk assessment" panel populates, deduped so unchanged
// classifications don't grow the table on every push.
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { generateKey } from '@/lib/encryption';
import { processAncWebhook, type WebhookAncPayload } from '@/services/webhook';
import { ANC_RISK_CONFIGS } from '@/config/anc-risk-rules';
import { AncRiskLevel } from '@/types/domain';
import type { SseManager } from '@/lib/sse';

const HOSPITAL_ID = 'hosp-anc-risk';

class MockSseManager {
  broadcast(): void {}
}
function asSse(mock: MockSseManager): SseManager {
  return mock as unknown as SseManager;
}

function payload(
  riskItemIds: number[] | undefined,
  riskLevel: string | undefined,
): WebhookAncPayload {
  return {
    type: 'anc_data',
    hospitalCode: '99902',
    patients: [
      {
        hn: 'HN-R1',
        name: 'นาง ทดสอบ ความเสี่ยง',
        cid: '1100500090006', // checksum-valid synthetic CID
        birthday: '1994-02-01',
        pregNo: 1,
        lmp: '2026-01-01T00:00:00Z',
        edc: '2026-10-08T00:00:00Z',
        riskLevel,
        riskItemIds,
      },
    ],
  } as WebhookAncPayload;
}

describe('processAncWebhook — risk screening persistence', () => {
  let db: DatabaseAdapter;
  let sse: SseManager;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = generateKey();
  });

  beforeEach(async () => {
    db = await createTestDb();
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, '99902', 'รพ.ทดสอบ Risk', 'F1', true, 'ONLINE', ?, ?)`,
      [HOSPITAL_ID, now, now],
    );
    sse = asSse(new MockSseManager());
  });

  afterEach(async () => {
    await db.close();
  });

  async function riskRows(): Promise<
    Array<{ risk_level: string; triggered_rules: string[]; recommended_facility: string | null }>
  > {
    return db.query(
      `SELECT risk_level, triggered_rules, recommended_facility
         FROM cached_anc_risks ORDER BY screened_at, created_at`,
    );
  }

  it('records a screening row with Thai labels and the provincial recommendation', async () => {
    await processAncWebhook(db, HOSPITAL_ID, payload([3, 16], 'HR3'), sse);

    const rows = await riskRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].risk_level).toBe('HR3');
    // pg returns the JSONB column already parsed (a string[]) — no JSON.parse needed.
    const rules = rows[0].triggered_rules;
    expect(rules.some((r) => /หัวใจ/.test(r))).toBe(true);
    expect(rows[0].recommended_facility).toBe(ANC_RISK_CONFIGS[AncRiskLevel.HR3].facilityTh);
  });

  it('dedupes: an unchanged classification does not insert another row', async () => {
    await processAncWebhook(db, HOSPITAL_ID, payload([3, 16], 'HR3'), sse);
    await processAncWebhook(db, HOSPITAL_ID, payload([3, 16], 'HR3'), sse);

    expect(await riskRows()).toHaveLength(1);
  });

  it('a changed classification appends a new screening row AND the journey follows the positive-evidence downgrade', async () => {
    await processAncWebhook(db, HOSPITAL_ID, payload([3, 16], 'HR3'), sse);
    await processAncWebhook(db, HOSPITAL_ID, payload([3], 'HR1'), sse);

    const rows = await riskRows();
    expect(rows).toHaveLength(2);
    expect(rows[1].risk_level).toBe('HR1');

    // Non-empty riskItemIds is POSITIVE current evidence, so lowering IS
    // allowed — the journey follows down to HR1 (contrast with empty [] or
    // declared-only payloads, which are blocked as missing evidence).
    const journey = await db.query<{ anc_risk_level: string }>(
      `SELECT anc_risk_level FROM maternal_journeys LIMIT 1`,
    );
    expect(journey[0].anc_risk_level).toBe('HR1');
  });

  it('LOW with no items still records the baseline screening once', async () => {
    await processAncWebhook(db, HOSPITAL_ID, payload([], 'LOW'), sse);
    await processAncWebhook(db, HOSPITAL_ID, payload([], 'LOW'), sse);

    const rows = await riskRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].risk_level).toBe('LOW');
  });

  it('legacy clients without riskItemIds do not write screening rows', async () => {
    await processAncWebhook(db, HOSPITAL_ID, payload(undefined, 'HR2'), sse);

    expect(await riskRows()).toHaveLength(0);
  });

  // ─── Canonical risk resolution: derived severity can never be understated ───

  it('declared LOW cannot mask HR3 items — screening AND journey store HR3', async () => {
    await processAncWebhook(db, HOSPITAL_ID, payload([16], 'LOW'), sse);
    const screening = await db.query<{ risk_level: string }>(
      `SELECT risk_level FROM cached_anc_risks ORDER BY created_at DESC LIMIT 1`,
    );
    expect(screening[0].risk_level).toBe('HR3');
    const journey = await db.query<{ anc_risk_level: string }>(
      `SELECT anc_risk_level FROM maternal_journeys LIMIT 1`,
    );
    expect(journey[0].anc_risk_level).toBe('HR3');
  });

  it('declared level HIGHER than derived is preserved (upward clinical override)', async () => {
    await processAncWebhook(db, HOSPITAL_ID, payload([], 'HR2'), sse);
    const journey = await db.query<{ anc_risk_level: string }>(
      `SELECT anc_risk_level FROM maternal_journeys LIMIT 1`,
    );
    expect(journey[0].anc_risk_level).toBe('HR2');
  });

  it('missing declared level with items still derives the level for the journey', async () => {
    await processAncWebhook(db, HOSPITAL_ID, payload([16], undefined), sse);
    const journey = await db.query<{ anc_risk_level: string }>(
      `SELECT anc_risk_level FROM maternal_journeys LIMIT 1`,
    );
    expect(journey[0].anc_risk_level).toBe('HR3');
  });
});
