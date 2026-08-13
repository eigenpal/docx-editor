import { defineConfig, devices } from '@playwright/test';

const PORT = 5275;

export default defineConfig({
  testDir: '.',
  testMatch: '**/edit-browser.bench.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    launchOptions: {
      args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
    },
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `bun run dev -- --port ${PORT} --strictPort --force`,
    cwd: '../examples/vite',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
