// Playwright config for production-editor Chromium accessibility-tree tests (task 4.7).

import { defineConfig, devices } from '@playwright/test';

const port = 5299;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  // `.pwtest.ts`, not `.spec.ts`: `bun test` claims `*.spec.*` and `*.test.*`, so a
  // Playwright file under `packages/` was being loaded by the unit-test runner too. Two
  // such files in one bun process trip Playwright's own "Requiring @playwright/test
  // second time" guard, which is one of the recorded baseline failures.
  testMatch: '**/accessibility-tree.pwtest.ts',
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
    reuseExistingServer: false,
    timeout: 60_000,
    cwd: '.',
  },
});
