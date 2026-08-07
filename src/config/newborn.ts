// Newborn outcome thresholds — WHO definitions, defined once so the
// outcomes KPIs (services/newborn.ts) and the patient-detail newborn card
// can never disagree on what counts as LBW or a low Apgar.
export const NEWBORN_THRESHOLDS = {
  /** Low birth weight: below 2,500 g (WHO). */
  lbwGrams: 2500,
  /** Apgar at 5 minutes below 7 predicts complications (standard cutoff). */
  apgarLowAt5min: 7,
} as const;
