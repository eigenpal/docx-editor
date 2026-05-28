import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test('HF: inserting PAGE field updates header immediately (no space keystroke needed)', async ({
  page,
}) => {
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

  // Engage HF edit mode and place the cursor in a span so the insert lands
  // inside the header rather than at position 0.
  await page.locator('.layout-page-header').first().dblclick();
  await expect(page.locator('.hf-inline-editor')).toHaveCount(1);
  await page.locator('.layout-page-header .layout-table-cell span[data-doc-from]').first().click();

  const headerBefore = await page.locator('.layout-page-header').first().textContent();

  // Click Options → "Insert current page number"
  await page
    .locator('.hf-inline-editor')
    .getByRole('button', { name: /options/i })
    .click();
  await page
    .locator('.hf-inline-editor')
    .getByRole('button', { name: /current page number/i })
    .click();

  // Immediately read the painted header — should reflect the inserted field
  // without any extra keystroke.
  const headerImmediate = await page.locator('.layout-page-header').first().textContent();
  // And after a beat for any deferred repaint.
  await page.waitForTimeout(200);
  const headerAfter = await page.locator('.layout-page-header').first().textContent();

  console.log('BEFORE:', JSON.stringify(headerBefore));
  console.log('IMMEDIATE:', JSON.stringify(headerImmediate));
  console.log('AFTER:', JSON.stringify(headerAfter));

  // Both immediate and delayed reads should differ from the pre-insert text.
  expect(headerImmediate).not.toEqual(headerBefore);
  expect(headerAfter).not.toEqual(headerBefore);
});

test('HF: PAGE field inserted without clicking inside cell first', async ({ page }) => {
  // User's reported flow: double-click header → immediately open Options →
  // Insert page number. No intervening click to place the cursor. The field
  // should still appear in the painted header right away.
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();

  await page
    .locator('input[type="file"][accept=".docx"]')
    .setInputFiles('e2e/fixtures/header-with-table.docx');
  await page.waitForSelector('.layout-page-header [data-from-row]', { timeout: 15000 });

  await page.locator('.layout-page-header').first().dblclick();
  await expect(page.locator('.hf-inline-editor')).toHaveCount(1);

  const headerBefore = await page.locator('.layout-page-header').first().textContent();

  await page
    .locator('.hf-inline-editor')
    .getByRole('button', { name: /options/i })
    .click();
  await page
    .locator('.hf-inline-editor')
    .getByRole('button', { name: /current page number/i })
    .click();

  // No keystroke, no extra click. Read the painted header.
  const headerAfter = await page.locator('.layout-page-header').first().textContent();
  console.log('NO-CELL-CLICK BEFORE:', JSON.stringify(headerBefore));
  console.log('NO-CELL-CLICK AFTER :', JSON.stringify(headerAfter));
  expect(headerAfter).not.toEqual(headerBefore);
});

test('HF: NUMPAGES field renders total page count immediately', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();

  await page
    .locator('input[type="file"][accept=".docx"]')
    .setInputFiles('e2e/fixtures/header-with-table.docx');
  await page.waitForSelector('.layout-page-header [data-from-row]', { timeout: 15000 });

  const totalPages = await page.locator('[data-page-number]').count();

  await page.locator('.layout-page-header').first().dblclick();
  await expect(page.locator('.hf-inline-editor')).toHaveCount(1);
  await page.locator('.layout-page-header .layout-table-cell span[data-doc-from]').first().click();

  await page
    .locator('.hf-inline-editor')
    .getByRole('button', { name: /options/i })
    .click();
  await page
    .locator('.hf-inline-editor')
    .getByRole('button', { name: /total page count/i })
    .click();

  const headerAfter = await page.locator('.layout-page-header').first().textContent();
  console.log('NUMPAGES AFTER:', JSON.stringify(headerAfter), 'totalPages=', totalPages);
  // The resolved value should appear somewhere in the painted header.
  expect(headerAfter).toContain(String(totalPages));
});
