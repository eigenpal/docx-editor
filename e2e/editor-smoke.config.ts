// Playwright config for the paired editing-vertical smoke tests (queue item 3). Starts
// both demo dev servers on dedicated ports and drives the engine-neutral EditorDriver
// (window.__docxEditorDriver) in each adapter. The two specs assert IDENTICAL behavior,
// so the checkpoint fails if only one adapter works.

import { defineConfig, devices } from '@playwright/test';

const REACT_PORT = 5273;
const VUE_PORT = 5274;

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.smoke.spec.ts', '**/*.gate.spec.ts'],
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
  metadata: { reactPort: REACT_PORT, vuePort: VUE_PORT },
  webServer: [
    {
      command: `bun run dev -- --port ${REACT_PORT} --strictPort --force`,
      cwd: '../examples/vite',
      url: `http://localhost:${REACT_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `bun run dev -- --port ${VUE_PORT} --strictPort --force`,
      cwd: '../examples/vue',
      url: `http://localhost:${VUE_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
