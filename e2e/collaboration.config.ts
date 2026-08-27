import { defineConfig, devices } from '@playwright/test';

const PORT = Number.parseInt(process.env.COLLAB_E2E_PORT ?? '5276', 10);

export default defineConfig({
  testDir: '.',
  testMatch: [
    '**/collaboration.{interaction,fulldocument,resilience,reviewwrites,presence,images}.spec.ts',
    '**/editor-image-selection.spec.ts',
  ],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 180_000,
  },
  webServer: {
    command: `bun run dev -- --port ${PORT} --strictPort --force`,
    cwd: '../examples/vite',
    url: `http://localhost:${PORT}/`,
    // The vite config reads this to disable HMR, so a concurrent source edit
    // cannot remount the editor mid-suite.
    env: { COLLAB_E2E: '1' },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
