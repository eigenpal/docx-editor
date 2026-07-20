import { test, expect } from '@playwright/test';

test('mounts the editor from the Nuxt module', async ({ page }) => {
  await page.goto('http://localhost:3002/');

  // The module registers <DocxEditor> client-only; it hydrates in the browser.
  await expect(page.locator('.docx-editor-vue')).toBeVisible();
  await expect(page.locator('.paged-editor__pages')).toBeVisible();
  await expect(page.getByText('Open DOCX')).toBeVisible();
});
