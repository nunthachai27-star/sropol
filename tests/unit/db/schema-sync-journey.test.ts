import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';

describe('Schema Sync — Journey Tables', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it('creates maternal_journeys table with all columns', async () => {
    const cols = await db.getColumnInfo('maternal_journeys');
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('hospital_id');
    expect(colNames).toContain('current_hospital_id');
    expect(colNames).toContain('hn');
    expect(colNames).toContain('person_anc_id');
    expect(colNames).toContain('care_stage');
    expect(colNames).toContain('anc_risk_level');
    expect(colNames).toContain('lmp');
    expect(colNames).toContain('edc');
    expect(colNames).toContain('gravida');
    expect(colNames).toContain('para');
  });

  it('creates cached_anc_visits table', async () => {
    const cols = await db.getColumnInfo('cached_anc_visits');
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('journey_id');
    expect(colNames).toContain('visit_date');
    expect(colNames).toContain('ga_weeks');
    expect(colNames).toContain('fundal_height_cm');
    expect(colNames).toContain('bp_systolic');
    expect(colNames).toContain('fetal_hr');
  });

  it('creates cached_anc_risks table', async () => {
    const cols = await db.getColumnInfo('cached_anc_risks');
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('journey_id');
    expect(colNames).toContain('risk_level');
    expect(colNames).toContain('triggered_rules');
    expect(colNames).toContain('risk_factors');
  });

  it('creates cached_referrals table', async () => {
    const cols = await db.getColumnInfo('cached_referrals');
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('journey_id');
    expect(colNames).toContain('from_hospital_id');
    expect(colNames).toContain('to_hospital_id');
    expect(colNames).toContain('status');
    expect(colNames).toContain('urgency_level');
  });

  it('creates cached_newborns table', async () => {
    const cols = await db.getColumnInfo('cached_newborns');
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('journey_id');
    expect(colNames).toContain('infant_number');
    expect(colNames).toContain('birth_weight_g');
    expect(colNames).toContain('apgar_1min');
    expect(colNames).toContain('apgar_5min');
    expect(colNames).toContain('resuscitation');
    expect(colNames).toContain('vaccinations');
  });

  it('adds journey_id column to cached_patients', async () => {
    const cols = await db.getColumnInfo('cached_patients');
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('journey_id');
  });
});
