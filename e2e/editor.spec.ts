import { test, expect } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('DOCX Editor', () => {
  test('page loads without errors', async ({ page }) => {
    // Listen for console errors
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');

    // Wait for app to load
    await page.waitForSelector('#app', { timeout: 10000 });

    // Take screenshot
    await page.screenshot({ path: 'screenshots/01-page-load.png', fullPage: true });

    // Check no console errors
    expect(errors.filter((e) => !e.includes('favicon'))).toHaveLength(0);
  });

  test('displays placeholder when no document loaded', async ({ page }) => {
    await page.goto('/');

    // Should show some placeholder or empty state
    const content = await page.textContent('body');

    await page.screenshot({ path: 'screenshots/02-empty-state.png', fullPage: true });

    // Placeholder text or empty editor should be present
    expect(content).toBeTruthy();
  });
});
