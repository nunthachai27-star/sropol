import { describe, it, expect } from 'vitest';
import { _internals } from '@/services/partogram';
import { obs, tAt } from './partogram-cdss-fixtures';

const { analyzeLiquorMoulding } = _internals;

describe('analyzeLiquorMoulding — rule 5 (thick → CRITICAL liquor)', () => {
  it('amniotic "Thick" → CRITICAL (case-insensitive)', () => {
    const a = analyzeLiquorMoulding([obs({ amnioticFluid: 'Thick' }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'CRITICAL', section: 'LIQUOR', obsIndex: 0,
      message: 'น้ำคร่ำขี้เทาข้น',
    });
  });
  it('amniotic "thick mec" → CRITICAL only (thick wins, mec does not add second liquor alert)', () => {
    const a = analyzeLiquorMoulding([obs({ amnioticFluid: 'thick mec' }, tAt(0))]);
    expect(a.filter((x) => x.section === 'LIQUOR')).toHaveLength(1);
    expect(a[0].severity).toBe('CRITICAL');
  });
});

describe('analyzeLiquorMoulding — rule 6 (mec/moder/mild → ALERT liquor)', () => {
  it('"Meconium" → ALERT', () => {
    const a = analyzeLiquorMoulding([obs({ amnioticFluid: 'Meconium' }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'ALERT', section: 'LIQUOR', obsIndex: 0,
      message: 'น้ำคร่ำมีขี้เทา',
    });
  });
  it('"Moderate mec" → ALERT', () => {
    const a = analyzeLiquorMoulding([obs({ amnioticFluid: 'Moderate mec' }, tAt(0))]);
    expect(a[0].severity).toBe('ALERT');
    expect(a[0].message).toBe('น้ำคร่ำมีขี้เทา');
  });
  it('"Mild stain" → ALERT', () => {
    const a = analyzeLiquorMoulding([obs({ amnioticFluid: 'Mild stain' }, tAt(0))]);
    expect(a[0].severity).toBe('ALERT');
  });
});

describe('analyzeLiquorMoulding — rule 7 (blood → ALERT liquor)', () => {
  it('"Blood stained" → ALERT', () => {
    const a = analyzeLiquorMoulding([obs({ amnioticFluid: 'Blood stained' }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'ALERT', section: 'LIQUOR', obsIndex: 0,
      message: 'น้ำคร่ำปนเลือด',
    });
  });
});

describe('analyzeLiquorMoulding — non-matching liquor', () => {
  it('"Clear" → no liquor alert', () => {
    const a = analyzeLiquorMoulding([obs({ amnioticFluid: 'Clear' }, tAt(0))]);
    expect(a.filter((x) => x.section === 'LIQUOR')).toEqual([]);
  });
  it('null amnioticFluid → no liquor alert', () => {
    const a = analyzeLiquorMoulding([obs({ amnioticFluid: null }, tAt(0))]);
    expect(a.filter((x) => x.section === 'LIQUOR')).toEqual([]);
  });
});

describe('analyzeLiquorMoulding — rule 8 (+++ → CRITICAL moulding)', () => {
  it('"+++" → CRITICAL (else-if chain — does not also fire ALERT)', () => {
    const a = analyzeLiquorMoulding([obs({ moulding: '+++' }, tAt(0))]);
    expect(a.filter((x) => x.section === 'MOULDING')).toHaveLength(1);
    expect(a[0]).toMatchObject({
      severity: 'CRITICAL', section: 'MOULDING',
      message: 'กะโหลกเกยกันรุนแรง (+++)',
    });
  });
});

describe('analyzeLiquorMoulding — rule 9 (++ → ALERT moulding)', () => {
  it('"++" → ALERT', () => {
    const a = analyzeLiquorMoulding([obs({ moulding: '++' }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'ALERT', section: 'MOULDING', obsIndex: 0,
      message: 'กะโหลกเกยกัน (++)',
    });
  });
  it('"+" → no moulding alert', () => {
    const a = analyzeLiquorMoulding([obs({ moulding: '+' }, tAt(0))]);
    expect(a.filter((x) => x.section === 'MOULDING')).toEqual([]);
  });
  it('null moulding → no moulding alert', () => {
    const a = analyzeLiquorMoulding([obs({ moulding: null }, tAt(0))]);
    expect(a.filter((x) => x.section === 'MOULDING')).toEqual([]);
  });
});

describe('analyzeLiquorMoulding — combined', () => {
  it('liquor + moulding alerts on same obs', () => {
    const a = analyzeLiquorMoulding([
      obs({ amnioticFluid: 'Blood stained', moulding: '++' }, tAt(0)),
    ]);
    expect(a).toHaveLength(2);
    expect(a.find((x) => x.section === 'LIQUOR')?.severity).toBe('ALERT');
    expect(a.find((x) => x.section === 'MOULDING')?.severity).toBe('ALERT');
  });
});
