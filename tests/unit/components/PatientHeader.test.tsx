// PatientHeader component tests
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PatientHeader } from '@/components/patient/PatientHeader';
import { maskName } from '@/lib/pii-mask';
import { RiskLevel, ConnectionStatus } from '@/types/domain';

// Mock formatThaiDate to produce a predictable output
vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return {
    ...actual,
    formatThaiDate: (date: Date | string) => {
      const d = typeof date === 'string' ? new Date(date) : date;
      return `${d.getDate()} ม.ค. ${d.getFullYear() + 543}`;
    },
  };
});

const baseProps = {
  hn: '12345',
  an: 'AN-001',
  name: 'นางสาวทดสอบ ใจดี',
  age: 28,
  admitDate: '2026-01-15T08:30:00Z',
  laborStatus: 'ACTIVE',
  hospital: {
    name: 'รพ.ขอนแก่น',
    level: 'A_S',
  },
  cpdScore: {
    score: 7,
    riskLevel: RiskLevel.MEDIUM,
  },
};

describe('PatientHeader', () => {
  it('renders the patient name masked (PDPA) as the primary title', () => {
    render(<PatientHeader {...baseProps} />);
    // PatientHeader masks the surname for on-screen PDPA safety (pii-mask.ts):
    // the display shows the first name + abbreviated surname, never the full
    // decrypted name.
    expect(screen.getByText(maskName(baseProps.name))).toBeTruthy();
    expect(screen.queryByText(baseProps.name)).toBeNull();
  });

  it('renders patient HN, AN, and age', () => {
    render(<PatientHeader {...baseProps} />);
    expect(screen.getByText('12345')).toBeTruthy();
    expect(screen.getByText('AN-001')).toBeTruthy();
    // The age value is rendered in its own span; check via numeric match
    expect(screen.getByText('28')).toBeTruthy();
  });

  it('shows admit date in Thai format', () => {
    render(<PatientHeader {...baseProps} />);
    expect(screen.getByText('15 ม.ค. 2569')).toBeTruthy();
  });

  it('shows labor status pill "คลอดอยู่" for ACTIVE status', () => {
    render(<PatientHeader {...baseProps} laborStatus="ACTIVE" />);
    expect(screen.getByText('คลอดอยู่')).toBeTruthy();
  });

  it('shows labor status pill "คลอดแล้ว" for DELIVERED status', () => {
    render(<PatientHeader {...baseProps} laborStatus="DELIVERED" />);
    expect(screen.getByText('คลอดแล้ว')).toBeTruthy();
  });

  it('shows hospital name and level', () => {
    render(<PatientHeader {...baseProps} />);
    expect(screen.getByText('รพ.ขอนแก่น')).toBeTruthy();
    // Level is rendered as "·A_S" inside the hospital pill
    expect(screen.getByText('·A_S')).toBeTruthy();
  });

  it('shows CpdBadge with score when cpdScore is provided', () => {
    render(<PatientHeader {...baseProps} />);
    expect(screen.getByText('CPD Score')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
  });

  it('does not render CpdBadge when cpdScore is null', () => {
    render(<PatientHeader {...baseProps} cpdScore={null} />);
    expect(screen.queryByText('CPD Score')).toBeNull();
  });

  it('shows ConnectionStatus when hospital has connectionStatus', () => {
    const propsWithConnection = {
      ...baseProps,
      hospital: {
        name: 'รพ.ขอนแก่น',
        level: 'A_S',
        connectionStatus: ConnectionStatus.ONLINE,
        lastSyncAt: '2026-01-15T10:00:00Z',
      },
    };
    render(<PatientHeader {...propsWithConnection} />);
    expect(screen.getByText('ออนไลน์')).toBeTruthy();
  });

  it('shows weight change display when weightKg and weightDiffKg are provided', () => {
    render(<PatientHeader {...baseProps} weightKg={70} weightDiffKg={23} />);
    // preWeight = 70 - 23 = 47, current 70, delta +23
    expect(screen.getByText('47')).toBeTruthy();
    expect(screen.getByText('70')).toBeTruthy();
    expect(screen.getByText('+23')).toBeTruthy();
  });

  it('does not show weight change when weightKg is null', () => {
    render(<PatientHeader {...baseProps} weightKg={null} weightDiffKg={10} />);
    expect(screen.queryByText('น.น.')).toBeNull();
  });

  it('does not show weight change when weightDiffKg is null', () => {
    render(<PatientHeader {...baseProps} weightKg={70} weightDiffKg={null} />);
    expect(screen.queryByText('น.น.')).toBeNull();
  });

  it('does not show weight change when weightDiffKg is 0', () => {
    render(<PatientHeader {...baseProps} weightKg={70} weightDiffKg={0} />);
    expect(screen.queryByText('น.น.')).toBeNull();
  });

  // The identity band was redesigned onto a navy gradient, so the weight-diff
  // coloring shifted from the light-theme --risk-* CSS variables to lighter
  // tailwind-300/400 tones that still read as green/amber/red on dark navy.
  // These tests pin the semantic color category rather than the exact hex.
  const weightDiffColor = (container: HTMLElement, text: string): string | null => {
    const span = [...container.querySelectorAll('span')].find((el) => el.textContent === text);
    return span?.getAttribute('style') ?? null;
  };

  it('colors weight diff green (safe) when gain <= 15', () => {
    const { container } = render(<PatientHeader {...baseProps} weightKg={60} weightDiffKg={10} />);
    const style = weightDiffColor(container, '+10');
    // Green tones: bbf7d0 (300) or 86efac (400) — JSDOM normalizes to rgb()
    expect(style).toMatch(/bbf7d0|86efac|187,\s*247,\s*208|134,\s*239,\s*172/i);
  });

  it('colors weight diff amber (warn) when gain > 15 and <= 20', () => {
    const { container } = render(<PatientHeader {...baseProps} weightKg={65} weightDiffKg={18} />);
    const style = weightDiffColor(container, '+18');
    // Amber tones: fde68a (200) or fcd34d (300)
    expect(style).toMatch(/fde68a|fcd34d|253,\s*230,\s*138|252,\s*211,\s*77/i);
  });

  it('colors weight diff red (alert) when gain > 20', () => {
    const { container } = render(<PatientHeader {...baseProps} weightKg={75} weightDiffKg={25} />);
    const style = weightDiffColor(container, '+25');
    // Red tones: fca5a5 (300) or fecaca (200)
    expect(style).toMatch(/fca5a5|fecaca|252,\s*165,\s*165|254,\s*202,\s*202/i);
  });
});
