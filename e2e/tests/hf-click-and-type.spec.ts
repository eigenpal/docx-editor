import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

// Smoke test for the user-reported #468 regression: double-click the header,
// then a single click inside a cell should place the cursor there, and
// keystrokes should land in the header (not the body).
test('HF click → place cursor → type lands in header', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();

  await page
    .locator('input[type="file"][accept=".docx"]')
    .setInputFiles('e2e/fixtures/header-with-table.docx');
  await page.waitForSelector('.paged-editor__pages');
  await page.waitForSelector('[data-page-number]');
  await expect(page.locator('.layout-page-header [data-from-row]')).toHaveCount(1, {
    timeout: 15000,
  });

  // Double-click the header to engage edit mode.
  const header = page.locator('.layout-page-header').first();
  await header.dblclick();
  await expect(page.locator('.hf-inline-editor')).toHaveCount(1);

  // Find a painted span inside a table cell so we're not clicking on
  // the separator chrome bar at the top of the overlay.
  const span = page.locator('.layout-page-header .layout-table-cell span[data-doc-from]').first();
  await span.click();

  // Now type a marker string. It must land in the header.
  await page.keyboard.type('ZZZMARK');

  const headerText = await page.locator('.layout-page-header').first().textContent();
  expect(headerText).toContain('ZZZMARK');

  // And the body must NOT contain the marker.
  const bodyText = await page.locator('.layout-page-content').first().textContent();
  expect(bodyText).not.toContain('ZZZMARK');
});
