// Phase 5 / Task W1 (docs/superpowers/plans/2026-07-16-maternal-screening-ward.md):
// propagate cached_patients.maternal_screen_* to the cached-path list
// projections that already carry partograph_severity —
// getHighRiskPatients (→ /api/dashboard/high-risk) and
// getHospitalPatientList (→ /api/hospitals/[hcode]/patients).
//
// Covers:
//  - flag ON (default): the four camelCase fields appear on both service
//    results, ISO string for assessedAt, real boolean for isComplete.
//  - the getHospitalPatientList leak fix: no raw `maternal_screen_*`
//    snake_case key survives on a list item, regardless of flag state (GC-W3).
//  - flag OFF (MATERNAL_SCREEN_UI_ENABLED=false): all four camelCase fields
//    are null on both results.
//  - NULL maternal_screen_* columns project to nulls without crashing.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createTestDb } from '../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import { getHighRiskPatients, getHospitalPatientList } from '@/services/dashboard';

describe('dashboard maternal-screen projection (W1)', () => {
  let db: DatabaseAdapter;
  let hospitalId: string;

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    const hospitals = await db.query<{ id: string }>(
      "SELECT id FROM hospitals WHERE hcode = '10670'",
    );
    hospitalId = hospitals[0].id;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function seedScreenedPatient(overrides: {
    localTier?: string | null;
    emergencyAcuity?: string | null;
    isComplete?: boolean | null;
    assessedAt?: string | null;
  }): Promise<{ id: string; an: string }> {
    const now = new Date().toISOString();
    const id = uuidv4();
    const an = `AN-MS-${id.slice(0, 8)}`;
    await db.execute(
      `INSERT INTO cached_patients
         (id, hospital_id, hn, an, name, age, ga_weeks, admit_date, labor_status,
          maternal_screen_local_tier, maternal_screen_emergency_acuity,
          maternal_screen_is_complete, maternal_screen_assessed_at,
          synced_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        hospitalId,
        `HN-${id.slice(0, 8)}`,
        an,
        'enc-name',
        28,
        38,
        now,
        'ACTIVE',
        overrides.localTier ?? null,
        overrides.emergencyAcuity ?? null,
        overrides.isComplete ?? null,
        overrides.assessedAt ?? null,
        now,
        now,
        now,
      ],
    );
    return { id, an };
  }

  it('flag ON (default): projects the four camelCase fields on getHighRiskPatients', async () => {
    const assessedAt = '2026-07-14T09:15:00.000Z';
    const { an } = await seedScreenedPatient({
      localTier: 'LOCAL_SEVERE',
      emergencyAcuity: 'EMERGENCY',
      isComplete: false,
      assessedAt,
    });

    const result = await getHighRiskPatients(db);
    const patient = result.find((p) => p.an === an);
    expect(patient).toBeDefined();
    expect(patient!.maternalScreenLocalTier).toBe('LOCAL_SEVERE');
    expect(patient!.maternalScreenEmergencyAcuity).toBe('EMERGENCY');
    expect(patient!.maternalScreenIsComplete).toBe(false);
    expect(patient!.maternalScreenAssessedAt).toBe(assessedAt);
  });

  it('flag ON (default): projects the four camelCase fields on getHospitalPatientList and strips the raw snake_case keys', async () => {
    const assessedAt = '2026-07-14T09:15:00.000Z';
    const { an } = await seedScreenedPatient({
      localTier: 'LOCAL_SEVERE',
      emergencyAcuity: 'EMERGENCY',
      isComplete: false,
      assessedAt,
    });

    const result = await getHospitalPatientList(db, '10670', { status: 'active' });
    const patients = result.patients as unknown as Array<Record<string, unknown>>;
    const item = patients.find((p) => p.an === an);
    expect(item).toBeDefined();
    expect(item!.maternalScreenLocalTier).toBe('LOCAL_SEVERE');
    expect(item!.maternalScreenEmergencyAcuity).toBe('EMERGENCY');
    expect(item!.maternalScreenIsComplete).toBe(false);
    expect(item!.maternalScreenAssessedAt).toBe(assessedAt);

    // Leak fix (GC-W3): none of the raw snake_case maternal_screen_* keys
    // from the `cp.*` spread may survive on the response item.
    expect(Object.keys(item!).every((k) => !k.startsWith('maternal_screen_'))).toBe(true);
  });

  it('flag OFF: nulls all four camelCase fields on getHighRiskPatients and getHospitalPatientList', async () => {
    vi.stubEnv('MATERNAL_SCREEN_UI_ENABLED', 'false');
    const { an } = await seedScreenedPatient({
      localTier: 'LOCAL_SEVERE',
      emergencyAcuity: 'EMERGENCY',
      isComplete: false,
      assessedAt: '2026-07-14T09:15:00.000Z',
    });

    const highRisk = await getHighRiskPatients(db);
    const hrPatient = highRisk.find((p) => p.an === an);
    expect(hrPatient).toBeDefined();
    expect(hrPatient!.maternalScreenLocalTier).toBeNull();
    expect(hrPatient!.maternalScreenEmergencyAcuity).toBeNull();
    expect(hrPatient!.maternalScreenIsComplete).toBeNull();
    expect(hrPatient!.maternalScreenAssessedAt).toBeNull();

    const list = await getHospitalPatientList(db, '10670', { status: 'active' });
    const listPatients = list.patients as unknown as Array<Record<string, unknown>>;
    const item = listPatients.find((p) => p.an === an);
    expect(item).toBeDefined();
    expect(item!.maternalScreenLocalTier).toBeNull();
    expect(item!.maternalScreenEmergencyAcuity).toBeNull();
    expect(item!.maternalScreenIsComplete).toBeNull();
    expect(item!.maternalScreenAssessedAt).toBeNull();

    // The leak fix is unconditional — raw keys stay stripped even off.
    expect(Object.keys(item!).every((k) => !k.startsWith('maternal_screen_'))).toBe(true);
  });

  it('NULL maternal_screen_* columns project to nulls on both functions without crashing', async () => {
    const { an } = await seedScreenedPatient({});

    const highRisk = await getHighRiskPatients(db);
    const hrPatient = highRisk.find((p) => p.an === an);
    expect(hrPatient).toBeDefined();
    expect(hrPatient!.maternalScreenLocalTier).toBeNull();
    expect(hrPatient!.maternalScreenEmergencyAcuity).toBeNull();
    expect(hrPatient!.maternalScreenIsComplete).toBeNull();
    expect(hrPatient!.maternalScreenAssessedAt).toBeNull();

    const list = await getHospitalPatientList(db, '10670', { status: 'active' });
    const listPatients = list.patients as unknown as Array<Record<string, unknown>>;
    const item = listPatients.find((p) => p.an === an);
    expect(item).toBeDefined();
    expect(item!.maternalScreenLocalTier).toBeNull();
    expect(item!.maternalScreenEmergencyAcuity).toBeNull();
    expect(item!.maternalScreenIsComplete).toBeNull();
    expect(item!.maternalScreenAssessedAt).toBeNull();
  });
});
