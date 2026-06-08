// T099: E2E test for dashboard flow
import { test, expect } from '@playwright/test';

test.describe('Dashboard Flow', () => {
  test('redirects unauthenticated user to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('login page shows BMS Session ID input', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input#sessionId')).toBeVisible();
    await expect(page.getByText('เข้าสู่ระบบ SR-LRMS')).toBeVisible();
  });

  test('shows error for invalid session ID', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input#sessionId', 'invalid-session');
    await page.click('button[type="submit"]');
    await expect(page.getByText(/ไม่ถูกต้องหรือหมดอายุ|ข้อผิดพลาด/)).toBeVisible({ timeout: 10000 });
  });

  // NOTE: Full auth flow requires a valid BMS Session ID from a running tunnel
  // These tests serve as smoke tests for the UI components

  test.skip('authenticated dashboard loads hospital table', async ({ page }) => {
    // Requires valid auth session
    await page.goto('/');
    await expect(page.getByText('SR-LRMS')).toBeVisible();
    await expect(page.locator('table')).toBeVisible();
  });

  test.skip('click hospital row navigates to patient list', async ({ page }) => {
    // Requires valid auth session + hospital data
    await page.goto('/');
    await page.locator('table tbody tr').first().click();
    await expect(page).toHaveURL(/\/hospitals\//);
  });
});
