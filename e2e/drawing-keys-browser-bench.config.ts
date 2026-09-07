import { defineConfig } from '@playwright/test';
import editBrowserBenchConfig from './edit-browser-bench.config.ts';

export default defineConfig({
  ...editBrowserBenchConfig,
  testMatch: '**/drawing-keys-browser.bench.spec.ts',
});
