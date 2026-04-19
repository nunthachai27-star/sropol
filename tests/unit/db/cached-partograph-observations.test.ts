import { describe, it, expect } from 'vitest';
import { cachedPartographObservationsTable }
  from '@/db/tables/cached-partograph-observations';

describe('cachedPartographObservationsTable', () => {
  it('is named cached_partograph_observations', () => {
    expect(cachedPartographObservationsTable.name)
      .toBe('cached_partograph_observations');
  });

  it('has a unique index on (hospital_id, source_system, source_pk)', () => {
    const idx = cachedPartographObservationsTable.indexes!
      .find((i) => i.name === 'uniq_cpo_source');
    expect(idx).toBeDefined();
    expect(idx!.unique).toBe(true);
    expect(idx!.columns).toEqual(['hospital_id', 'source_system', 'source_pk']);
  });

  it('has a non-unique index on (patient_id, observe_datetime)', () => {
    const idx = cachedPartographObservationsTable.indexes!
      .find((i) => i.name === 'idx_cpo_patient');
    expect(idx).toBeDefined();
    expect(idx!.unique).toBe(false);
  });

  it('has all 22 WHO clinical fields plus audit columns', () => {
    const fieldNames = cachedPartographObservationsTable.fields
      .map((f) => f.name);
    const required = [
      'id', 'patient_id', 'hospital_id', 'source_system', 'source_pk',
      'observe_datetime', 'hour_no',
      'fetal_heart_rate', 'amniotic_fluid', 'amniotic_type_id',
      'amniotic_type_name', 'moulding',
      'cervical_dilation_cm', 'descent_of_head',
      'contraction_per_10min', 'contraction_duration_sec', 'contraction_strength',
      'oxytocin_uml', 'oxytocin_drops_min', 'drugs_iv_fluids',
      'pulse', 'bp_systolic', 'bp_diastolic', 'temperature',
      'urine_volume_ml', 'urine_protein', 'urine_glucose', 'urine_acetone',
      'note', 'entry_staff', 'entry_datetime',
      'synced_at', 'created_at', 'updated_at',
    ];
    for (const f of required) expect(fieldNames).toContain(f);
  });
});
