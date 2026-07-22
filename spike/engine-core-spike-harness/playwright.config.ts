import { defineConfig, devices } from '@playwright/test';

const pocPort = 5199;
const pocBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${pocPort}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: [['list']],
  use: {
    baseURL: pocBaseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'bun run dev:poc',
    url: pocBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
