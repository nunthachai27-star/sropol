// Regression: รพ.ปราสาท (10918) had 6 current labor patients in its maternity
// ward (ตึกคลอด, is_maternity_ward='Y') that SR-LRMS showed as 0 — every active
// admission there has ipt_admit_type_id = NULL, so the hard "ipt_admit_type_id = 3"
// filter excluded all of them. HOSxP installs vary in whether they code the
// delivery admit type, so the filter must ADMIT NULL (the ward flag is the real
// labor-ward signal). Applies to the live browser-poll queries AND the legacy
// dual-dialect templates so both stay consistent.
import { describe, it, expect } from 'vitest';
import { ACTIVE_LABOR_PATIENTS, PARTOGRAPH_OBSERVATIONS } from '@/config/hosxp-queries';
import { SQL_ACTIVE_LABOUR, SQL_PARTOGRAPH } from '@/lib/browser-poll';

const QUERIES: Array<[string, string]> = [
  ['ACTIVE_LABOR_PATIENTS.postgresql', ACTIVE_LABOR_PATIENTS.postgresql],
  ['ACTIVE_LABOR_PATIENTS.mysql', ACTIVE_LABOR_PATIENTS.mysql],
  ['PARTOGRAPH_OBSERVATIONS.postgresql', PARTOGRAPH_OBSERVATIONS.postgresql],
  ['PARTOGRAPH_OBSERVATIONS.mysql', PARTOGRAPH_OBSERVATIONS.mysql],
  ['browser-poll SQL_ACTIVE_LABOUR', SQL_ACTIVE_LABOUR],
  ['browser-poll SQL_PARTOGRAPH', SQL_PARTOGRAPH],
];

describe('labor admit-type filter tolerates HOSxP installs that do not code it', () => {
  it.each(QUERIES)('%s — when it filters ipt_admit_type_id, it also admits NULL', (_name, sql) => {
    if (!sql.includes('ipt_admit_type_id')) return; // query doesn't gate on admit type
    expect(sql).toMatch(/ipt_admit_type_id\s+IS\s+NULL/i);
  });

  it.each(QUERIES)('%s — never uses a bare "ipt_admit_type_id = 3" without the NULL allowance', (_name, sql) => {
    // A bare equality with no IS NULL nearby silently drops un-coded hospitals.
    const bareEquality = /ipt_admit_type_id\s*=\s*3/i.test(sql);
    if (!bareEquality) return;
    expect(sql).toMatch(/ipt_admit_type_id\s+IS\s+NULL/i);
  });
});
