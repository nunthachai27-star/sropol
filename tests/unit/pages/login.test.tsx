// Login page smoke tests — component render tests
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock next-auth/react before importing the page
vi.mock('next-auth/react', () => ({
  signIn: vi.fn(),
}));

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

import LoginPage from '@/app/(auth)/login/page';

describe('Login Page', () => {
  it('renders login heading', () => {
    render(<LoginPage />);
    // "เข้าสู่ระบบ" appears in the heading and the button
    const elements = screen.getAllByText(/เข้าสู่ระบบ/);
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it('renders session ID input field', () => {
    render(<LoginPage />);
    const input = screen.getByPlaceholderText('กรอก Session ID จาก BMS');
    expect(input).toBeTruthy();
    expect(input.getAttribute('id')).toBe('sessionId');
  });

  it('renders submit button with correct text', () => {
    render(<LoginPage />);
    const button = screen.getByRole('button', { name: /เข้าสู่ระบบ/ });
    expect(button).toBeTruthy();
  });

  it('renders the subtitle description', () => {
    render(<LoginPage />);
    // Subtitle text appears in both mobile and desktop headers
    const elements = screen.getAllByText(/ระบบติดตามการคลอด/);
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it('renders BMS Session ID label', () => {
    render(<LoginPage />);
    expect(screen.getByText('BMS Session ID')).toBeTruthy();
  });

  it('renders SR-LRMS title', () => {
    render(<LoginPage />);
    // SR-LRMS appears in both mobile header and desktop left panel
    const elements = screen.getAllByText('SR-LRMS');
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });
});
