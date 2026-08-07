/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';

vi.mock('@/lib/bms-browser-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bms-browser-client')>();
  return { ...actual, getPatientPhoto: vi.fn() };
});
import { getPatientPhoto } from '@/lib/bms-browser-client';
import { PatientPhoto } from '@/components/shared/PatientPhoto';
import type { ConnectionConfig } from '@/types/bms-browser';

const mockPhoto = getPatientPhoto as unknown as ReturnType<typeof vi.fn>;
const cfg: ConnectionConfig = {
  apiUrl: 'https://t.example/api',
  bearerToken: 'B',
  appIdentifier: 'X',
};

URL.createObjectURL = vi.fn(() => 'blob:mock-photo');
URL.revokeObjectURL = vi.fn();

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

beforeEach(() => {
  mockPhoto.mockReset();
});

function jpeg() {
  return new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' });
}

describe('PatientPhoto', () => {
  it('renders a neutral placeholder and does NOT fetch when there is no BMS config', () => {
    render(<PatientPhoto hn="HN1" config={null} name="นาง ทดสอบ" />, { wrapper });
    expect(screen.getByTestId('patient-photo-placeholder')).toBeInTheDocument();
    expect(screen.queryByTestId('patient-photo')).not.toBeInTheDocument();
    expect(mockPhoto).not.toHaveBeenCalled();
  });

  it('does not fetch when hn is empty', () => {
    render(<PatientPhoto hn="" config={cfg} />, { wrapper });
    expect(mockPhoto).not.toHaveBeenCalled();
    expect(screen.getByTestId('patient-photo-placeholder')).toBeInTheDocument();
  });

  it('renders the photo <img> once it loads', async () => {
    mockPhoto.mockResolvedValue({ ok: true, blob: jpeg() });
    render(<PatientPhoto hn="000123456" config={cfg} name="นาง ทดสอบ" size={48} />, { wrapper });
    const img = await screen.findByTestId('patient-photo');
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', 'blob:mock-photo');
    // Requests at 2× the display size for retina sharpness.
    expect(mockPhoto).toHaveBeenCalledWith(
      cfg,
      '000123456',
      expect.objectContaining({ width: 96, height: 96 }),
    );
  });

  it('keeps the placeholder when the patient has no photo (404)', async () => {
    mockPhoto.mockResolvedValue({ ok: false, status: 404 });
    render(<PatientPhoto hn="HN1" config={cfg} />, { wrapper });
    await waitFor(() => expect(mockPhoto).toHaveBeenCalled());
    expect(screen.getByTestId('patient-photo-placeholder')).toBeInTheDocument();
    expect(screen.queryByTestId('patient-photo')).not.toBeInTheDocument();
  });
});
