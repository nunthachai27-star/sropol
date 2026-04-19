import { describe, it, expect } from 'vitest';
import { _internals } from '@/services/partogram';
import { obs, tAt } from './partogram-cdss-fixtures';

const { analyzeContractions } = _internals;

describe('analyzeContractions — rule 15 (>5/10min → ALERT)', () => {
  it('5/10 → no alert', () => {
    expect(analyzeContractions([obs({ contractionPer10Min: 5 }, tAt(0))])).toEqual([]);
  });
  it('6/10 → ALERT', () => {
    const a = analyzeContractions([obs({ contractionPer10Min: 6 }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'ALERT', section: 'CONTRACTIONS', obsIndex: 0,
      message: 'มดลูกหดตัวถี่: 6 ครั้ง/10 นาที',
    });
  });
});

describe('analyzeContractions — rule 16 (<=2 → ALERT, only when >0)', () => {
  it('2/10 → ALERT', () => {
    const a = analyzeContractions([obs({ contractionPer10Min: 2 }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'ALERT', section: 'CONTRACTIONS', obsIndex: 0,
      message: 'มดลูกหดตัวน้อย: 2 ครั้ง/10 นาที',
    });
  });
  it('3/10 → no alert', () => {
    expect(analyzeContractions([obs({ contractionPer10Min: 3 }, tAt(0))])).toEqual([]);
  });
  it('null → no alert (Pascal: ContrPer10Min > 0 gate)', () => {
    expect(analyzeContractions([obs({ contractionPer10Min: null }, tAt(0))])).toEqual([]);
  });
  it('0 → no alert (Pascal: ContrPer10Min > 0 gate)', () => {
    expect(analyzeContractions([obs({ contractionPer10Min: 0 }, tAt(0))])).toEqual([]);
  });
});

describe('analyzeContractions — rule 17 (sustained tachysystole >= 30 min)', () => {
  it('two 6/10 readings 30 min apart → CRITICAL on second + 2 ALERTs from rule 15', () => {
    const list = [
      obs({ contractionPer10Min: 6 }, tAt(0)),
      obs({ contractionPer10Min: 6 }, tAt(30)),
    ];
    const a = analyzeContractions(list);
    const crit = a.find((x) => x.severity === 'CRITICAL');
    expect(crit).toBeDefined();
    expect(crit!.message).toBe('มดลูกหดตัวถี่ต่อเนื่อง > 30 นาที');
    expect(crit!.obsIndex).toBe(1);
    // Plus two ALERTs from rule 15
    expect(a.filter((x) => x.severity === 'ALERT')).toHaveLength(2);
  });
  it('two 6/10 readings 29 min apart → no sustained-tachy CRITICAL', () => {
    const list = [
      obs({ contractionPer10Min: 6 }, tAt(0)),
      obs({ contractionPer10Min: 6 }, tAt(29)),
    ];
    const a = analyzeContractions(list);
    expect(a.some((x) => x.severity === 'CRITICAL')).toBe(false);
    expect(a.filter((x) => x.severity === 'ALERT')).toHaveLength(2);
  });
  it('normal reading interrupts tachy counter', () => {
    const list = [
      obs({ contractionPer10Min: 6 }, tAt(0)),
      obs({ contractionPer10Min: 4 }, tAt(15)),
      obs({ contractionPer10Min: 6 }, tAt(60)),
    ];
    const a = analyzeContractions(list);
    expect(a.some((x) => x.severity === 'CRITICAL')).toBe(false);
  });
});

describe('analyzeContractions — rule 18 (>60s → ALERT)', () => {
  it('60s → no alert', () => {
    expect(analyzeContractions([obs({ contractionDurationSec: 60 }, tAt(0))])).toEqual([]);
  });
  it('61s → ALERT', () => {
    const a = analyzeContractions([obs({ contractionDurationSec: 61 }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'ALERT', section: 'CONTRACTIONS', obsIndex: 0,
      message: 'ระยะเวลาหดรัดตัว 61 วินาที > 60 วินาที',
    });
  });
});

describe('analyzeContractions — rule 19 (<20s → ALERT, only when >0)', () => {
  it('20s → no alert', () => {
    expect(analyzeContractions([obs({ contractionDurationSec: 20 }, tAt(0))])).toEqual([]);
  });
  it('19s → ALERT', () => {
    const a = analyzeContractions([obs({ contractionDurationSec: 19 }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'ALERT', section: 'CONTRACTIONS', obsIndex: 0,
      message: 'ระยะเวลาหดรัดตัว 19 วินาที < 20 วินาที',
    });
  });
  it('null/0 duration → no alert', () => {
    expect(analyzeContractions([obs({ contractionDurationSec: null }, tAt(0))])).toEqual([]);
    expect(analyzeContractions([obs({ contractionDurationSec: 0 }, tAt(0))])).toEqual([]);
  });
});
