import { defineConfig, devices } from '@playwright/test';

// The React-only large-document perf specs (and the !check-performance workflow)
// don't need the Vue/Nuxt demos. Setting PERF_REACT_ONLY=1 boots just the React
// dev server, which avoids the slow Nuxt startup and keeps the perf job lean.
const reactDevServer = {
  command: 'bun run dev:react',
  url: 'http://localhost:5173',
  reuseExistingServer: !process.env.CI,
  timeout: 60 * 1000,
};
const vueDevServer = {
  command: 'bun run dev:vue',
  url: 'http://localhost:5174',
  reuseExistingServer: !process.env.CI,
  timeout: 60 * 1000,
};
const nuxtDevServer = {
  // Nuxt dev is slower to boot than Vite — allow extra startup time.
  command: 'bun run dev:nuxt',
  url: 'http://localhost:3002',
  reuseExistingServer: !process.env.CI,
  timeout: 120 * 1000,
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Use 4 workers locally for faster execution, 1 in CI for stability
  workers: process.env.CI ? 1 : 4,
  // Default timeout of 30s per test (can override with --timeout flag)
  timeout: 30000,
  // Expect timeout for assertions
  expect: {
    timeout: 5000,
  },
  reporter: [
    ['list'],
    // Only generate HTML report in CI or when explicitly requested
    ...(process.env.CI || process.env.HTML_REPORT ? [['html', { open: 'never' }] as const] : []),
  ],

  use: {
    baseURL: 'http://localhost:5173',
    // Only trace/screenshot on failure to speed up passing tests
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    // Faster action timeouts
    actionTimeout: 10000,
    navigationTimeout: 15000,
    // Grant clipboard permissions for copy/paste tests
    permissions: ['clipboard-read', 'clipboard-write'],
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // React-only specs run against the React demo (port 5173).
      testIgnore: ['**/parity/**', '**/vue/**', '**/nuxt/**'],
    },
    {
      name: 'vue',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['**/vue/**/*.spec.ts'],
    },
    {
      // Smoke specs for the Nuxt module demo (port 3002).
      name: 'nuxt',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['**/nuxt/**/*.spec.ts'],
    },
    {
      // Parity specs target both adapters via the `parityCases` fixture.
      // The fixture file is excluded from `testMatch` so Playwright doesn't
      // treat it as a spec.
      name: 'parity',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['**/parity/**/*.spec.ts'],
    },
  ],

  /* Run dev servers before tests */
  webServer: process.env.PERF_REACT_ONLY
    ? [reactDevServer]
    : [reactDevServer, vueDevServer, nuxtDevServer],

  /* Output directory for screenshots */
  outputDir: './screenshots/test-results',
});
