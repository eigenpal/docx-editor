import path from 'node:path';
import { expect, forEachAdapter } from '../parity-fixture';

const WATERMARK_FIXTURE = path.resolve('e2e/fixtures/watermark-confidential.docx');

// Watermarks are parsed, measured and painted by the shared core
// (`renderWatermarkLayer`), so both adapters must surface the same
// behind-content layer when a watermark-bearing document is opened.
forEachAdapter('smoke: watermark renders behind content', async (adapter, { page }) => {
  await page.goto(`${adapter.baseUrl}/?e2e=1`);
  await page.waitForSelector(adapter.readySelector, { timeout: 25000 });
  await expect(page.locator('.paged-editor__pages')).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles(WATERMARK_FIXTURE);

  // The watermark layer only exists once a page has painted, so waiting for it
  // doubles as proof the document rendered.
  const layer = page.locator('.layout-watermark-layer').first();
  await expect(layer).toBeVisible({ timeout: 25000 });
  await expect(layer).toContainText('CONFIDENTIAL');
});
