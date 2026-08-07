// CallRoomClient — the in-call page body: participant strip with Thai status
// chips, leave flow, ended state. Jitsi itself is mocked (iframe API needs a
// real browser); the strip logic is what we own.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const routerBack = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, back: routerBack, replace: () => {}, prefetch: () => {} }),
}));
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: {
      user: {
        id: 'user-creator',
        name: 'พญ.ต้นทาง ทดสอบ',
        hospitalCode: '10670',
        hospitalName: 'รพ.ขอนแก่น',
      },
    },
  }),
}));
vi.mock('@/components/calls/JitsiRoom', () => ({
  JitsiRoom: () => <div data-testid="jitsi-room" />,
}));

import { CallRoomClient } from '@/components/calls/CallRoomClient';

const CALL_VIEW = {
  callId: 'call-1',
  roomId: 'kklrms-room-1',
  status: 'active',
  createdByUserId: 'user-creator',
  createdByName: 'พญ.ต้นทาง ทดสอบ',
  participants: [
    {
      userId: 'user-creator',
      name: 'พญ.ต้นทาง ทดสอบ',
      hospitalCode: '10670',
      hospitalName: 'รพ.ขอนแก่น',
      role: 'creator',
      status: 'joined',
    },
    {
      userId: 'user-b',
      name: 'นพ.สอง ทดสอบ',
      hospitalCode: '11004',
      hospitalName: 'รพ.น้ำพอง',
      role: 'invitee',
      status: 'ringing',
    },
    {
      userId: 'user-c',
      name: 'นส.สาม ทดสอบ',
      hospitalCode: '11005',
      hospitalName: 'รพ.ชนบท',
      role: 'invitee',
      status: 'declined',
    },
  ],
};

describe('CallRoomClient', () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    routerBack.mockClear();
    fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/calls/call-1') && !url.includes('/leave')) {
        return { ok: true, status: 200, json: async () => CALL_VIEW };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders the participant strip with Thai status chips and the room', async () => {
    render(<CallRoomClient callId="call-1" />);

    expect(await screen.findByTestId('jitsi-room')).toBeTruthy();
    expect(screen.getByText('นพ.สอง ทดสอบ')).toBeTruthy();
    expect(screen.getByText(/กำลังเรียก/)).toBeTruthy();
    expect(screen.getByText('นส.สาม ทดสอบ')).toBeTruthy();
    expect(screen.getByText(/ปฏิเสธ/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /เพิ่มผู้เข้าร่วม/ })).toBeTruthy();
  });

  it('วางสาย posts leave with keepalive and navigates back', async () => {
    render(<CallRoomClient callId="call-1" />);
    await screen.findByTestId('jitsi-room');

    fireEvent.click(screen.getByRole('button', { name: /วางสาย/ }));

    await waitFor(() => {
      const leaveCall = fetchMock.mock.calls.find((call) =>
        String(call[0]).includes('/api/calls/call-1/leave'),
      );
      expect(leaveCall).toBeTruthy();
      // Navigation right after the fetch can abort it — keepalive lets the
      // browser finish the request (the prod stuck-call incident).
      expect((leaveCall?.[1] as RequestInit | undefined)?.keepalive).toBe(true);
    });
    expect(routerBack).toHaveBeenCalled();
  });

  it('closing the tab fires a leave beacon (pagehide)', async () => {
    const sendBeacon = vi.fn((_url: string, _data?: BodyInit | null) => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });

    render(<CallRoomClient callId="call-1" />);
    await screen.findByTestId('jitsi-room');

    window.dispatchEvent(new Event('pagehide'));

    expect(
      sendBeacon.mock.calls.some((call) => String(call[0]).includes('/api/calls/call-1/leave')),
    ).toBe(true);
  });

  it('shows the ended state instead of the room for finished calls', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ...CALL_VIEW, status: 'ended' }),
    }));

    render(<CallRoomClient callId="call-1" />);
    expect(await screen.findByText(/สายนี้สิ้นสุดแล้ว/)).toBeTruthy();
    expect(screen.queryByTestId('jitsi-room')).toBeNull();
  });
});
