/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorState } from '@/components/shared/ErrorState';

describe('ErrorState', () => {
  it('renders message and detail in page variant', () => {
    render(
      <ErrorState message="ไม่สามารถโหลดข้อมูล Dashboard ได้" detail="column X does not exist" />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('ไม่สามารถโหลดข้อมูล Dashboard ได้')).toBeTruthy();
    expect(screen.getByText('column X does not exist')).toBeTruthy();
  });

  it('renders default Thai message when none given', () => {
    render(<ErrorState />);
    expect(screen.getByText('ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่')).toBeTruthy();
  });

  it('calls onRetry when the retry button is clicked', () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /ลองใหม่/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the retry button when onRetry is not provided', () => {
    render(<ErrorState />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('banner variant shows the cached-data timestamp', () => {
    render(
      <ErrorState
        variant="banner"
        message="การเชื่อมต่อล้มเหลว — แสดงข้อมูลเดิมจากแคช"
        lastUpdatedAt="2026-07-08T02:30:00.000Z"
      />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('การเชื่อมต่อล้มเหลว — แสดงข้อมูลเดิมจากแคช')).toBeTruthy();
    // 02:30 UTC = 09:30 Asia/Bangkok
    expect(screen.getByText(/09:30/)).toBeTruthy();
  });

  it('banner variant without timestamp still renders the message', () => {
    render(<ErrorState variant="banner" message="การเชื่อมต่อล้มเหลว" />);
    expect(screen.getByText('การเชื่อมต่อล้มเหลว')).toBeTruthy();
  });
});
