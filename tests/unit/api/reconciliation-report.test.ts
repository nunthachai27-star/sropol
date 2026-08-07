import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { UserRole, AncRiskLevel } from '@/types/domain';
import { testSessionUser } from '../../helpers/session';
import { createJourney } from '@/services/journey';

let db: DatabaseAdapter;
let mockSessionUser: Record<string, unknown> | null = null;

vi.mock('@/db/connection', () => ({ getDatabase: async () => db }));
vi.mock('@/lib/auth', () => ({
  auth: async () => (mockSessionUser ? { user: mockSessionUser } : null),
}));
vi.mock('@/lib/ensure-init', () => ({ ensureInit: async () => {} }));

import { GET } from '@/app/api/admin/reconciliation-report/route';

describe('GET /api/admin/reconciliation-report', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    mockSessionUser = null;
    vi.stubEnv('ADMIN_ALLOWED_CIDS', '');
    vi.stubEnv('NODE_ENV', 'development');
  });

  it('requires admin', async () => {
    mockSessionUser = testSessionUser({ hospitalCode: '10670', role: UserRole.NURSE });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('reports a journey whose level disagrees with its latest screening', async () => {
    mockSessionUser = testSessionUser({ hospitalCode: '10670', role: UserRole.ADMIN });
    const hosp = await db.query<{ id: string }>(`SELECT id FROM hospitals WHERE hcode = '10670'`);
    const journey = await createJourney(db, {
      hospitalId: hosp[0].id,
      hn: 'HN-B5',
      personAncId: null,
      name: '',
      cid: '',
      cidHash: 'hash-b5',
      age: 30,
      gravida: 1,
      para: 0,
      lmp: null,
      edc: null,
      ancRiskLevel: AncRiskLevel.LOW, // journey says LOW…
    });
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO cached_anc_risks (id, journey_id, risk_level, triggered_rules, risk_factors, screened_at, created_at)
       VALUES (?, ?, 'HR3', '[]', '{}', ?, ?)`, // …latest screening says HR3
      [crypto.randomUUID(), journey.id, now, now],
    );

    const res = await GET();
    expect(res.status).toBe(200);
    const report = await res.json();
    expect(report.totals.riskMismatches).toBe(1);
    // de-identified: no patient identifiers anywhere in the payload
    expect(JSON.stringify(report)).not.toContain('hash-b5');
  });
});
