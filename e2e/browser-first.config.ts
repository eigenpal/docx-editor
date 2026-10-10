// Playwright config for the browser-first React feedback checkpoint (tasks 2.2–2.6).
//
// REACT ONLY, on purpose. `editor-smoke.config.ts` declares both demo dev servers because
// its specs assert React/Vue parity; this checkpoint has no Vue side — the spec puts
// paired adapter work in section 9, after the engine behavior stabilizes. Booting a Vue
// server for it cost minutes per run and starved the React page into navigation timeouts.

import { defineConfig, devices } from '@playwright/test';

const REACT_PORT = 5273;

export default defineConfig({
  testDir: '.',
  testMatch: ['**/browser-first-*.spec.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: `bun run dev -- --port ${REACT_PORT} --strictPort`,
      cwd: '../examples/vite',
      url: `http://localhost:${REACT_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
