/* @vitest-environment jsdom */
// MaternalScreenCell — Phase 5 W2
// (docs/superpowers/plans/2026-07-16-maternal-screening-ward.md, Task W2).
//
// GC-W1/GC-U1 regression lock: because the underlying rule set is
// PROVISIONAL_UNAPPROVED, nothing in this cell may render green — in either
// the light OR kiosk variant, including the kiosk palette's `--kiosk-low`
// (a real green, #4fb58a, src/app/globals.css) which this file explicitly
// bans on top of the shared no-green scan.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MaternalScreenCell } from '@/components/dashboard/MaternalScreenCell';
import { assertNoGreenInTree } from '../../helpers/assertNoGreen';

describe('MaternalScreenCell', () => {
  it('renders both chips with correct data-* attributes and light colors for a severe fixture', () => {
    render(
      <MaternalScreenCell
        tier="LOCAL_SEVERE"
        acuity="EMERGENCY"
        isComplete={true}
        assessedAt={null}
        variant="light"
      />,
    );
    const tierChip = screen.getByTestId('maternal-screen-tier-chip');
    const acuityChip = screen.getByTestId('maternal-screen-acuity-chip');
    expect(tierChip.getAttribute('data-tier')).toBe('LOCAL_SEVERE');
    expect(acuityChip.getAttribute('data-acuity')).toBe('EMERGENCY');
    expect(tierChip.getAttribute('style')).toContain('var(--risk-high)');
    expect(acuityChip.getAttribute('style')).toContain('var(--risk-high)');
    expect(screen.getByTestId('maternal-screen-cell')).toBeTruthy();
  });

  it('renders nothing when both tier and acuity are null (container empty)', () => {
    const { container } = render(
      <MaternalScreenCell tier={null} acuity={null} isComplete={null} assessedAt={null} />,
    );
    expect(container.innerHTML).toBe('');
    expect(screen.queryByTestId('maternal-screen-cell')).toBeNull();
  });

  it('renders only the tier chip when acuity is null', () => {
    render(
      <MaternalScreenCell
        tier="LOCAL_MILD"
        acuity={null}
        isComplete={null}
        assessedAt={null}
        variant="light"
      />,
    );
    expect(screen.getByTestId('maternal-screen-tier-chip')).toBeTruthy();
    expect(screen.queryByTestId('maternal-screen-acuity-chip')).toBeNull();
  });

  it('renders only the acuity chip when tier is null', () => {
    render(
      <MaternalScreenCell
        tier={null}
        acuity="URGENT"
        isComplete={null}
        assessedAt={null}
        variant="light"
      />,
    );
    expect(screen.queryByTestId('maternal-screen-tier-chip')).toBeNull();
    expect(screen.getByTestId('maternal-screen-acuity-chip')).toBeTruthy();
  });

  it('kiosk variant uses kiosk vars and never --kiosk-low, scanning every element', () => {
    const { container } = render(
      <MaternalScreenCell
        tier="LOCAL_SEVERE"
        acuity="EMERGENCY"
        isComplete={false}
        assessedAt={new Date().toISOString()}
        variant="kiosk"
      />,
    );
    const tierChip = screen.getByTestId('maternal-screen-tier-chip');
    const acuityChip = screen.getByTestId('maternal-screen-acuity-chip');
    expect(tierChip.getAttribute('style')).toContain('var(--kiosk-high)');
    expect(acuityChip.getAttribute('style')).toContain('var(--kiosk-high)');
    assertNoGreenInTree(container);
  });

  it('kiosk variant never renders --kiosk-low even for muted/no-match states', () => {
    const { container } = render(
      <MaternalScreenCell
        tier="NO_LOCAL_MATCH"
        acuity="STABLE"
        isComplete={true}
        assessedAt={null}
        variant="kiosk"
      />,
    );
    const tierChip = screen.getByTestId('maternal-screen-tier-chip');
    const acuityChip = screen.getByTestId('maternal-screen-acuity-chip');
    expect(tierChip.getAttribute('style')).toContain('var(--kiosk-dim)');
    expect(acuityChip.getAttribute('style')).toContain('var(--kiosk-dim)');
    assertNoGreenInTree(container);
  });

  it('shows the incomplete dot when isComplete === false', () => {
    render(
      <MaternalScreenCell
        tier="LOCAL_MODERATE"
        acuity={null}
        isComplete={false}
        assessedAt={null}
        variant="light"
      />,
    );
    const dot = screen.getByTestId('maternal-screen-incomplete-dot');
    expect(dot).toBeTruthy();
    expect(dot.getAttribute('title')).toBe('การประเมินไม่สมบูรณ์');
  });

  it('does not show the incomplete dot when isComplete is true', () => {
    render(
      <MaternalScreenCell
        tier="LOCAL_MODERATE"
        acuity={null}
        isComplete={true}
        assessedAt={null}
        variant="light"
      />,
    );
    expect(screen.queryByTestId('maternal-screen-incomplete-dot')).toBeNull();
  });

  it('does not show the incomplete dot when isComplete is null (not assessed)', () => {
    render(
      <MaternalScreenCell
        tier="LOCAL_MODERATE"
        acuity={null}
        isComplete={null}
        assessedAt={null}
        variant="light"
      />,
    );
    expect(screen.queryByTestId('maternal-screen-incomplete-dot')).toBeNull();
  });

  it('renders age via the short relative-time format when assessedAt is present', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
    render(
      <MaternalScreenCell
        tier="LOCAL_MILD"
        acuity={null}
        isComplete={null}
        assessedAt={fiveMinAgo}
        variant="light"
      />,
    );
    const age = screen.getByTestId('maternal-screen-cell-age');
    expect(age.textContent).toBe('5m');
  });

  it('does not render an age element when assessedAt is null', () => {
    render(
      <MaternalScreenCell
        tier="LOCAL_MILD"
        acuity={null}
        isComplete={null}
        assessedAt={null}
        variant="light"
      />,
    );
    expect(screen.queryByTestId('maternal-screen-cell-age')).toBeNull();
  });

  it('an out-of-vocabulary tier string hits the fallback color', () => {
    render(
      <MaternalScreenCell
        // Intentionally out-of-vocabulary — DB values are raw strings, and
        // the TOKEN[value] ?? FALLBACK lookup must degrade gracefully
        // (GC-W1) rather than crash or render undefined-colored.
        tier={'SOME_UNKNOWN_FUTURE_TIER' as unknown as 'LOCAL_MILD'}
        acuity={null}
        isComplete={null}
        assessedAt={null}
        variant="light"
      />,
    );
    const tierChip = screen.getByTestId('maternal-screen-tier-chip');
    expect(tierChip.getAttribute('style')).toContain('var(--ink-navy-muted)');
  });

  it('an out-of-vocabulary tier string hits the kiosk fallback color in kiosk variant', () => {
    render(
      <MaternalScreenCell
        tier={'SOME_UNKNOWN_FUTURE_TIER' as unknown as 'LOCAL_MILD'}
        acuity={null}
        isComplete={null}
        assessedAt={null}
        variant="kiosk"
      />,
    );
    const tierChip = screen.getByTestId('maternal-screen-tier-chip');
    expect(tierChip.getAttribute('style')).toContain('var(--kiosk-dim)');
  });

  it('wrapper carries the shadow-mode Thai title tooltip', () => {
    render(
      <MaternalScreenCell
        tier="LOCAL_MILD"
        acuity={null}
        isComplete={null}
        assessedAt={null}
        variant="light"
      />,
    );
    const cell = screen.getByTestId('maternal-screen-cell');
    expect(cell.getAttribute('title')).toBe('การคัดกรองท้องถิ่น (โหมดเงา — ยังไม่ได้รับการรับรอง)');
  });
});
