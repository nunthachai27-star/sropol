import { describe, it, expect } from 'vitest';
import { _internals } from '@/services/partogram';
import { obs, tAt } from './partogram-cdss-fixtures';

const { analyzeMaternal } = _internals;

describe('analyzeMaternal — rule 20 (pulse > 140 → CRITICAL)', () => {
  it('140 → ALERT (rule 21, not 20)', () => {
    const a = analyzeMaternal([obs({ pulse: 140 }, tAt(0))]);
    expect(a).toHaveLength(1);
    expect(a[0].severity).toBe('ALERT');
  });
  it('141 → CRITICAL', () => {
    const a = analyzeMaternal([obs({ pulse: 141 }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'CRITICAL', section: 'PULSE', obsIndex: 0,
      message: 'ชีพจร 141 ครั้ง/นาที (เร็วผิดปกติรุนแรง)',
    });
  });
});

describe('analyzeMaternal — rule 21 (pulse <60 || >=120 → ALERT)', () => {
  it('60 → no alert (boundary, not <60)', () => {
    expect(analyzeMaternal([obs({ pulse: 60 }, tAt(0))])).toEqual([]);
  });
  it('59 → ALERT', () => {
    const a = analyzeMaternal([obs({ pulse: 59 }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'ALERT', section: 'PULSE', obsIndex: 0,
      message: 'ชีพจร 59 ครั้ง/นาที (นอกช่วง 60-120)',
    });
  });
  it('119 → no alert', () => {
    expect(analyzeMaternal([obs({ pulse: 119 }, tAt(0))])).toEqual([]);
  });
  it('120 → ALERT (>=120)', () => {
    const a = analyzeMaternal([obs({ pulse: 120 }, tAt(0))]);
    expect(a[0].severity).toBe('ALERT');
  });
  it('139 → ALERT', () => {
    expect(analyzeMaternal([obs({ pulse: 139 }, tAt(0))])[0].severity).toBe('ALERT');
  });
  it('null/0 pulse → no alert', () => {
    expect(analyzeMaternal([obs({ pulse: null }, tAt(0))])).toEqual([]);
    expect(analyzeMaternal([obs({ pulse: 0 }, tAt(0))])).toEqual([]);
  });
});

describe('analyzeMaternal — rule 22 (BPSys >= 160 → CRITICAL)', () => {
  it('159 → ALERT (rule 23, not 22)', () => {
    const a = analyzeMaternal([obs({ bpSystolic: 159 }, tAt(0))]);
    expect(a[0].severity).toBe('ALERT');
  });
  it('160 → CRITICAL', () => {
    const a = analyzeMaternal([obs({ bpSystolic: 160 }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'CRITICAL', section: 'BP', obsIndex: 0,
      message: 'ความดันตัวบนสูงรุนแรง 160',
    });
  });
});

describe('analyzeMaternal — rule 23 (BPSys >= 140 → ALERT)', () => {
  it('139 → no alert', () => {
    expect(analyzeMaternal([obs({ bpSystolic: 139 }, tAt(0))])).toEqual([]);
  });
  it('140 → ALERT', () => {
    const a = analyzeMaternal([obs({ bpSystolic: 140 }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'ALERT', section: 'BP', obsIndex: 0,
      message: 'ความดันตัวบนสูง 140',
    });
  });
});

describe('analyzeMaternal — rule 24 (BPSys < 80 → ALERT)', () => {
  it('80 → no alert', () => {
    expect(analyzeMaternal([obs({ bpSystolic: 80 }, tAt(0))])).toEqual([]);
  });
  it('79 → ALERT', () => {
    const a = analyzeMaternal([obs({ bpSystolic: 79 }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'ALERT', section: 'BP', obsIndex: 0,
      message: 'ความดันตัวบนต่ำ 79',
    });
  });
});

describe('analyzeMaternal — rule 25 (BPDia >= 110 → CRITICAL)', () => {
  it('109 → ALERT (rule 26)', () => {
    const a = analyzeMaternal([obs({ bpDiastolic: 109 }, tAt(0))]);
    expect(a[0].severity).toBe('ALERT');
  });
  it('110 → CRITICAL', () => {
    const a = analyzeMaternal([obs({ bpDiastolic: 110 }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'CRITICAL', section: 'BP', obsIndex: 0,
      message: 'ความดันตัวล่างสูงรุนแรง 110',
    });
  });
});

describe('analyzeMaternal — rule 26 (BPDia >= 90 → ALERT)', () => {
  it('89 → no alert', () => {
    expect(analyzeMaternal([obs({ bpDiastolic: 89 }, tAt(0))])).toEqual([]);
  });
  it('90 → ALERT', () => {
    const a = analyzeMaternal([obs({ bpDiastolic: 90 }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'ALERT', section: 'BP', obsIndex: 0,
      message: 'ความดันตัวล่างสูง 90',
    });
  });
});

describe('analyzeMaternal — rule 27 (Temp >= 38.5 → CRITICAL)', () => {
  it('38.4 → ALERT', () => {
    const a = analyzeMaternal([obs({ temperature: 38.4 }, tAt(0))]);
    expect(a[0].severity).toBe('ALERT');
  });
  it('38.5 → CRITICAL', () => {
    const a = analyzeMaternal([obs({ temperature: 38.5 }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'CRITICAL', section: 'TEMP', obsIndex: 0,
      message: 'ไข้สูง 38.5 °C',
    });
  });
});

describe('analyzeMaternal — rule 28 (Temp >= 37.5 || <35 → ALERT)', () => {
  it('37.4 → no alert', () => {
    expect(analyzeMaternal([obs({ temperature: 37.4 }, tAt(0))])).toEqual([]);
  });
  it('37.5 → ALERT', () => {
    const a = analyzeMaternal([obs({ temperature: 37.5 }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'ALERT', section: 'TEMP', obsIndex: 0,
      message: 'อุณหภูมิ 37.5 °C ผิดปกติ',
    });
  });
  it('35.0 → no alert', () => {
    expect(analyzeMaternal([obs({ temperature: 35 }, tAt(0))])).toEqual([]);
  });
  it('34.9 → ALERT', () => {
    const a = analyzeMaternal([obs({ temperature: 34.9 }, tAt(0))]);
    expect(a).toContainEqual({
      severity: 'ALERT', section: 'TEMP', obsIndex: 0,
      message: 'อุณหภูมิ 34.9 °C ผิดปกติ',
    });
  });
});
