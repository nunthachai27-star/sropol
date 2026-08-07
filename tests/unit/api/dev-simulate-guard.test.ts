import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { randomUUID } from 'crypto';
import { UserRole, AncRiskLevel } from '@/types/domain';
import { testSessionUser } from '../../helpers/session';
import { FailingAdapter } from '../../helpers/failingDb';
import { createJourney } from '@/services/journey';

let db: DatabaseAdapter;
let mockSessionUser: Record<string, unknown> | null = null;

vi.mock('@/db/connection', () => ({ getDatabase: async () => db }));
vi.mock('@/lib/auth', () => ({
  auth: async () => (mockSessionUser ? { user: mockSessionUser } : null),
}));
vi.mock('@/lib/ensure-init', () => ({ ensureInit: async () => {} }));

import { POST as clearRoute } from '@/app/api/dev/simulate/clear/route';

describe('simulation route authorization', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    mockSessionUser = null;
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_SIMULATION_ENABLED', 'true');
    vi.stubEnv('ADMIN_ALLOWED_CIDS', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('404s under production defaults regardless of session', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mockSessionUser = testSessionUser({ hospitalCode: '10670', role: UserRole.ADMIN });
    const res = await clearRoute();
    expect(res.status).toBe(404);
  });

  it('401s without a session even when simulation is enabled', async () => {
    const res = await clearRoute();
    expect(res.status).toBe(401);
  });

  it('403s for a non-admin session', async () => {
    mockSessionUser = testSessionUser({ hospitalCode: '10670', role: UserRole.NURSE });
    const res = await clearRoute();
    expect(res.status).toBe(403);
  });

  it('403s for a readonly session even with the ADMIN role', async () => {
    mockSessionUser = testSessionUser({
      hospitalCode: '10670',
      role: UserRole.ADMIN,
      accessMode: 'readonly',
    });
    const res = await clearRoute();
    expect(res.status).toBe(403);
  });

  it('allows an admin readwrite session in development', async () => {
    mockSessionUser = testSessionUser({ hospitalCode: '10670', role: UserRole.ADMIN });
    const res = await clearRoute();
    expect(res.status).toBe(200);
  });

  async function seedOneJourney(target: DatabaseAdapter): Promise<string> {
    const hosp = await target.query<{ id: string }>(`SELECT id FROM hospitals WHERE hcode = ?`, [
      '10670',
    ]);
    const journey = await createJourney(target, {
      hospitalId: hosp[0].id,
      hn: 'HN-A3',
      personAncId: null,
      name: '',
      cid: '',
      cidHash: 'hash-a3',
      age: 28,
      gravida: 1,
      para: 0,
      lmp: null,
      edc: null,
      ancRiskLevel: AncRiskLevel.LOW,
    });
    return journey.id;
  }

  it('rolls back the ENTIRE wipe when one DELETE fails', async () => {
    mockSessionUser = testSessionUser({ hospitalCode: '10670', role: UserRole.ADMIN });
    const real = db;
    const journeyId = await seedOneJourney(real);
    // cached_anc_risks is 4th in the delete order — BEFORE cached_patients
    // (8th), where the failure is injected below. Its survival after the
    // 500 is the actual rollback proof: maternal_journeys alone (9th, i.e.
    // AFTER the failure point) would pass even with no transaction at all.
    const now = new Date().toISOString();
    await real.execute(
      `INSERT INTO cached_anc_risks (id, journey_id, risk_level, triggered_rules, risk_factors, screened_at, created_at)
       VALUES (?, ?, 'LOW', '[]', '{}', ?, ?)`,
      [randomUUID(), journeyId, now, now],
    );
    db = new FailingAdapter(real, /DELETE FROM cached_patients/);

    const res = await clearRoute();
    expect(res.status).toBe(500);

    // cpd_scores/anc_risks DELETEs ran before the injected failure — the
    // transaction must have rolled them back together with everything else.
    const journeys = await real.query<{ n: number }>(`SELECT COUNT(*) as n FROM maternal_journeys`);
    expect(Number(journeys[0].n)).toBe(1);
    const ancRisks = await real.query<{ n: number }>(`SELECT COUNT(*) as n FROM cached_anc_risks`);
    expect(Number(ancRisks[0].n)).toBe(1);
    db = real;
  });

  it('writes an audit_logs row with actor identity and row counts on success', async () => {
    mockSessionUser = testSessionUser({
      hospitalCode: '10670',
      role: UserRole.ADMIN,
      id: 'admin-a3',
      name: 'ผอ.ทดสอบ',
    });
    await seedOneJourney(db);

    const res = await clearRoute();
    expect(res.status).toBe(200);

    const audit = await db.query<{ action: string; user_id: string; metadata: unknown }>(
      `SELECT action, user_id, metadata FROM audit_logs WHERE action = ?`,
      ['dev_simulation_clear'],
    );
    expect(audit.length).toBe(1);
    expect(audit[0].user_id).toBe('admin-a3');
    const meta =
      typeof audit[0].metadata === 'string'
        ? JSON.parse(audit[0].metadata as string)
        : (audit[0].metadata as Record<string, unknown>);
    expect(meta.counts).toBeDefined();
    expect((meta.counts as Record<string, number>).maternal_journeys).toBe(1);
  });
});
