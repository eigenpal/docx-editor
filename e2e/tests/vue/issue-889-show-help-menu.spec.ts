import { test, expect } from '@playwright/test';

/**
 * #889 — Vue parity for the React `showHelpMenu` prop. The Help menu shows by
 * default and is removed (without dropping the other menus) when the prop is
 * false. The demo maps `?hideHelpMenu=1` to `showHelpMenu={false}`.
 */
test('Vue shows the Help menu by default', async ({ page }) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.waitForSelector('.docx-editor-vue__pages .layout-page', { timeout: 15000 });

  await expect(page.locator('.docx-menu-dropdown__trigger', { hasText: 'Help' })).toBeVisible();
});

test('Vue hides the Help menu when showHelpMenu is false', async ({ page }) => {
  await page.goto('http://localhost:5174/?e2e=1&hideHelpMenu=1');
  await page.waitForSelector('.docx-editor-vue__pages .layout-page', { timeout: 15000 });

  // Other menus still render — only Help is gone.
  await expect(page.locator('.docx-menu-dropdown__trigger', { hasText: 'Format' })).toBeVisible();
  await expect(page.locator('.docx-menu-dropdown__trigger', { hasText: 'Help' })).toHaveCount(0);
});
