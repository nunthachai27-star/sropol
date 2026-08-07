// IncomingCallToast — the global ring UI. Must always show who is calling
// from which hospital and offer accept/decline in Thai.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IncomingCallToast } from '@/components/calls/IncomingCallToast';

describe('IncomingCallToast', () => {
  const baseProps = {
    callerName: 'พญ.ต้นทาง ทดสอบ',
    callerHospitalName: 'รพ.ขอนแก่น',
    onAccept: vi.fn(),
    onDecline: vi.fn(),
  };

  it('shows the caller identity and an incoming-call label in Thai', () => {
    render(<IncomingCallToast {...baseProps} />);
    expect(screen.getByText('พญ.ต้นทาง ทดสอบ')).toBeTruthy();
    expect(screen.getByText('รพ.ขอนแก่น')).toBeTruthy();
    expect(screen.getByText(/สายเรียกเข้า/)).toBeTruthy();
  });

  it('fires onAccept / onDecline from the labelled buttons', () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    render(<IncomingCallToast {...baseProps} onAccept={onAccept} onDecline={onDecline} />);

    fireEvent.click(screen.getByRole('button', { name: /รับสาย/ }));
    expect(onAccept).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /ปฏิเสธ/ }));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while an action is in flight', () => {
    render(<IncomingCallToast {...baseProps} busy />);
    expect(screen.getByRole('button', { name: /รับสาย/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /ปฏิเสธ/ }).hasAttribute('disabled')).toBe(true);
  });

  it('shows a group hint when the call already has more than two participants', () => {
    render(<IncomingCallToast {...baseProps} groupSize={4} />);
    expect(screen.getByText(/สายกลุ่ม/)).toBeTruthy();
  });

  it('shows no group hint for a 1:1 call', () => {
    render(<IncomingCallToast {...baseProps} groupSize={2} />);
    expect(screen.queryByText(/สายกลุ่ม/)).toBeNull();
  });
});
