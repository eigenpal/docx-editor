import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: '.',
  testMatch: 'server-agent-review.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:5280',
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node dev.mjs',
    cwd: '../examples/server-agent-review',
    url: 'http://localhost:5280',
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      REVIEW_UI_PORT: '5280',
      REVIEW_API_PORT: '3280',
      COLLAB_PORT: '1380',
      COLLAB_URL: 'ws://127.0.0.1:1380',
      REVIEW_SCRIPT_DELAY_MS: '900',
      OPENAI_API_KEY: '',
      REVIEW_DATA_DIR: path.resolve(`examples/server-agent-review/.data/e2e-${process.pid}`),
    },
  },
});
