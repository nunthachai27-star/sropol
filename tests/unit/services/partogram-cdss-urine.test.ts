import { describe, it, expect } from 'vitest';
import { _internals } from '@/services/partogram';
import { obs, tAt } from './partogram-cdss-fixtures';

const { analyzeUrine } = _internals;

describe('analyzeUrine — rule 29 (urineProtein contains "++")', () => {
  it('"+" alone → no alert', () => {
    expect(analyzeUrine([obs({ urineProtein: '+' }, tAt(0))])).toEqual([]);
  });
  it('"++" → ALERT', () => {
    const a = analyzeUrine([obs({ urineProtein: '++' }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'ALERT', section: 'URINE', obsIndex: 0,
      message: 'โปรตีนในปัสสาวะสูง - ระวัง pre-eclampsia',
    });
  });
  it('"+++" → ALERT (also matches ++ substring)', () => {
    const a = analyzeUrine([obs({ urineProtein: '+++' }, tAt(0))]);
    expect(a).toHaveLength(1);
    expect(a[0].severity).toBe('ALERT');
  });
  it('null → no alert', () => {
    expect(analyzeUrine([obs({ urineProtein: null }, tAt(0))])).toEqual([]);
  });
});

describe('analyzeUrine — rule 30 (urineAcetone contains "++")', () => {
  it('"++" → ALERT', () => {
    const a = analyzeUrine([obs({ urineAcetone: '++' }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'ALERT', section: 'URINE', obsIndex: 0,
      message: 'คีโตนในปัสสาวะ - อาจมีภาวะขาดน้ำ',
    });
  });
});

describe('analyzeUrine — rule 31 (urineGlucose contains "++")', () => {
  it('"++" → ALERT', () => {
    const a = analyzeUrine([obs({ urineGlucose: '++' }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'ALERT', section: 'URINE', obsIndex: 0,
      message: 'กลูโคสในปัสสาวะ - ควรตรวจเบาหวาน',
    });
  });
});

describe('analyzeUrine — combined', () => {
  it('all three "++" on same obs → 3 alerts on same obsIndex', () => {
    const a = analyzeUrine([
      obs({ urineProtein: '++', urineAcetone: '++', urineGlucose: '++' }, tAt(0)),
    ]);
    expect(a).toHaveLength(3);
    expect(a.every((x) => x.section === 'URINE' && x.obsIndex === 0 && x.severity === 'ALERT'))
      .toBe(true);
  });
});
