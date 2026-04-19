// T067: Partogram service — alert/action line calculations
// CDSS analyzers (T7–T14) ported from HOSxP PartographCDSSUnit.pas.
import type {
  PartogramEntry,
  CdssSeverity,
  CdssAlertDto,
  PartographObservationDto,
} from '@/types/api';

interface AlertLinePoint {
  measuredAt: string;
  dilationCm: number;
}

/**
 * Calculate alert line starting at given dilation (default 4cm)
 * progressing at 1cm/hour up to 10cm.
 */
export function calculateAlertLine(
  startTime: Date,
  startDilation: number = 4,
): AlertLinePoint[] {
  const points: AlertLinePoint[] = [];
  for (let cm = startDilation; cm <= 10; cm++) {
    const hoursFromStart = cm - startDilation;
    const time = new Date(startTime.getTime() + hoursFromStart * 3600000);
    points.push({
      measuredAt: time.toISOString(),
      dilationCm: cm,
    });
  }
  return points;
}

/**
 * Calculate action line — same dilation values as alert line
 * but offset 4 hours to the right.
 */
export function calculateActionLine(alertLineEntries: AlertLinePoint[]): AlertLinePoint[] {
  return alertLineEntries.map((entry) => ({
    measuredAt: new Date(new Date(entry.measuredAt).getTime() + 4 * 3600000).toISOString(),
    dilationCm: entry.dilationCm,
  }));
}

interface VitalSignInput {
  measuredAt: string;
  cervixCm: number;
}

/**
 * Generate partogram entries from vital signs data.
 * Alert/action lines start computing once dilation reaches 4cm.
 */
export function generatePartogramEntries(
  vitalSigns: VitalSignInput[],
): PartogramEntry[] {
  if (vitalSigns.length === 0) return [];

  // Find when active phase starts (first measurement at >= 4cm)
  const activePhaseIndex = vitalSigns.findIndex((vs) => vs.cervixCm >= 4);

  let alertLine: AlertLinePoint[] = [];
  let actionLine: AlertLinePoint[] = [];

  if (activePhaseIndex >= 0) {
    const activePhaseStart = new Date(vitalSigns[activePhaseIndex].measuredAt);
    const startDilation = vitalSigns[activePhaseIndex].cervixCm;
    alertLine = calculateAlertLine(activePhaseStart, startDilation);
    actionLine = calculateActionLine(alertLine);
  }

  return vitalSigns.map((vs) => {
    const vsTime = new Date(vs.measuredAt).getTime();
    let alertLineCm: number | null = null;
    let actionLineCm: number | null = null;

    if (activePhaseIndex >= 0 && vs.cervixCm >= 4) {
      // Interpolate alert line value at this time
      alertLineCm = interpolateLineValue(alertLine, vsTime);
      actionLineCm = interpolateLineValue(actionLine, vsTime);
    }

    return {
      measuredAt: vs.measuredAt,
      dilationCm: vs.cervixCm,
      alertLineCm,
      actionLineCm,
    };
  });
}

/**
 * Interpolate dilation value on a reference line at a given time.
 * Uses linear interpolation between the two nearest points.
 */
function interpolateLineValue(
  line: AlertLinePoint[],
  targetTime: number,
): number | null {
  if (line.length === 0) return null;

  const firstTime = new Date(line[0].measuredAt).getTime();
  const lastTime = new Date(line[line.length - 1].measuredAt).getTime();

  // Before the line starts
  if (targetTime <= firstTime) return line[0].dilationCm;
  // After the line ends
  if (targetTime >= lastTime) return line[line.length - 1].dilationCm;

  // Find surrounding points
  for (let i = 0; i < line.length - 1; i++) {
    const t1 = new Date(line[i].measuredAt).getTime();
    const t2 = new Date(line[i + 1].measuredAt).getTime();
    if (targetTime >= t1 && targetTime <= t2) {
      const ratio = (targetTime - t1) / (t2 - t1);
      return line[i].dilationCm + ratio * (line[i + 1].dilationCm - line[i].dilationCm);
    }
  }

  return null;
}

// ============================================================================
// CDSS (Clinical Decision Support) — ported from PartographCDSSUnit.pas
// ============================================================================

const SEVERITY_RANK: Record<CdssSeverity, number> = {
  INFO: 0, WARN: 1, ALERT: 2, CRITICAL: 3,
};

export interface PartographHeader {
  an: string;
  hn?: string;
  patientName?: string;
  gpal?: string;
  age?: string;
  admitAt?: string;
}

export function highestSeverity(alerts: CdssAlertDto[]): CdssSeverity | null {
  if (alerts.length === 0) return null;
  let best: CdssSeverity = 'INFO';
  for (const a of alerts) {
    if (SEVERITY_RANK[a.severity] > SEVERITY_RANK[best]) best = a.severity;
  }
  return best;
}

export function countBySeverity(alerts: CdssAlertDto[], s: CdssSeverity): number {
  return alerts.filter((a) => a.severity === s).length;
}

// Each analyzer is a small pure function. T8–T14 fill in the bodies in place.

// Rules 1–4: fetal heart rate.
// Pascal: PartographCDSSUnit.pas:200–226.
function analyzeFhr(obs: PartographObservationDto[]): CdssAlertDto[] {
  const out: CdssAlertDto[] = [];
  let consecLow = 0;
  let consecHigh = 0;
  for (let i = 0; i < obs.length; i++) {
    const fhr = obs[i].fetalHeartRate;
    // Pascal: if FHR <= 0 then Continue (does NOT reset counters).
    if (fhr === null || fhr <= 0) continue;

    // Rule 1: critical out-of-range.
    if (fhr < 100 || fhr > 180) {
      out.push({
        severity: 'CRITICAL', section: 'FHR', obsIndex: i,
        message: `FHR ${fhr} ครั้ง/นาที (ผิดปกติรุนแรง)`,
      });
    } else if (fhr < 110 || fhr > 160) {
      // Rule 2: alert outside reassuring band.
      out.push({
        severity: 'ALERT', section: 'FHR', obsIndex: i,
        message: `FHR ${fhr} ครั้ง/นาที (นอกช่วง 110-160)`,
      });
    }

    // Rules 3 & 4: consecutive low/high tracking. Pascal increments BEFORE
    // checking, so the first qualifying reading sets the counter to 1.
    if (fhr < 110) consecLow += 1; else consecLow = 0;
    if (fhr > 160) consecHigh += 1; else consecHigh = 0;
    if (consecLow === 2) {
      out.push({
        severity: 'CRITICAL', section: 'FHR', obsIndex: i,
        message: 'หัวใจทารกเต้นช้าต่อเนื่อง 2 ครั้ง',
      });
    }
    if (consecHigh === 2) {
      out.push({
        severity: 'CRITICAL', section: 'FHR', obsIndex: i,
        message: 'หัวใจทารกเต้นเร็วต่อเนื่อง 2 ครั้ง',
      });
    }
  }
  return out;
}
// Rules 5–9: amniotic fluid (LIQUOR section) + cranial moulding.
// Pascal: PartographCDSSUnit.pas:228–255.
function analyzeLiquorMoulding(obs: PartographObservationDto[]): CdssAlertDto[] {
  const out: CdssAlertDto[] = [];
  for (let i = 0; i < obs.length; i++) {
    // Liquor: case-insensitive substring match on amnioticFluid.
    const fluid = (obs[i].amnioticFluid ?? '').toLowerCase();
    if (fluid.includes('thick')) {
      out.push({
        severity: 'CRITICAL', section: 'LIQUOR', obsIndex: i,
        message: 'น้ำคร่ำขี้เทาข้น',
      });
    } else if (
      fluid.includes('mec') || fluid.includes('moder') || fluid.includes('mild')
    ) {
      out.push({
        severity: 'ALERT', section: 'LIQUOR', obsIndex: i,
        message: 'น้ำคร่ำมีขี้เทา',
      });
    } else if (fluid.includes('blood')) {
      out.push({
        severity: 'ALERT', section: 'LIQUOR', obsIndex: i,
        message: 'น้ำคร่ำปนเลือด',
      });
    }

    // Moulding: raw substring (Pascal does not lowercase here).
    const moulding = obs[i].moulding ?? '';
    if (moulding.includes('+++')) {
      out.push({
        severity: 'CRITICAL', section: 'MOULDING', obsIndex: i,
        message: 'กะโหลกเกยกันรุนแรง (+++)',
      });
    } else if (moulding.includes('++')) {
      out.push({
        severity: 'ALERT', section: 'MOULDING', obsIndex: i,
        message: 'กะโหลกเกยกัน (++)',
      });
    }
  }
  return out;
}
function analyzeCervix(_obs: PartographObservationDto[]): CdssAlertDto[] {
  return [];
}
function analyzeContractions(_obs: PartographObservationDto[]): CdssAlertDto[] {
  return [];
}
function analyzeMaternal(_obs: PartographObservationDto[]): CdssAlertDto[] {
  return [];
}
function analyzeUrine(_obs: PartographObservationDto[]): CdssAlertDto[] {
  return [];
}
function analyzeTimeGaps(_obs: PartographObservationDto[]): CdssAlertDto[] {
  return [];
}

export function analyzePartograph(
  _header: PartographHeader,
  observations: PartographObservationDto[],
): CdssAlertDto[] {
  if (observations.length === 0) return [];
  return [
    ...analyzeFhr(observations),
    ...analyzeLiquorMoulding(observations),
    ...analyzeCervix(observations),
    ...analyzeContractions(observations),
    ...analyzeMaternal(observations),
    ...analyzeUrine(observations),
    ...analyzeTimeGaps(observations),
  ];
}

// Internal exports for per-analyzer tests (T8–T14). These reference the
// hoisted function declarations above; replacing the function body in place
// (rather than reassigning the binding) keeps these references live.
export const _internals = {
  analyzeFhr,
  analyzeLiquorMoulding,
  analyzeCervix,
  analyzeContractions,
  analyzeMaternal,
  analyzeUrine,
  analyzeTimeGaps,
};
