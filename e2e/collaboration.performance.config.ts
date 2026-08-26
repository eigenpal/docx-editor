import { defineConfig, devices } from '@playwright/test';

const PORT = Number.parseInt(process.env.COLLAB_E2E_PORT ?? '5331', 10);

export default defineConfig({
  testDir: '.',
  testMatch: '**/collaboration.performance.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    launchOptions: {
      args: ['--enable-precise-memory-info'],
    },
    trace: 'off',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 180_000,
  },
  webServer: {
    command: `bun run dev -- --port ${PORT} --strictPort --force`,
    cwd: '../examples/vite',
    url: `http://localhost:${PORT}/`,
    // The vite config reads this to disable HMR, so a concurrent source edit
    // cannot remount the editor mid-suite. `reuseExistingServer: false` matches
    // the other collaboration configs: a stale server without this env would
    // run the suite with HMR live.
    env: { COLLAB_E2E: '1' },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
