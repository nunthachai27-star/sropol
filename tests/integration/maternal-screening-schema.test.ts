// Task 5 (maternal labor-triage screening, Phase 2 dormant persistence) —
// schema-only test. No service code writes to this table yet; this proves
// SchemaSync creates maternal_screening_assessments with every column and
// index from spec §8.1, that its FKs resolve (including the self-referencing
// supersedes_id correction chain), and that the six cached_patients summary
// columns from spec §8.2 land as nullable projections (GC3: distinct from
// partograph_severity).
import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createTestDb } from '../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';

const ASSESSMENT_COLUMNS = [
  'id',
  'labor_admission_id',
  'hospital_id',
  'journey_id',
  'source_system',
  'source_pk',
  'assessed_at',
  'assessed_by',
  'input_json',
  'local_tier',
  'emergency_acuity',
  'is_complete',
  'suspected_conditions_json',
  'matches_json',
  'missing_fields_json',
  'rule_set_version',
  'supersedes_id',
  'created_at',
];

const SUMMARY_COLUMNS = [
  'maternal_screen_local_tier',
  'maternal_screen_emergency_acuity',
  'maternal_screen_condition_codes',
  'maternal_screen_assessed_at',
  'maternal_screen_is_complete',
  'maternal_screen_rule_set_version',
];

async function seedHospital(db: DatabaseAdapter): Promise<string> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO hospitals (id, hcode, name, level, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, String(Math.floor(10000 + Math.random() * 89999)), 'Test Hospital', 'A', true, now, now],
  );
  return id;
}

async function seedCachedPatient(db: DatabaseAdapter, hospitalId: string): Promise<string> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, hospitalId, 'HN1', 'AN1', 'enc-name', 28, now, now, now, now],
  );
  return id;
}

async function seedJourney(db: DatabaseAdapter, hospitalId: string): Promise<string> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO maternal_journeys
       (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida,
        registered_at, stage_changed_at, synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      hospitalId,
      hospitalId,
      'HN1',
      'enc-name',
      'enc-cid',
      'hash1',
      28,
      1,
      now,
      now,
      now,
      now,
      now,
    ],
  );
  return id;
}

function assessmentParams(overrides: {
  id: string;
  laborAdmissionId: string;
  hospitalId: string;
  journeyId: string | null;
  sourcePk?: string | null;
  supersedesId?: string | null;
}) {
  const now = new Date().toISOString();
  return [
    overrides.id,
    overrides.laborAdmissionId,
    overrides.hospitalId,
    overrides.journeyId,
    'WEBHOOK',
    overrides.sourcePk ?? null,
    now, // assessed_at
    'assessor-1', // assessed_by
    JSON.stringify({ vaginalBleeding: true }), // input_json
    'LOCAL_SEVERE', // local_tier
    'URGENT', // emergency_acuity
    false, // is_complete
    JSON.stringify(['SUSPECTED_ABRUPTION']), // suspected_conditions_json
    JSON.stringify([{ ruleId: 'APH-ABRUPTIO-PATTERN' }]), // matches_json
    JSON.stringify(['gaWeeks']), // missing_fields_json
    '0.1.0-provisional', // rule_set_version
    overrides.supersedesId ?? null,
    now, // created_at
  ];
}

const INSERT_SQL = `
  INSERT INTO maternal_screening_assessments (
    id, labor_admission_id, hospital_id, journey_id, source_system, source_pk,
    assessed_at, assessed_by, input_json, local_tier, emergency_acuity, is_complete,
    suspected_conditions_json, matches_json, missing_fields_json, rule_set_version,
    supersedes_id, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

describe('maternal_screening_assessments schema (Task 5, dormant)', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('is created by schema sync with every spec §8.1 column', async () => {
    const tables = await db.getTableNames();
    expect(tables).toContain('maternal_screening_assessments');

    const cols = await db.getColumnInfo('maternal_screening_assessments');
    const byName = new Map(cols.map((c) => [c.name, c]));
    for (const col of ASSESSMENT_COLUMNS) {
      expect(byName.has(col), `missing column ${col}`).toBe(true);
    }
    // Nullability spot-checks per the plan.
    expect(byName.get('labor_admission_id')?.nullable).toBe(false);
    expect(byName.get('hospital_id')?.nullable).toBe(false);
    expect(byName.get('journey_id')?.nullable).toBe(true);
    expect(byName.get('source_pk')?.nullable).toBe(true);
    expect(byName.get('assessed_by')?.nullable).toBe(true);
    expect(byName.get('supersedes_id')?.nullable).toBe(true);
    expect(byName.get('local_tier')?.nullable).toBe(false);
    expect(byName.get('emergency_acuity')?.nullable).toBe(false);
    expect(byName.get('is_complete')?.nullable).toBe(false);
  });

  it('has the three §8.1 indexes', async () => {
    const idx = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'maternal_screening_assessments'`,
    );
    const names = idx.map((r) => r.indexname);
    expect(names).toContain('idx_msa_hospital_source_pk');
    expect(names).toContain('idx_msa_admission_assessed');
    expect(names).toContain('idx_msa_hospital_acuity_assessed');
  });

  it('resolves FKs: hospital + cached_patient (+ optional journey) parent rows accept an assessment', async () => {
    const hospitalId = await seedHospital(db);
    const laborAdmissionId = await seedCachedPatient(db, hospitalId);
    const journeyId = await seedJourney(db, hospitalId);

    const id = uuidv4();
    await expect(
      db.execute(
        INSERT_SQL,
        assessmentParams({ id, laborAdmissionId, hospitalId, journeyId, sourcePk: 'src-1' }),
      ),
    ).resolves.not.toThrow();

    const rows = await db.query<{ id: string; local_tier: string; is_complete: boolean }>(
      `SELECT id, local_tier, is_complete FROM maternal_screening_assessments WHERE id = ?`,
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].local_tier).toBe('LOCAL_SEVERE');
    expect(rows[0].is_complete).toBe(false);
  });

  it('supports the self-referencing supersedes_id correction chain', async () => {
    const hospitalId = await seedHospital(db);
    const laborAdmissionId = await seedCachedPatient(db, hospitalId);

    const originalId = uuidv4();
    await db.execute(
      INSERT_SQL,
      assessmentParams({
        id: originalId,
        laborAdmissionId,
        hospitalId,
        journeyId: null,
        sourcePk: 'src-2',
      }),
    );

    const correctionId = uuidv4();
    await expect(
      db.execute(
        INSERT_SQL,
        assessmentParams({
          id: correctionId,
          laborAdmissionId,
          hospitalId,
          journeyId: null,
          sourcePk: 'src-2-correction',
          supersedesId: originalId,
        }),
      ),
    ).resolves.not.toThrow();

    const rows = await db.query<{ id: string; supersedes_id: string | null }>(
      `SELECT id, supersedes_id FROM maternal_screening_assessments WHERE id = ?`,
      [correctionId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].supersedes_id).toBe(originalId);
  });

  it('rejects an assessment with a bad labor_admission_id FK', async () => {
    const hospitalId = await seedHospital(db);
    await expect(
      db.execute(
        INSERT_SQL,
        assessmentParams({
          id: uuidv4(),
          laborAdmissionId: uuidv4(), // no such cached_patients row
          hospitalId,
          journeyId: null,
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects an assessment with a bad hospital_id FK', async () => {
    const hospitalId = await seedHospital(db);
    const laborAdmissionId = await seedCachedPatient(db, hospitalId);
    await expect(
      db.execute(
        INSERT_SQL,
        assessmentParams({
          id: uuidv4(),
          laborAdmissionId,
          hospitalId: uuidv4(), // no such hospital row
          journeyId: null,
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects an assessment with a bad supersedes_id FK', async () => {
    const hospitalId = await seedHospital(db);
    const laborAdmissionId = await seedCachedPatient(db, hospitalId);
    await expect(
      db.execute(
        INSERT_SQL,
        assessmentParams({
          id: uuidv4(),
          laborAdmissionId,
          hospitalId,
          journeyId: null,
          supersedesId: uuidv4(), // no such assessment row
        }),
      ),
    ).rejects.toThrow();
  });

  it('allows multiple NULL-source_pk rows for the same hospital+source_system (idempotency index semantics)', async () => {
    const hospitalId = await seedHospital(db);
    const laborAdmissionId = await seedCachedPatient(db, hospitalId);

    await db.execute(
      INSERT_SQL,
      assessmentParams({
        id: uuidv4(),
        laborAdmissionId,
        hospitalId,
        journeyId: null,
        sourcePk: null,
      }),
    );
    await expect(
      db.execute(
        INSERT_SQL,
        assessmentParams({
          id: uuidv4(),
          laborAdmissionId,
          hospitalId,
          journeyId: null,
          sourcePk: null,
        }),
      ),
    ).resolves.not.toThrow();
  });

  it('rejects a duplicate non-null (hospital_id, source_system, source_pk)', async () => {
    const hospitalId = await seedHospital(db);
    const laborAdmissionId = await seedCachedPatient(db, hospitalId);

    await db.execute(
      INSERT_SQL,
      assessmentParams({
        id: uuidv4(),
        laborAdmissionId,
        hospitalId,
        journeyId: null,
        sourcePk: 'dup-key',
      }),
    );
    await expect(
      db.execute(
        INSERT_SQL,
        assessmentParams({
          id: uuidv4(),
          laborAdmissionId,
          hospitalId,
          journeyId: null,
          sourcePk: 'dup-key',
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('cached_patients maternal_screen_* summary columns (Task 5, dormant)', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('adds all six summary columns, all nullable', async () => {
    const cols = await db.getColumnInfo('cached_patients');
    const byName = new Map(cols.map((c) => [c.name, c]));
    for (const col of SUMMARY_COLUMNS) {
      expect(byName.has(col), `missing column ${col}`).toBe(true);
      expect(byName.get(col)?.nullable, `${col} should be nullable`).toBe(true);
    }
    // GC3: must not collide with / reuse the unrelated partograph column.
    expect(byName.has('partograph_severity')).toBe(true);
  });

  it('accepts a row with all summary columns populated', async () => {
    const hospitalId = await seedHospital(db);
    const id = uuidv4();
    const now = new Date().toISOString();
    await expect(
      db.execute(
        `INSERT INTO cached_patients (
           id, hospital_id, hn, an, name, age, admit_date, synced_at, created_at, updated_at,
           maternal_screen_local_tier, maternal_screen_emergency_acuity,
           maternal_screen_condition_codes, maternal_screen_assessed_at,
           maternal_screen_is_complete, maternal_screen_rule_set_version
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          hospitalId,
          'HN2',
          'AN2',
          'enc-name-2',
          30,
          now,
          now,
          now,
          now,
          'LOCAL_SEVERE',
          'URGENT',
          'SUSPECTED_ABRUPTION',
          now,
          false,
          '0.1.0-provisional',
        ],
      ),
    ).resolves.not.toThrow();

    const rows = await db.query<{
      maternal_screen_local_tier: string;
      maternal_screen_is_complete: boolean;
    }>(
      `SELECT maternal_screen_local_tier, maternal_screen_is_complete FROM cached_patients WHERE id = ?`,
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].maternal_screen_local_tier).toBe('LOCAL_SEVERE');
    expect(rows[0].maternal_screen_is_complete).toBe(false);
  });

  it('leaves summary columns NULL when not supplied', async () => {
    const hospitalId = await seedHospital(db);
    const id = await seedCachedPatient(db, hospitalId);
    const rows = await db.query<{
      maternal_screen_local_tier: string | null;
      maternal_screen_assessed_at: Date | null;
    }>(
      `SELECT maternal_screen_local_tier, maternal_screen_assessed_at FROM cached_patients WHERE id = ?`,
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].maternal_screen_local_tier).toBeNull();
    expect(rows[0].maternal_screen_assessed_at).toBeNull();
  });
});
