import { describe, it, expect } from 'vitest';
import fixture from '../../fixtures/partograph-hosxp-sample.json';
import { analyzePartograph } from '@/services/partogram';
import type { PartographObservationDto, CdssAlertDto } from '@/types/api';

describe('partograph CDSS parity — local HOSxP rows', () => {
  const obs = fixture as PartographObservationDto[];
  const alerts: CdssAlertDto[] = analyzePartograph({ an: '000055807' }, obs);

  it('flags row 1 amniotic blood-stained as ALERT', () => {
    expect(alerts.some((a) =>
      a.section === 'LIQUOR' && a.severity === 'ALERT' && a.obsIndex === 0,
    )).toBe(true);
  });

  it('flags row 1 moulding ++ as ALERT', () => {
    expect(alerts.some((a) =>
      a.section === 'MOULDING' && a.severity === 'ALERT' && a.obsIndex === 0,
    )).toBe(true);
  });

  it('flags row 2 temperature 37.8 as ALERT', () => {
    expect(alerts.some((a) =>
      a.section === 'TEMP' && a.severity === 'ALERT' && a.obsIndex === 1,
    )).toBe(true);
  });

  it('does NOT flag normal pulse 65/75 or BP 120/75 + 124/85', () => {
    expect(alerts.every((a) => a.section !== 'PULSE' && a.section !== 'BP'))
      .toBe(true);
  });

  it('does NOT flag normal FHR 115/125', () => {
    expect(alerts.every((a) => a.section !== 'FHR')).toBe(true);
  });

  it('total alert count is 3 (LIQUOR row 1 + MOULDING row 1 + TEMP row 2)', () => {
    expect(alerts).toHaveLength(3);
  });
});
