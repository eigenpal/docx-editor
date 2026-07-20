import { test, expect } from '@playwright/test';

test('mounts the Vue editor demo', async ({ page }) => {
  await page.goto('http://localhost:5174/?e2e=1');

  await expect(page.locator('.docx-editor-vue')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Vue' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  await expect(page.locator('.paged-editor__pages')).toBeVisible();
});
