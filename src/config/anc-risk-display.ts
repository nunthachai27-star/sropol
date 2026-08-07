// ANC risk level display tokens — colors (CSS vars from globals.css) and Thai
// labels, shared by every page that renders an ANC risk chip. Previously
// duplicated inline in pregnancies/page.tsx and pregnancies/[journeyId]/page.tsx
// (with drifting label copy); referrals/page.tsx is the third consumer, so per
// constitution III this now lives in config.
export const ANC_RISK_COLOR: Record<string, string> = {
  LOW: 'var(--risk-low)',
  HR1: 'var(--risk-medium)',
  HR2: 'var(--risk-medium)',
  HR3: 'var(--risk-high)',
};

export const ANC_RISK_LABEL_TH: Record<string, string> = {
  LOW: 'ความเสี่ยงต่ำ',
  HR1: 'ความเสี่ยงระดับ 1',
  HR2: 'ความเสี่ยงระดับ 2',
  HR3: 'ความเสี่ยงสูง',
};

/** Fallback chip color for unknown/legacy risk codes. */
export const ANC_RISK_FALLBACK_COLOR = 'var(--ink-navy-muted)';
