// CallDirectoryDialog — multi-select picker used both to start a group call
// and to add participants mid-call. onCall receives the selected targets and
// resolves to a Thai error string (dialog stays open) or null (success).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CallDirectoryDialog } from '@/components/calls/CallDirectoryDialog';

const DIRECTORY = {
  hospitals: [
    {
      hospitalCode: '11004',
      hospitalName: 'รพ.น้ำพอง',
      users: [{ userId: 'user-callee', name: 'นพ.ปลายทาง ทดสอบ', role: 'user' }],
    },
    {
      hospitalCode: '11005',
      hospitalName: 'รพ.ชนบท',
      users: [{ userId: 'user-other', name: 'นางเพื่อน ร่วมงาน', role: 'admin' }],
    },
  ],
  updatedAt: '2026-07-10T05:00:00.000Z',
};

describe('CallDirectoryDialog', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => DIRECTORY,
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('lists online users grouped under their hospital', async () => {
    render(<CallDirectoryDialog open onOpenChange={() => {}} onCall={async () => null} />);

    expect(await screen.findByText('รพ.น้ำพอง')).toBeTruthy();
    expect(screen.getByText('รพ.ชนบท')).toBeTruthy();
    expect(screen.getByText('นพ.ปลายทาง ทดสอบ')).toBeTruthy();
    expect(screen.getByText('นางเพื่อน ร่วมงาน')).toBeTruthy();
  });

  it('multi-selects users and calls onCall with every picked target', async () => {
    const onCall = vi.fn(
      async (_targets: { userId: string; hospitalName: string }[]): Promise<string | null> => null,
    );
    render(<CallDirectoryDialog open onOpenChange={() => {}} onCall={onCall} />);

    fireEvent.click(await screen.findByText('นพ.ปลายทาง ทดสอบ'));
    fireEvent.click(screen.getByText('นางเพื่อน ร่วมงาน'));

    const action = screen.getByRole('button', { name: /โทร \(2\)/ });
    fireEvent.click(action);

    await waitFor(() => expect(onCall).toHaveBeenCalledTimes(1));
    const targets = onCall.mock.calls[0][0];
    expect(targets.map((t) => t.userId).sort()).toEqual(['user-callee', 'user-other']);
    expect(targets.find((t) => t.userId === 'user-callee')?.hospitalName).toBe('รพ.น้ำพอง');
  });

  it('disables the action button until someone is selected', async () => {
    render(<CallDirectoryDialog open onOpenChange={() => {}} onCall={async () => null} />);
    await screen.findByText('นพ.ปลายทาง ทดสอบ');
    const action = screen.getByRole('button', { name: /โทร/ });
    expect(action.hasAttribute('disabled')).toBe(true);
  });

  it('shows the Thai error returned by onCall and stays open', async () => {
    const onCall = vi.fn(async () => 'สายไม่ว่าง — มีการสนทนาค้างอยู่');
    render(<CallDirectoryDialog open onOpenChange={() => {}} onCall={onCall} />);

    fireEvent.click(await screen.findByText('นพ.ปลายทาง ทดสอบ'));
    fireEvent.click(screen.getByRole('button', { name: /โทร \(1\)/ }));

    expect(await screen.findByText(/สายไม่ว่าง/)).toBeTruthy();
    // Still open: the list is still rendered.
    expect(screen.getByText('นพ.ปลายทาง ทดสอบ')).toBeTruthy();
  });

  it('shows an empty state when nobody else is online', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ hospitals: [], updatedAt: DIRECTORY.updatedAt }),
    })) as unknown as typeof fetch;

    render(<CallDirectoryDialog open onOpenChange={() => {}} onCall={async () => null} />);
    expect(await screen.findByText(/ไม่มีผู้ใช้ท่านอื่นออนไลน์/)).toBeTruthy();
  });

  it('shows an actionable Thai error with retry when loading fails', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    render(<CallDirectoryDialog open onOpenChange={() => {}} onCall={async () => null} />);
    expect(await screen.findByText(/ไม่สามารถโหลดรายชื่อ/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /ลองใหม่/ })).toBeTruthy();
  });
});
