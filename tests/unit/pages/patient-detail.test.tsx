// Patient detail page — behavior tests for the 2026-07-09 redesign:
// per-patient sync freshness stamp, referral history strip, and newborn
// outcomes card (both from the linked maternal journey).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import { Suspense } from 'react';
import PatientDetailPage from '@/app/(provincial)/patients/[an]/page';
import type { MaternalScreenAssessmentDto } from '@/types/api';
import type { MaternalScreenInput } from '@/types/maternal-screening';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock('@/hooks/useSSE', () => ({ useSSE: vi.fn() }));

// Task U3 — mock the shadow-mode screening hook. `vi.mock` factories are
// hoisted above all other module code, so the mock fn itself must be created
// via `vi.hoisted` to avoid a temporal-dead-zone ReferenceError. Default is
// flag-off, matching production; tests that need the flag on override via
// `mockUseMaternalScreenings.mockReturnValue(...)`.
const { mockUseMaternalScreenings } = vi.hoisted(() => ({ mockUseMaternalScreenings: vi.fn() }));
vi.mock('@/hooks/useMaternalScreenings', () => ({
  useMaternalScreenings: mockUseMaternalScreenings,
}));

// jsdom has no IntersectionObserver; StickyPatientHeader observes the main
// header to decide when to pin itself.
vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const HOURS = 3600_000;

const patient = {
  id: 'pat-1',
  hn: 'HN001',
  an: '69000123',
  name: 'นาง สายฝน อุ่นเรือน',
  age: 28,
  gravida: 2,
  para: 1,
  abortion: 0,
  livingChildren: 1,
  pregNo: 2,
  gaWeeks: 39,
  gaDay: 2,
  ancCount: 6,
  admitDate: new Date(Date.now() - 6 * HOURS).toISOString(),
  heightCm: 158,
  weightKg: 62,
  weightDiffKg: 11,
  prePregnancyWeightKg: 51,
  fundalHeightCm: 34,
  usWeightG: 3100,
  hematocritPct: 34,
  bpSystolicAdmit: 118,
  bpDiastolicAdmit: 76,
  pulseAdmit: 82,
  rrAdmit: 18,
  temperatureAdmit: 36.8,
  cervicalOpenCmAdmit: 4,
  effacementPctAdmit: 80,
  stationAdmit: '-1',
  laborStatus: 'ACTIVE',
  hospital: { hcode: '10670', name: 'รพ.ขอนแก่น', level: 'A_S' },
  syncedAt: new Date(Date.now() - 10 * 60_000).toISOString(), // 10 min ago
};

const journeyContext = {
  journeyId: 'j-1',
  careStage: 'LABOR',
  ancRiskLevel: 'HR2',
  ancVisitCount: 6,
  lastAncDate: new Date(Date.now() - 5 * 24 * HOURS).toISOString(),
  lmp: null,
  edc: new Date(Date.now() + 5 * 24 * HOURS).toISOString(),
  referrals: [
    {
      id: 'ref-1',
      journeyId: 'j-1',
      referNumber: 'REF-2569-042',
      fromHospital: 'รพ.พล',
      toHospital: 'รพ.ขอนแก่น',
      status: 'INITIATED',
      reason: 'ครรภ์เสี่ยงสูง ส่งต่อคลอด',
      diagnosisCode: 'O24.4',
      urgencyLevel: 'URGENT',
      initiatedAt: new Date(Date.now() - 20 * HOURS).toISOString(),
      arrivedAt: null,
    },
  ],
  newborns: [
    {
      infantNumber: 1,
      sex: 'F',
      birthWeightG: 2300,
      apgar1min: 7,
      apgar5min: 6,
      bornAt: new Date(Date.now() - 2 * HOURS).toISOString(),
    },
  ],
};

vi.mock('@/hooks/usePatient', () => ({
  usePatient: () => ({
    patient,
    cpdScore: null,
    journeyContext,
    vitals: [],
    contractions: [],
    isLoading: false,
    error: null,
    vitalsError: null,
    contractionsError: null,
    mutate: vi.fn(),
    mutateVitals: vi.fn(),
    mutateContractions: vi.fn(),
  }),
}));

vi.mock('@/hooks/usePartogram', () => ({
  usePartogram: () => ({ partogram: null, error: undefined, mutate: vi.fn() }),
}));

// Default: flag off, matching production — existing tests above must render
// identically to before this feature existed without touching their
// assertions.
beforeEach(() => {
  mockUseMaternalScreenings.mockReturnValue({
    uiEnabled: false,
    latest: null,
    history: [],
    nextCursor: null,
    isLoading: false,
    error: null,
    mutate: vi.fn(),
  });
});

// Minimal valid MaternalScreenInput — every field required, all-UNKNOWN/null
// is a legitimate (if maximally incomplete) input snapshot (mirrors the
// fixture in tests/unit/components/MaternalScreeningCard.test.tsx).
const maternalScreenInput: MaternalScreenInput = {
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

const severeMaternalScreenAssessment: MaternalScreenAssessmentDto = {
  id: 'assess-severe-1',
  assessedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  assessedBy: null,
  sourceSystem: 'HOSXP',
  sourcePk: null,
  localTier: 'LOCAL_SEVERE',
  emergencyAcuity: 'EMERGENCY',
  isComplete: true,
  suspectedConditions: [],
  matches: [],
  missingRequiredFields: [],
  ruleSetVersion: '0.1.0-provisional',
  input: maternalScreenInput,
  supersedesId: null,
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
};

async function renderPage() {
  // use(params) suspends on first render — the App Router provides the
  // boundary in production, the test provides its own. The act() must be
  // awaited so React retries after the params promise resolves.
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <PatientDetailPage params={Promise.resolve({ an: '10670-69000123' })} />
      </Suspense>,
    );
  });
}

describe('PatientDetailPage — redesign', () => {
  it('shows the per-patient HOSxP sync freshness stamp', async () => {
    await renderPage();
    expect(await screen.findByTestId('sync-stamp')).toBeInTheDocument();
    expect(screen.getByText(/ข้อมูลจาก HOSxP/)).toBeInTheDocument();
  });

  it('renders the referral history from the linked journey with a board link', async () => {
    await renderPage();

    const strip = await screen.findByTestId('patient-referrals');
    expect(within(strip).getByText('REF-2569-042')).toBeInTheDocument();
    expect(within(strip).getByText(/รพ.พล/)).toBeInTheDocument();
    expect(within(strip).getByText('รอดำเนินการ')).toBeInTheDocument(); // INITIATED pill
    expect(within(strip).getByText('เร่งด่วน')).toBeInTheDocument(); // URGENT pill
  });

  it('renders newborn outcomes with LBW and low-Apgar emphasis', async () => {
    await renderPage();

    const card = await screen.findByTestId('patient-newborns');
    expect(within(card).getByText(/2,300/)).toBeInTheDocument();
    expect(within(card).getByText('LBW')).toBeInTheDocument();
    const apgar = within(card).getByTestId('newborn-apgar-1');
    expect(apgar.getAttribute('data-low')).toBe('true');
  });
});

// Task U3 — maternal-screening shadow card is flag-gated server-side
// (GC-U3): with the flag off (production default), the section must not
// render at all.
describe('PatientDetailPage — maternal screening shadow card (flag-gated)', () => {
  it('flag off: no shadow banner and no section title', async () => {
    await renderPage();

    expect(screen.queryByTestId('maternal-screen-shadow-banner')).toBeNull();
    expect(screen.queryByText('การคัดกรองความเสี่ยงมารดา (รอคลอด)')).toBeNull();
    expect(screen.queryByTestId('patient-maternal-screening')).toBeNull();
  });

  // F1 — flag-off pages must never surface the screenings feed in the
  // shared failedFeeds banner: a feature staff can't see should not produce
  // banner noise naming it. The route logs the failure server-side; the
  // operator enabling the flag verifies the section during rollout
  // (spec §17.2 step 4).
  it('flag off + fetch error: the failedFeeds banner does not mention maternal screening, and the section stays absent', async () => {
    mockUseMaternalScreenings.mockReturnValue({
      uiEnabled: false,
      latest: null,
      history: [],
      nextCursor: null,
      isLoading: false,
      error: new Error('boom'),
      mutate: vi.fn(),
    });

    await renderPage();

    const banners = screen.queryAllByRole('alert');
    banners.forEach((banner) => {
      expect(banner.textContent).not.toContain('การคัดกรองความเสี่ยงมารดา');
    });
    expect(screen.queryByTestId('patient-maternal-screening')).toBeNull();
  });

  it('flag on: section, shadow banner, and LOCAL_SEVERE tier chip render', async () => {
    mockUseMaternalScreenings.mockReturnValue({
      uiEnabled: true,
      latest: severeMaternalScreenAssessment,
      history: [severeMaternalScreenAssessment],
      nextCursor: null,
      isLoading: false,
      error: null,
      mutate: vi.fn(),
    });

    await renderPage();

    expect(screen.getByText('การคัดกรองความเสี่ยงมารดา (รอคลอด)')).toBeInTheDocument();
    expect(screen.getByTestId('maternal-screen-shadow-banner')).toBeInTheDocument();
    // The severe fixture is both `latest` and the sole `history` row, so the
    // tier chip renders twice (summary + history row) — assert on the first.
    const [tierChip] = screen.getAllByTestId('maternal-screen-tier-chip');
    expect(tierChip.getAttribute('data-tier')).toBe('LOCAL_SEVERE');
  });
});
