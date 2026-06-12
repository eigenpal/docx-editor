/**
 * Vue image insertion mirrors React: Insert > Image opens the OS file picker and
 * inserts the image directly through the shared core `insertImageFromFile` flow
 * — no intermediate dialog. The image is fitted to the page content width on
 * insert, so a picture wider than the column never gets scaled down by the
 * painter's `max-width: 100%` (which would leave a tall gap below it).
 */
import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WIDE_IMAGE = path.join(__dirname, '..', '..', 'fixtures', 'wide-test-image.png');

async function loadEditor(page: Page) {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.locator('[data-page-number]').first().waitFor();
}

test('Vue: Insert > Image inserts directly (no dialog), fit to the page, no gap below', async ({
  page,
}) => {
  await loadEditor(page);

  // No intermediate modal exists — the menu just clicks this hidden input.
  await expect(page.locator('.dialog__title', { hasText: 'Insert Image' })).toHaveCount(0);

  // Drive the hidden image input directly (the OS picker can't be scripted);
  // this is exactly what the menu's `input.click()` would surface.
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles(WIDE_IMAGE);

  const img = page.locator('.layout-run-image').first();
  await expect(img).toBeVisible({ timeout: 10000 });

  const m = await img.evaluate((el) => {
    const ir = el.getBoundingClientRect();
    const line = el.closest('.layout-line');
    return {
      imgW: ir.width,
      imgH: ir.height,
      lineH: line ? line.getBoundingClientRect().height : 0,
    };
  });

  // The 1000px-wide image was clamped to the page content width (~612), not
  // inserted at full natural width — so the painter never scales it down.
  expect(m.imgW).toBeLessThanOrEqual(620);
  // The image's line reserves only the image's height (plus a few px of
  // leading) — no tall phantom gap below it, which is the bug this prevents.
  expect(m.lineH - m.imgH).toBeLessThan(20);
});
