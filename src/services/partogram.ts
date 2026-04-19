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
// Hours between two ISO datetime strings. Replaces Pascal `(t2 - t1) * 24`.
function hoursBetween(later: string, earlier: string): number {
  return (Date.parse(later) - Date.parse(earlier)) / 3600000;
}

// LCG hours-at-cm threshold table. Pascal: PartographCDSSUnit.pas:159–173.
function lcgTimeThreshold(cm: number): number {
  switch (Math.round(cm)) {
    case 5: return 6.0;
    case 6: return 5.0;
    case 7: return 3.0;
    case 8: return 2.5;
    case 9: return 2.0;
    default: return 0;
  }
}

// Earliest index whose dilation >= cm. Pascal FirstIndexAtDilation.
function firstIndexAtDilation(
  obsList: PartographObservationDto[], cm: number,
): number {
  for (let i = 0; i < obsList.length; i++) {
    const d = obsList[i].cervicalDilationCm;
    if (d !== null && d >= cm) return i;
  }
  return -1;
}

// Format a number with one decimal — equivalent to Pascal Format('%.1f').
function fmt1(n: number): string {
  return n.toFixed(1);
}

// Rules 10–14: cervix progression.
// Pascal: PartographCDSSUnit.pas:257–353.
function analyzeCervix(obs: PartographObservationDto[]): CdssAlertDto[] {
  const out: CdssAlertDto[] = [];
  if (obs.length === 0) return out;

  // Rules 10/11 — Alert/Action line, anchored at first dil >= 4 cm.
  const firstActiveIdx = firstIndexAtDilation(obs, 4);
  if (firstActiveIdx >= 0) {
    const anchorDt = obs[firstActiveIdx].observeDatetime;
    const anchorDil = obs[firstActiveIdx].cervicalDilationCm ?? 0;
    for (let i = firstActiveIdx + 1; i < obs.length; i++) {
      const d = obs[i].cervicalDilationCm;
      if (d === null || d <= 0) continue;
      const expected = anchorDil + hoursBetween(obs[i].observeDatetime, anchorDt);
      if (d < expected - 4) {
        out.push({
          severity: 'CRITICAL', section: 'CERVIX', obsIndex: i,
          message: `ปากมดลูก ${fmt1(d)} ซม. เลย Action line (คาด ${fmt1(expected)}+)`,
        });
      } else if (d < expected) {
        out.push({
          severity: 'ALERT', section: 'CERVIX', obsIndex: i,
          message: `ปากมดลูก ${fmt1(d)} ซม. เลย Alert line (คาด ${fmt1(expected)})`,
        });
      }
    }
  }

  // Rule 12 — Latent phase prolonged: ALL obs <4 cm AND span >8 h.
  let allLatent = true;
  let latentStart: string | null = null;
  for (let i = 0; i < obs.length; i++) {
    const d = obs[i].cervicalDilationCm;
    if (d !== null && d >= 4) {
      allLatent = false;
      break;
    }
    const dt = obs[i].observeDatetime;
    const ms = Date.parse(dt);
    if (Number.isFinite(ms) && ms > 0) {
      if (latentStart === null || Date.parse(dt) < Date.parse(latentStart)) {
        latentStart = dt;
      }
    }
  }
  if (allLatent && obs.length > 0 && latentStart !== null) {
    const lastDt = obs[obs.length - 1].observeDatetime;
    const latentH = hoursBetween(lastDt, latentStart);
    if (latentH > 8) {
      out.push({
        severity: 'ALERT', section: 'CERVIX', obsIndex: obs.length - 1,
        message: `Latent phase ยาวนาน (${Math.round(latentH)} ชม.)`,
      });
    }
  }

  // Rule 13 — LCG time-per-cm stall, levels 5..9.
  for (let curCm = 5; curCm <= 9; curCm++) {
    let firstAtIdx = -1;
    for (let k = 0; k < obs.length; k++) {
      const d = obs[k].cervicalDilationCm;
      if (d !== null && d >= curCm && d < curCm + 1) {
        firstAtIdx = k;
        break;
      }
    }
    if (firstAtIdx < 0) continue;
    const thresholdH = lcgTimeThreshold(curCm);
    // Latest obs still at this cm level (Pascal scans High->firstAtIdx,
    // breaks on first match — i.e. the latest match).
    for (let k = obs.length - 1; k >= firstAtIdx; k--) {
      const d = obs[k].cervicalDilationCm;
      if (d !== null && d >= curCm && d < curCm + 1) {
        const hoursAtLevel = hoursBetween(
          obs[k].observeDatetime, obs[firstAtIdx].observeDatetime,
        );
        if (hoursAtLevel > thresholdH) {
          out.push({
            severity: 'ALERT', section: 'CERVIX', obsIndex: k,
            message: `หยุดที่ ${curCm} ซม. นาน ${fmt1(hoursAtLevel)} ชม. (เกณฑ์ LCG ${fmt1(thresholdH)} ชม.)`,
          });
        }
        break;
      }
    }
  }

  // Rule 14 — Active-phase arrest: last two obs both >=5 cm, |Δ|<0.5, span >2 h.
  if (obs.length >= 2) {
    const i = obs.length - 1;
    const cur = obs[i].cervicalDilationCm;
    const prev = obs[i - 1].cervicalDilationCm;
    if (cur !== null && prev !== null && cur >= 5 && prev >= 5 &&
        Math.abs(cur - prev) < 0.5) {
      const spanH = hoursBetween(
        obs[i].observeDatetime, obs[i - 1].observeDatetime,
      );
      if (spanH > 2) {
        out.push({
          severity: 'CRITICAL', section: 'CERVIX', obsIndex: i,
          message: `Labour arrest: ไม่มีความก้าวหน้า ${fmt1(spanH)} ชม. ในระยะ active`,
        });
      }
    }
  }

  return out;
}
// Rules 15–19: contractions.
// Pascal: PartographCDSSUnit.pas:355–397.
function analyzeContractions(obs: PartographObservationDto[]): CdssAlertDto[] {
  const out: CdssAlertDto[] = [];
  let tachyCount = 0;
  let firstTachy = -1;
  for (let i = 0; i < obs.length; i++) {
    const n = obs[i].contractionPer10Min;
    if (n !== null && n > 0) {
      // Rule 15: tachysystole this row.
      if (n > 5) {
        out.push({
          severity: 'ALERT', section: 'CONTRACTIONS', obsIndex: i,
          message: `มดลูกหดตัวถี่: ${n} ครั้ง/10 นาที`,
        });
      } else if (n <= 2) {
        // Rule 16: hypotonus.
        out.push({
          severity: 'ALERT', section: 'CONTRACTIONS', obsIndex: i,
          message: `มดลูกหดตัวน้อย: ${n} ครั้ง/10 นาที`,
        });
      }

      // Rule 17 prep: track sustained tachysystole window.
      if (n > 5) {
        if (firstTachy < 0) firstTachy = i;
        tachyCount += 1;
      } else {
        tachyCount = 0;
        firstTachy = -1;
      }

      // Rule 17: sustained tachysystole over >= 30 minutes is CRITICAL.
      if (firstTachy >= 0 && tachyCount >= 2) {
        const gapMin =
          (Date.parse(obs[i].observeDatetime)
            - Date.parse(obs[firstTachy].observeDatetime)) / 60000;
        if (gapMin >= 30) {
          out.push({
            severity: 'CRITICAL', section: 'CONTRACTIONS', obsIndex: i,
            message: 'มดลูกหดตัวถี่ต่อเนื่อง > 30 นาที',
          });
        }
      }
    }

    // Rules 18 & 19: contraction duration. Pascal: ContrDurSec > 0 gate.
    const s = obs[i].contractionDurationSec;
    if (s !== null && s > 0) {
      if (s > 60) {
        out.push({
          severity: 'ALERT', section: 'CONTRACTIONS', obsIndex: i,
          message: `ระยะเวลาหดรัดตัว ${s} วินาที > 60 วินาที`,
        });
      } else if (s < 20) {
        out.push({
          severity: 'ALERT', section: 'CONTRACTIONS', obsIndex: i,
          message: `ระยะเวลาหดรัดตัว ${s} วินาที < 20 วินาที`,
        });
      }
    }
  }
  return out;
}
// Rules 20–28: maternal observations (pulse, BP, temperature).
// Pascal: PartographCDSSUnit.pas:399–451.
function analyzeMaternal(obs: PartographObservationDto[]): CdssAlertDto[] {
  const out: CdssAlertDto[] = [];
  for (let i = 0; i < obs.length; i++) {
    // Pulse — Pascal gates on Pulse > 0.
    const p = obs[i].pulse;
    if (p !== null && p > 0) {
      if (p > 140) {
        out.push({
          severity: 'CRITICAL', section: 'PULSE', obsIndex: i,
          message: `ชีพจร ${p} ครั้ง/นาที (เร็วผิดปกติรุนแรง)`,
        });
      } else if (p < 60 || p >= 120) {
        out.push({
          severity: 'ALERT', section: 'PULSE', obsIndex: i,
          message: `ชีพจร ${p} ครั้ง/นาที (นอกช่วง 60-120)`,
        });
      }
    }

    // Systolic BP — Pascal gates on BPSys > 0.
    const sbp = obs[i].bpSystolic;
    if (sbp !== null && sbp > 0) {
      if (sbp >= 160) {
        out.push({
          severity: 'CRITICAL', section: 'BP', obsIndex: i,
          message: `ความดันตัวบนสูงรุนแรง ${sbp}`,
        });
      } else if (sbp >= 140) {
        out.push({
          severity: 'ALERT', section: 'BP', obsIndex: i,
          message: `ความดันตัวบนสูง ${sbp}`,
        });
      } else if (sbp < 80) {
        out.push({
          severity: 'ALERT', section: 'BP', obsIndex: i,
          message: `ความดันตัวบนต่ำ ${sbp}`,
        });
      }
    }

    // Diastolic BP — Pascal gates on BPDia > 0.
    const dbp = obs[i].bpDiastolic;
    if (dbp !== null && dbp > 0) {
      if (dbp >= 110) {
        out.push({
          severity: 'CRITICAL', section: 'BP', obsIndex: i,
          message: `ความดันตัวล่างสูงรุนแรง ${dbp}`,
        });
      } else if (dbp >= 90) {
        out.push({
          severity: 'ALERT', section: 'BP', obsIndex: i,
          message: `ความดันตัวล่างสูง ${dbp}`,
        });
      }
    }

    // Temperature — Pascal gates on Temp > 0.
    const t = obs[i].temperature;
    if (t !== null && t > 0) {
      if (t >= 38.5) {
        out.push({
          severity: 'CRITICAL', section: 'TEMP', obsIndex: i,
          message: `ไข้สูง ${fmt1(t)} °C`,
        });
      } else if (t >= 37.5 || t < 35) {
        out.push({
          severity: 'ALERT', section: 'TEMP', obsIndex: i,
          message: `อุณหภูมิ ${fmt1(t)} °C ผิดปกติ`,
        });
      }
    }
  }
  return out;
}
// Rules 29–31: urinalysis. Pascal `Pos('++', X) > 0` matches the literal
// substring "++" — a single "+" never matches; "+++" matches via substring.
// Pascal: PartographCDSSUnit.pas:453–470.
function analyzeUrine(obs: PartographObservationDto[]): CdssAlertDto[] {
  const out: CdssAlertDto[] = [];
  for (let i = 0; i < obs.length; i++) {
    const protein = obs[i].urineProtein ?? '';
    const acetone = obs[i].urineAcetone ?? '';
    const glucose = obs[i].urineGlucose ?? '';
    if (protein.includes('++')) {
      out.push({
        severity: 'ALERT', section: 'URINE', obsIndex: i,
        message: 'โปรตีนในปัสสาวะสูง - ระวัง pre-eclampsia',
      });
    }
    if (acetone.includes('++')) {
      out.push({
        severity: 'ALERT', section: 'URINE', obsIndex: i,
        message: 'คีโตนในปัสสาวะ - อาจมีภาวะขาดน้ำ',
      });
    }
    if (glucose.includes('++')) {
      out.push({
        severity: 'ALERT', section: 'URINE', obsIndex: i,
        message: 'กลูโคสในปัสสาวะ - ควรตรวจเบาหวาน',
      });
    }
  }
  return out;
}
// Rule 32: observation gap >4 h while in active phase (dilation >= 4 cm).
// Pascal: PartographCDSSUnit.pas:472–485.
function analyzeTimeGaps(obs: PartographObservationDto[]): CdssAlertDto[] {
  const out: CdssAlertDto[] = [];
  for (let i = 1; i < obs.length; i++) {
    const gapH = hoursBetween(obs[i].observeDatetime, obs[i - 1].observeDatetime);
    const d = obs[i].cervicalDilationCm;
    if (gapH > 4 && d !== null && d >= 4) {
      out.push({
        severity: 'WARN', section: 'TIME', obsIndex: i,
        message: `เว้นการสังเกต ${fmt1(gapH)} ชม. (ระยะ active)`,
      });
    }
  }
  return out;
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
