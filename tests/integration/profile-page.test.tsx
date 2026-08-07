import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfilePage } from '@/app/(hospital)/profile/page';

vi.mock('@/lib/auth', () => ({
  auth: async () => ({
    user: {
      name: 'นาย ชัยพร สุรเตมีย์กุล',
      userCid: '3320500282121',
      hospitalCode: '10670',
      hospitalName: 'รพ.ทดสอบ',
      role: 'NURSE',
    },
  }),
}));

const fetched = vi.fn(async (_url: string, init?: { body?: string }) => ({
  ok: true,
  async json() {
    return init?.body?.includes('"mophLineEnabled":true')
      ? { userCid: '3320500282121', hospitalCode: '10670', mophLineEnabled: true }
      : { userCid: '3320500282121', hospitalCode: '10670', mophLineEnabled: false };
  },
}));
vi.stubGlobal('fetch', fetched);

describe('profile notification page', () => {
  it('renders masked identity + toggle and flips on click', async () => {
    // react-dom/client does not resolve async function components; the page is
    // a server component, so render the awaited element (same assertions as if
    // React pumped the promise — masked CID regex + aria-checked flip).
    render(await ProfilePage());
    // masked CID: first char + 8 X + last 4
    await screen.findByText(/3X{8}2121/);
    const toggle = await screen.findByRole('switch');
    // jsdom does not reflect the hyphenated `aria-checked` property, so assert
    // the rendered attribute instead. Also wait until the initial GET commits
    // (enabled !== null) — otherwise the click is a no-op guard return.
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });
});
