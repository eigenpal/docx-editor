import { test, expect } from '@playwright/test';

// Vue mirror of e2e/tests/hf-click-and-type.spec.ts — verifies that clicking
// inside the painted header during HF edit mode lands the caret in the HF
// EditorView (not the body), and typing inserts into header text.
test('Vue: HF click → place cursor → type lands in header', async ({ page }) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.locator('.paged-editor__pages').waitFor();

  // Load fixture via the example's file input.
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles('e2e/fixtures/header-with-table.docx');

  await page.waitForSelector('[data-page-number]');
  await expect(page.locator('.layout-page-header [data-from-row]')).toHaveCount(1, {
    timeout: 15000,
  });

  // Double-click the header to engage edit mode.
  const header = page.locator('.layout-page-header').first();
  await header.dblclick();

  // Vue's overlay class is `.hf-editor` (React uses `.hf-inline-editor`).
  await expect(page.locator('.hf-editor')).toHaveCount(1);

  // Click a painted span inside a header table cell to place the cursor.
  const span = page.locator('.layout-page-header .layout-table-cell span[data-doc-from]').first();
  await span.click();

  await page.keyboard.type('VUEZZ');

  const headerText = await page.locator('.layout-page-header').first().textContent();
  expect(headerText).toContain('VUEZZ');

  const bodyText = await page.locator('.layout-page-content').first().textContent();
  expect(bodyText).not.toContain('VUEZZ');
});
