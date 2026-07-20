import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test('user flow: type into existing run then Insert PAGE → updates immediately', async ({
  page,
}) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();

  await page
    .locator('input[type="file"][accept=".docx"]')
    .setInputFiles('e2e/fixtures/header-with-table.docx');
  await page.waitForSelector('.paged-editor__pages');
  await expect(page.locator('.layout-page-header [data-from-row]')).toHaveCount(1, {
    timeout: 15000,
  });

  await page.locator('.layout-page-header').first().dblclick();
  await expect(page.locator('.hf-inline-editor')).toHaveCount(1);

  // Place cursor in a span and TYPE text — mirrors the user's flow of
  // typing into an existing run before clicking Insert.
  await page.locator('.layout-page-header .layout-table-cell span[data-doc-from]').first().click();
  await page.keyboard.type('TYPED');
  await page.waitForTimeout(50);

  const before = await page.locator('.layout-page-header').first().textContent();

  // Click Options → Insert current page number
  await page
    .locator('.hf-inline-editor')
    .getByRole('button', { name: /options/i })
    .click();
  await page
    .locator('.hf-inline-editor')
    .getByRole('button', { name: /current page number/i })
    .click();

  // Immediately read the painted header — should reflect the inserted "1"
  // without any extra keystroke.
  const immediate = await page.locator('.layout-page-header').first().textContent();
  await page.waitForTimeout(200);
  const after = await page.locator('.layout-page-header').first().textContent();

  console.log('TYPED-THEN-INSERT BEFORE :', JSON.stringify(before));
  console.log('TYPED-THEN-INSERT IMMEDIATE:', JSON.stringify(immediate));
  console.log('TYPED-THEN-INSERT AFTER  :', JSON.stringify(after));

  // The "1" page number should be present immediately.
  expect(immediate).not.toEqual(before);
  expect(immediate).toContain('1');
});
