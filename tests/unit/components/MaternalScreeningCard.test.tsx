/* @vitest-environment jsdom */
// MaternalScreeningCard — Phase 4 U2
// (docs/superpowers/plans/2026-07-16-maternal-screening-ui.md, Task U2).
//
// GC-U1 regression lock: because the underlying rule set is
// PROVISIONAL_UNAPPROVED, nothing in this card may render green — not even
// STABLE / NO_LOCAL_MATCH. This file locks both the muted color AND the
// absence of any green value anywhere in the rendered tree.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MaternalScreeningCard } from '@/components/patient/MaternalScreeningCard';
import type { MaternalScreenAssessmentDto, MaternalScreenAssessmentsResponse } from '@/types/api';
import type { MaternalScreenInput, MaternalScreenMatch } from '@/types/maternal-screening';
import { assertNoGreenInTree } from '../../helpers/assertNoGreen';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const baseInput: MaternalScreenInput = {
  gaWeeks: null,
  gaDays: null,
  piHDiagnosed: null,
  systolicBp: null,
  diastolicBp: null,
  proteinuriaGrade: 'UNKNOWN',
  creatinineMgDl: null,
  creatinineBaselineMgDl: null,
  plateletPerUl: null,
  astIuL: null,
  altIuL: null,
  urineOutputMlPerHour: null,
  headache: 'UNKNOWN',
  blurredVision: null,
  epigastricPain: null,
  pulmonaryEdema: null,
  rightUpperQuadrantPain: null,
  vaginalBleeding: null,
  estimatedBleedingMl: null,
  bleedingRate: 'UNKNOWN',
  concealedBleedingSuspected: null,
  abdominalOrBackPain: null,
  uterineTenderness: null,
  frequentContractions: null,
  contractionDurationExceedsInterval: null,
  suprapubicTenderness: null,
  bandlsRing: null,
  membranesRuptured: null,
  abnormalPresentation: null,
  fetalHeartRateBpm: null,
  fetalTracingPattern: 'UNKNOWN',
  maternalPulseBpm: null,
  respiratoryRatePerMin: null,
  oxygenSaturationPct: null,
  consciousness: 'UNKNOWN',
  shockSignsPresent: null,
  placentaPreviaExcluded: null,
  placentaLocationSource: 'UNKNOWN',
};

function minutesAgo(mins: number): string {
  return new Date(Date.now() - mins * 60000).toISOString();
}

function buildAssessment(
  overrides: Partial<MaternalScreenAssessmentDto> = {},
): MaternalScreenAssessmentDto {
  return {
    id: 'assess-1',
    assessedAt: minutesAgo(5),
    assessedBy: null,
    sourceSystem: 'HOSXP',
    sourcePk: null,
    localTier: 'NO_LOCAL_MATCH',
    emergencyAcuity: 'STABLE',
    isComplete: true,
    suspectedConditions: [],
    matches: [],
    missingRequiredFields: [],
    ruleSetVersion: '0.1.0-provisional',
    input: baseInput,
    supersedesId: null,
    createdAt: minutesAgo(5),
    ...overrides,
  };
}

function buildResponse(
  overrides: Partial<MaternalScreenAssessmentsResponse> = {},
): MaternalScreenAssessmentsResponse {
  return {
    latest: null,
    history: [],
    nextCursor: null,
    uiEnabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

describe('MaternalScreeningCard — states', () => {
  it('renders an animate-pulse skeleton while loading, no banner', () => {
    const { container } = render(<MaternalScreeningCard data={null} isLoading={true} />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('maternal-screen-shadow-banner')).toBeNull();
  });

  it('renders an ErrorState banner with a working retry button on error', () => {
    const onRetry = vi.fn();
    render(
      <MaternalScreeningCard
        data={null}
        isLoading={false}
        error={new Error('boom')}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /ลองใหม่/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('maternal-screen-shadow-banner')).toBeNull();
  });

  it('shows the neutral empty-state text when there is no assessment data', () => {
    render(<MaternalScreeningCard data={buildResponse()} isLoading={false} />);
    expect(screen.getByText('ยังไม่มีข้อมูลการคัดกรอง')).toBeTruthy();
    expect(screen.queryByTestId('maternal-screen-shadow-banner')).toBeNull();
  });

  it('shows the empty-state text when the data prop itself is null (not loading, no error)', () => {
    render(<MaternalScreeningCard data={null} isLoading={false} />);
    expect(screen.getByText('ยังไม่มีข้อมูลการคัดกรอง')).toBeTruthy();
  });

  it('renders the shadow banner and latest chips when data is present', () => {
    const assessment = buildAssessment({ localTier: 'LOCAL_MILD', emergencyAcuity: 'STABLE' });
    render(
      <MaternalScreeningCard
        data={buildResponse({ latest: assessment, history: [] })}
        isLoading={false}
      />,
    );
    expect(screen.getByTestId('maternal-screen-shadow-banner')).toBeTruthy();
    expect(screen.getByTestId('maternal-screen-tier-chip')).toBeTruthy();
    expect(screen.getByTestId('maternal-screen-acuity-chip')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// GC-U1 — the shadow banner is always first, always present with data
// ---------------------------------------------------------------------------

describe('MaternalScreeningCard — shadow banner (GC-U1)', () => {
  it('always renders the verbatim shadow banner text + ruleSetVersion when data renders', () => {
    const assessment = buildAssessment({ ruleSetVersion: '0.1.0-provisional' });
    render(
      <MaternalScreeningCard
        data={buildResponse({ latest: assessment, history: [] })}
        isLoading={false}
      />,
    );
    const banner = screen.getByTestId('maternal-screen-shadow-banner');
    expect(banner.textContent).toContain(
      'การคัดกรองท้องถิ่น (ชุดกฎยังไม่ได้รับการรับรอง — โหมดเงา)',
    );
    expect(banner.textContent).toContain('0.1.0-provisional');
  });

  it('the banner is the first rendered section once data is present', () => {
    const assessment = buildAssessment();
    const { container } = render(
      <MaternalScreeningCard
        data={buildResponse({ latest: assessment, history: [] })}
        isLoading={false}
      />,
    );
    const card = screen.getByTestId('maternal-screening-card');
    // header (card title) is index 0; banner must be the very next section.
    const banner = screen.getByTestId('maternal-screen-shadow-banner');
    const children = Array.from(card.children);
    expect(children.indexOf(banner)).toBe(1);
    void container;
  });
});

// ---------------------------------------------------------------------------
// GC-U1 — nothing renders green
// ---------------------------------------------------------------------------

describe('MaternalScreeningCard — GC-U1 no-green lock', () => {
  it('STABLE + NO_LOCAL_MATCH: both chips resolve to the muted var, not green', () => {
    const assessment = buildAssessment({ localTier: 'NO_LOCAL_MATCH', emergencyAcuity: 'STABLE' });
    render(
      <MaternalScreeningCard
        data={buildResponse({ latest: assessment, history: [] })}
        isLoading={false}
      />,
    );
    const tierChip = screen.getByTestId('maternal-screen-tier-chip');
    const acuityChip = screen.getByTestId('maternal-screen-acuity-chip');
    expect(tierChip.style.color).toBe('var(--ink-navy-muted)');
    expect(acuityChip.style.color).toBe('var(--ink-navy-muted)');
  });

  it('no element anywhere in the rendered tree uses a green color/borderColor value', () => {
    const assessment = buildAssessment({
      localTier: 'LOCAL_SEVERE',
      emergencyAcuity: 'EMERGENCY',
      isComplete: false,
      missingRequiredFields: ['systolicBp'],
      suspectedConditions: ['PREECLAMPSIA'],
    });
    const history = [
      assessment,
      buildAssessment({ id: 'assess-0', localTier: 'NO_LOCAL_MATCH', emergencyAcuity: 'STABLE' }),
    ];
    const { container } = render(
      <MaternalScreeningCard
        data={buildResponse({ latest: assessment, history, nextCursor: 'cursor-1' })}
        isLoading={false}
      />,
    );
    // Shared scan (tests/helpers/assertNoGreen.ts, Phase 6 M1): checks the
    // full serialized style attribute — which covers color/borderColor/
    // background/backgroundColor in one pass — against hex, var(), AND the
    // rgb() forms jsdom normalizes inline hex colors into, plus a class-name
    // green scan.
    assertNoGreenInTree(container);
  });
});

// ---------------------------------------------------------------------------
// Severe + incomplete coexistence (GC1 — orthogonal axes)
// ---------------------------------------------------------------------------

describe('MaternalScreeningCard — severe + incomplete coexist', () => {
  it('LOCAL_SEVERE with isComplete:false shows the severe tier chip AND the incomplete marker together', () => {
    const assessment = buildAssessment({
      localTier: 'LOCAL_SEVERE',
      emergencyAcuity: 'EMERGENCY',
      isComplete: false,
      missingRequiredFields: ['systolicBp', 'diastolicBp'],
    });
    render(
      <MaternalScreeningCard
        data={buildResponse({ latest: assessment, history: [] })}
        isLoading={false}
      />,
    );
    const tierChip = screen.getByTestId('maternal-screen-tier-chip');
    expect(tierChip.dataset.tier).toBe('LOCAL_SEVERE');
    expect(tierChip.style.color).toBe('var(--risk-high)');

    const marker = screen.getByTestId('maternal-screen-incomplete-marker');
    expect(marker.textContent).toContain('การประเมินความเสี่ยงไม่สมบูรณ์ (ขาดข้อมูล 2 รายการ)');
  });
});

// ---------------------------------------------------------------------------
// Suspected-condition labels (GC4 — never a bare diagnosis)
// ---------------------------------------------------------------------------

describe('MaternalScreeningCard — suspected conditions', () => {
  it('renders the Thai "suspected" label for each suspected condition', () => {
    const assessment = buildAssessment({
      localTier: 'LOCAL_MODERATE',
      suspectedConditions: ['PREECLAMPSIA', 'ABRUPTIO_PLACENTAE'],
    });
    render(
      <MaternalScreeningCard
        data={buildResponse({ latest: assessment, history: [] })}
        isLoading={false}
      />,
    );
    expect(screen.getByText('สงสัยภาวะครรภ์เป็นพิษ')).toBeTruthy();
    expect(screen.getByText('สงสัยรกลอกตัวก่อนกำหนด')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Matched rules + evidence
// ---------------------------------------------------------------------------

describe('MaternalScreeningCard — matches and evidence', () => {
  it('renders matched rule IDs and per-match evidence rows verbatim', () => {
    const matches: MaternalScreenMatch[] = [
      {
        purpose: 'LOCAL_PDF_TIER',
        ruleId: 'RULE-PREE-01',
        controllingSourceId: 'src-1',
        supportingSourceIds: [],
        localTier: 'LOCAL_MODERATE',
        condition: 'PREECLAMPSIA',
        evidence: [{ field: 'systolicBp', value: 150 }],
      },
    ];
    const assessment = buildAssessment({ localTier: 'LOCAL_MODERATE', matches });
    render(
      <MaternalScreeningCard
        data={buildResponse({ latest: assessment, history: [] })}
        isLoading={false}
      />,
    );
    expect(screen.getByText(/RULE-PREE-01/)).toBeTruthy();
    expect(screen.getByText('systolicBp: 150')).toBeTruthy();
  });

  it('renders missing required field keys when present', () => {
    const assessment = buildAssessment({
      isComplete: false,
      missingRequiredFields: ['systolicBp', 'proteinuriaGrade'],
    });
    render(
      <MaternalScreeningCard
        data={buildResponse({ latest: assessment, history: [] })}
        isLoading={false}
      />,
    );
    const missing = screen.getByTestId('maternal-screen-missing-fields');
    expect(missing.textContent).toContain('systolicBp');
    expect(missing.textContent).toContain('proteinuriaGrade');
  });
});

// ---------------------------------------------------------------------------
// History — supersession marker + nextCursor note
// ---------------------------------------------------------------------------

describe('MaternalScreeningCard — history', () => {
  it('shows the supersession marker on a corrected history row', () => {
    const original = buildAssessment({ id: 'assess-orig', supersedesId: null });
    const correction = buildAssessment({ id: 'assess-correction', supersedesId: 'assess-orig' });
    render(
      <MaternalScreeningCard
        data={buildResponse({ latest: correction, history: [correction, original] })}
        isLoading={false}
      />,
    );
    const rows = screen.getAllByTestId('maternal-screen-history-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('แก้ไขแทนรายการก่อนหน้า')).toBeTruthy();
  });

  it('shows the "more history" note when nextCursor is non-null', () => {
    const assessment = buildAssessment();
    render(
      <MaternalScreeningCard
        data={buildResponse({
          latest: assessment,
          history: [assessment],
          nextCursor: 'cursor-abc',
        })}
        isLoading={false}
      />,
    );
    expect(screen.getByText('มีประวัติเพิ่มเติม')).toBeTruthy();
  });

  it('omits the "more history" note when nextCursor is null', () => {
    const assessment = buildAssessment();
    render(
      <MaternalScreeningCard
        data={buildResponse({ latest: assessment, history: [assessment], nextCursor: null })}
        isLoading={false}
      />,
    );
    expect(screen.queryByText('มีประวัติเพิ่มเติม')).toBeNull();
  });

  // F4 — history-only: no `latest` row (e.g. it fell off the current page
  // of history, or the API only returned superseded rows), but a history
  // row exists. The shadow banner must still render (using the history
  // row's ruleSetVersion, since `latest` is null) and the row itself must
  // render — this is still "hasData" per the card's own hasData check.
  it('renders the shadow banner (with the history row ruleSetVersion) and the row when latest is null but history has one row', () => {
    const historyOnly = buildAssessment({
      id: 'assess-hist-only',
      ruleSetVersion: '0.2.0-provisional',
    });
    render(
      <MaternalScreeningCard
        data={buildResponse({ latest: null, history: [historyOnly], nextCursor: null })}
        isLoading={false}
      />,
    );
    const banner = screen.getByTestId('maternal-screen-shadow-banner');
    expect(banner.textContent).toContain('0.2.0-provisional');
    expect(screen.getAllByTestId('maternal-screen-history-row')).toHaveLength(1);
    expect(screen.queryByTestId('maternal-screen-latest')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F2 — stale-while-error: background revalidation errors must not blank a
// card that already has data on screen (Constitution VI).
// ---------------------------------------------------------------------------

describe('MaternalScreeningCard — stale-while-error (F2)', () => {
  it('error + data present: the severe assessment stays visible, no ErrorState', () => {
    const assessment = buildAssessment({ localTier: 'LOCAL_SEVERE', emergencyAcuity: 'EMERGENCY' });
    render(
      <MaternalScreeningCard
        data={buildResponse({ latest: assessment, history: [] })}
        isLoading={false}
        error={new Error('background revalidation failed')}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    const tierChip = screen.getByTestId('maternal-screen-tier-chip');
    expect(tierChip.dataset.tier).toBe('LOCAL_SEVERE');
    expect(screen.getByTestId('maternal-screen-shadow-banner')).toBeTruthy();
  });

  it('error + no data: ErrorState with retry still renders (existing behavior)', () => {
    const onRetry = vi.fn();
    render(
      <MaternalScreeningCard
        data={buildResponse({ latest: null, history: [] })}
        isLoading={false}
        error={new Error('boom')}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /ลองใหม่/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('maternal-screen-shadow-banner')).toBeNull();
  });
});
