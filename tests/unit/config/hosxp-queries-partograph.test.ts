// T16: Tests for the PARTOGRAPH_OBSERVATIONS SQL template (dual-dialect).
import { describe, it, expect } from 'vitest';
import { PARTOGRAPH_OBSERVATIONS, getQuery } from '@/config/hosxp-queries';

describe('PARTOGRAPH_OBSERVATIONS', () => {
  it('exists for both dialects', () => {
    expect(PARTOGRAPH_OBSERVATIONS.postgresql).toMatch(/ipt_labour_partograph/);
    expect(PARTOGRAPH_OBSERVATIONS.mysql).toMatch(/ipt_labour_partograph/);
  });

  it('joins labour_amniotic_type for the human-readable label', () => {
    expect(PARTOGRAPH_OBSERVATIONS.postgresql).toMatch(/labour_amniotic_type/);
    expect(PARTOGRAPH_OBSERVATIONS.mysql).toMatch(/labour_amniotic_type/);
  });

  it('filters to currently-admitted labour patients', () => {
    // House convention across every maternity query (see hosxp-queries.ts):
    // still-admitted = confirm_discharge = 'N', and labour = ipt_admit_type_id = 3.
    // (Previously gated on dchdate IS NULL, before the convention was unified.)
    for (const dialect of ['postgresql', 'mysql'] as const) {
      const sql = getQuery(PARTOGRAPH_OBSERVATIONS, dialect);
      expect(sql).toMatch(/confirm_discharge = 'N'/);
      expect(sql).toMatch(/ipt_admit_type_id = 3/);
    }
  });

  it('orders by AN then observe_datetime', () => {
    expect(PARTOGRAPH_OBSERVATIONS.postgresql).toMatch(/ORDER BY lp\.an, lp\.observe_datetime/);
  });
});
