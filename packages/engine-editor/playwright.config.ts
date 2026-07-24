// Playwright config for production-editor Chromium accessibility-tree tests (task 4.7).

import { defineConfig, devices } from '@playwright/test';

const port = 5299;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/accessibility-tree.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    baseURL: baseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bun run dev:a11y-harness',
    url: baseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    cwd: '.',
  },
});
