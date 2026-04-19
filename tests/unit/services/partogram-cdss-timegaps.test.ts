import { describe, it, expect } from 'vitest';
import { _internals } from '@/services/partogram';
import { obs, tAt } from './partogram-cdss-fixtures';

const { analyzeTimeGaps } = _internals;

describe('analyzeTimeGaps — rule 32 (>4h gap in active phase → WARN)', () => {
  it('exactly 4h with dilation >= 4 → no alert (Pascal uses >, not >=)', () => {
    const list = [
      obs({ cervicalDilationCm: 5 }, tAt(0)),
      obs({ cervicalDilationCm: 5 }, tAt(4 * 60)),
    ];
    expect(analyzeTimeGaps(list)).toEqual([]);
  });
  it('4:01 with dilation >= 4 → WARN', () => {
    const list = [
      obs({ cervicalDilationCm: 5 }, tAt(0)),
      obs({ cervicalDilationCm: 5 }, tAt(4 * 60 + 1)),
    ];
    const a = analyzeTimeGaps(list);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      severity: 'WARN', section: 'TIME', obsIndex: 1,
    });
    expect(a[0].message).toMatch(/^เว้นการสังเกต \d+\.\d ชม\. \(ระยะ active\)$/);
  });
  it('6h gap but dilation < 4 (latent) → no alert', () => {
    const list = [
      obs({ cervicalDilationCm: 3 }, tAt(0)),
      obs({ cervicalDilationCm: 3 }, tAt(6 * 60)),
    ];
    expect(analyzeTimeGaps(list)).toEqual([]);
  });
  it('three obs spaced 5h apart in active phase → 2 WARNs (one per pair)', () => {
    const list = [
      obs({ cervicalDilationCm: 5 }, tAt(0)),
      obs({ cervicalDilationCm: 5 }, tAt(5 * 60)),
      obs({ cervicalDilationCm: 5 }, tAt(10 * 60)),
    ];
    const a = analyzeTimeGaps(list);
    expect(a).toHaveLength(2);
    expect(a.map((x) => x.obsIndex)).toEqual([1, 2]);
    expect(a.every((x) => x.severity === 'WARN' && x.section === 'TIME')).toBe(true);
  });
  it('single observation → no alerts (no pair to compare)', () => {
    expect(analyzeTimeGaps([obs({ cervicalDilationCm: 5 }, tAt(0))])).toEqual([]);
  });
});
