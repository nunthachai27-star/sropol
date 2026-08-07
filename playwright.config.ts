import { defineConfig, devices } from '@playwright/test';

// E2E config. Only *.spec.ts files run under Playwright — tests/e2e/*.test.ts
// belong to vitest (see vitest.config.ts include pattern).
//
// The chromium project launches with fake media devices so WebRTC tests
// (video-call-media.spec.ts) can exercise camera/microphone without hardware:
// getUserMedia succeeds instantly and produces a synthetic video pattern.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
  ],
});
