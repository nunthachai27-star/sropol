// ClinicalData component tests
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClinicalData } from '@/components/patient/ClinicalData';

const completeData = {
  gravida: 2,
  gaWeeks: 38,
  ancCount: 6,
  heightCm: 155,
  weightDiffKg: 12,
  fundalHeightCm: 34,
  usWeightG: 3200,
  hematocritPct: 36,
};

describe('ClinicalData', () => {
  it('renders all 8 clinical measurements when data is complete', () => {
    render(<ClinicalData {...completeData} />);
    // Tiles render value+unit in separate spans; check the numeric values are present
    expect(screen.getByText('G2')).toBeTruthy();
    expect(screen.getByText('38')).toBeTruthy();
    expect(screen.getByText('wk')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
    // Unit "ครั้ง" is used for the ANC tile and (implicitly) for the GA tile; pick one
    expect(screen.getAllByText('ครั้ง').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('155')).toBeTruthy();
    expect(screen.getByText('34')).toBeTruthy();
    // US weight is localized (3,200)
    expect(screen.getByText('3,200')).toBeTruthy();
    expect(screen.getByText('36')).toBeTruthy();
    expect(screen.getByText('%')).toBeTruthy();
  });

  it('shows em-dash "—" for missing/null values', () => {
    const nullData = {
      gravida: null,
      gaWeeks: null,
      ancCount: null,
      heightCm: null,
      weightDiffKg: null,
      fundalHeightCm: null,
      usWeightG: null,
      hematocritPct: null,
    };
    render(<ClinicalData {...nullData} />);
    // Eight tiles, each rendering a single em-dash for the missing value
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBe(8);
  });

  it('renders Thai labels for every tile', () => {
    render(<ClinicalData {...completeData} />);
    for (const label of [
      // The OB-formula tile labels "G_P_A_L" unless a pregNo is supplied
      // (completeData has none); with pregNo it would read "ครรภ์ที่ N".
      'G_P_A_L',
      'อายุครรภ์',
      'ฝากครรภ์',
      'ส่วนสูง',
      'ส่วนต่างน้ำหนัก',
      'ยอดมดลูก',
      'น้ำหนักเด็ก U/S',
      'Hematocrit',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('renders section header ข้อมูลทางคลินิก', () => {
    render(<ClinicalData {...completeData} />);
    expect(screen.getByText('ข้อมูลทางคลินิก')).toBeTruthy();
  });

  it('shows dash only for null fields, not for present ones', () => {
    const partialData = {
      gravida: 1,
      gaWeeks: null,
      ancCount: 4,
      heightCm: null,
      weightDiffKg: 10,
      fundalHeightCm: null,
      usWeightG: 2800,
      hematocritPct: null,
    };
    render(<ClinicalData {...partialData} />);
    // Four null tiles each render one em-dash
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBe(4);
  });

  it('shows full weight context when both weightKg and weightDiffKg are provided', () => {
    render(<ClinicalData {...completeData} weightKg={70} />);
    // preWeight = 70 - 12 = 58, diff = 12
    expect(screen.getByText('58')).toBeTruthy();
    expect(screen.getByText('70')).toBeTruthy();
    expect(screen.getByText('+12')).toBeTruthy();
  });

  it('renders weight-diff only form when weightKg is not provided', () => {
    render(<ClinicalData {...completeData} />);
    expect(screen.getByText('+12')).toBeTruthy();
  });

  it('colors weight diff with risk-low token when gain <= 15', () => {
    const { container } = render(<ClinicalData {...completeData} weightKg={70} />);
    const diff = [...container.querySelectorAll('span')].find((el) => el.textContent === '+12');
    expect(diff).toBeTruthy();
    expect(diff?.getAttribute('style')).toMatch(/--risk-low/);
  });

  it('colors weight diff with risk-medium token when gain > 15 and <= 20', () => {
    const { container } = render(
      <ClinicalData {...completeData} weightKg={75} weightDiffKg={18} />,
    );
    const diff = [...container.querySelectorAll('span')].find((el) => el.textContent === '+18');
    expect(diff).toBeTruthy();
    expect(diff?.getAttribute('style')).toMatch(/--risk-medium/);
  });

  it('colors weight diff with risk-high token when gain > 20', () => {
    const { container } = render(
      <ClinicalData {...completeData} weightKg={75} weightDiffKg={25} />,
    );
    const diff = [...container.querySelectorAll('span')].find((el) => el.textContent === '+25');
    expect(diff).toBeTruthy();
    expect(diff?.getAttribute('style')).toMatch(/--risk-high/);
  });
});
