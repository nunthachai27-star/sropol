// T19: validatePartographPayload — payload shape validation for type:'partograph' webhook
import { describe, it, expect } from 'vitest';
import { validatePartographPayload } from '@/services/webhook';

const baseObs = {
  an: 'AN-001',
  externalObservationId: 'EXT-001',
  observeDatetime: '2026-04-19T08:00:00+07:00',
};

describe('validatePartographPayload', () => {
  it('rejects empty observations array', () => {
    const result = validatePartographPayload({
      type: 'partograph',
      hospitalCode: '99901',
      observations: [],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('observations');
  });

  it('rejects payload with 201 observations (cap is 200)', () => {
    const observations = Array.from({ length: 201 }, (_, i) => ({
      ...baseObs,
      an: `AN-${i}`,
      externalObservationId: `EXT-${i}`,
    }));
    const result = validatePartographPayload({
      type: 'partograph',
      hospitalCode: '99901',
      observations,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('200');
  });

  it('rejects observation missing "an"', () => {
    const result = validatePartographPayload({
      type: 'partograph',
      hospitalCode: '99901',
      observations: [{
        externalObservationId: 'EXT-1',
        observeDatetime: '2026-04-19T08:00:00+07:00',
      }],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('observations[0].an');
  });

  it('rejects observation missing "externalObservationId"', () => {
    const result = validatePartographPayload({
      type: 'partograph',
      hospitalCode: '99901',
      observations: [{
        an: 'AN-1',
        observeDatetime: '2026-04-19T08:00:00+07:00',
      }],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('observations[0].externalObservationId');
  });

  it('rejects externalObservationId longer than 64 chars', () => {
    const result = validatePartographPayload({
      type: 'partograph',
      hospitalCode: '99901',
      observations: [{
        an: 'AN-1',
        externalObservationId: 'X'.repeat(65),
        observeDatetime: '2026-04-19T08:00:00+07:00',
      }],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('externalObservationId');
    expect(result.error).toContain('64');
  });

  it('rejects observation missing observeDatetime when action != delete', () => {
    const result = validatePartographPayload({
      type: 'partograph',
      hospitalCode: '99901',
      observations: [{
        an: 'AN-1',
        externalObservationId: 'EXT-1',
      }],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('observeDatetime');
  });

  it('rejects garbage observeDatetime ("tomorrow")', () => {
    const result = validatePartographPayload({
      type: 'partograph',
      hospitalCode: '99901',
      observations: [{
        an: 'AN-1',
        externalObservationId: 'EXT-1',
        observeDatetime: 'tomorrow',
      }],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('observeDatetime');
  });

  it('accepts action:delete payload with only an + externalObservationId', () => {
    const result = validatePartographPayload({
      type: 'partograph',
      hospitalCode: '99901',
      observations: [{
        an: 'AN-1',
        externalObservationId: 'EXT-1',
        action: 'delete',
      }],
    });
    expect(result.valid).toBe(true);
    expect(result.payload).toBeDefined();
  });

  it('accepts out-of-clinical-range fetalHeartRate (soft warning, still valid)', () => {
    const result = validatePartographPayload({
      type: 'partograph',
      hospitalCode: '99901',
      observations: [{
        ...baseObs,
        fetalHeartRate: 12, // bizarre but accepted — CDSS will flag it
      }],
    });
    expect(result.valid).toBe(true);
  });

  it('accepts unknown contractionStrength string (passes through to CDSS)', () => {
    const result = validatePartographPayload({
      type: 'partograph',
      hospitalCode: '99901',
      observations: [{
        ...baseObs,
        contractionStrength: 'epic',
      }],
    });
    expect(result.valid).toBe(true);
  });

  it('accepts happy-path 3-row payload with full optional fields', () => {
    const result = validatePartographPayload({
      type: 'partograph',
      hospitalCode: '99901',
      observations: [
        {
          an: 'AN-A',
          externalObservationId: 'EXT-A',
          observeDatetime: '2026-04-19T08:00:00+07:00',
          hourNo: 1,
          fetalHeartRate: 140,
          amnioticFluid: 'C',
          amnioticTypeId: 1,
          moulding: '0',
          cervicalDilationCm: 4,
          descentOfHead: '4/5',
          contractionPer10Min: 3,
          contractionDurationSec: 30,
          contractionStrength: 'mild',
          oxytocinUml: null,
          oxytocinDropsMin: null,
          drugsIvFluids: '5%D/N/2 1000ml',
          pulse: 80,
          bpSystolic: 120,
          bpDiastolic: 80,
          temperature: 36.8,
          urineVolumeMl: 200,
          urineProtein: 'neg',
          urineGlucose: 'neg',
          urineAcetone: 'neg',
          note: 'first hour',
          entryStaff: 'NURSE-A',
          entryDatetime: '2026-04-19T08:05:00+07:00',
        },
        {
          an: 'AN-A',
          externalObservationId: 'EXT-B',
          observeDatetime: '2026-04-19T09:00:00+07:00',
          hourNo: 2,
          fetalHeartRate: 138,
          contractionStrength: 'moderate',
        },
        {
          an: 'AN-A',
          externalObservationId: 'EXT-C',
          observeDatetime: '2026-04-19T10:00:00+07:00',
          hourNo: 3,
          fetalHeartRate: 142,
          contractionStrength: 'strong',
        },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.payload).toBeDefined();
    expect(result.payload!.type).toBe('partograph');
    expect(result.payload!.observations).toHaveLength(3);
  });

  it('rejects null body', () => {
    const result = validatePartographPayload(null);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects array body (not an object)', () => {
    const result = validatePartographPayload([{ an: 'AN-1' }]);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects when observations is not an array (e.g. an object)', () => {
    const result = validatePartographPayload({
      type: 'partograph',
      hospitalCode: '99901',
      observations: { an: 'AN-1' },
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('observations');
  });
});
