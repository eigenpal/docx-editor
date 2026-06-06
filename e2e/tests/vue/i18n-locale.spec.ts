import { test, expect } from '@playwright/test';

// The Vue demo mounts the German i18n pack when `?locale=de` is present
// (see examples/vue/src/App.vue). These specs lock in that the toolbar
// tooltips and the right-click context menu route through `t()` rather
// than hardcoded English literals.
const VUE_DE = 'http://localhost:5174/?e2e=1&locale=de';

test.describe('Vue: i18n locale drives toolbar tooltips + context menu', () => {
  test('formatting toolbar tooltips are localized (German)', async ({ page }) => {
    await page.goto(VUE_DE);
    await page.locator('.docx-editor-vue').waitFor({ timeout: 15000 });
    await page.locator('.basic-toolbar').waitFor({ timeout: 15000 });

    // Shortcut-bearing buttons that previously showed hardcoded English.
    await expect(page.locator('.basic-toolbar button[title="Fett (Strg+B)"]')).toBeVisible();
    await expect(page.locator('.basic-toolbar button[title="Kursiv (Strg+I)"]')).toBeVisible();
    await expect(
      page.locator('.basic-toolbar button[title="Unterstrichen (Strg+U)"]')
    ).toBeVisible();
    await expect(
      page.locator('.basic-toolbar button[title="Link einfügen (Strg+K)"]')
    ).toBeVisible();

    // Sanity: no English shortcut tooltip leaks through.
    await expect(page.locator('.basic-toolbar button[title="Bold (Ctrl+B)"]')).toHaveCount(0);
  });

  test('right-click text context menu is localized (German)', async ({ page }) => {
    await page.goto(VUE_DE);
    await page.locator('.docx-editor-vue').waitFor({ timeout: 15000 });
    await page.locator('.paged-editor__pages').waitFor({ timeout: 15000 });
    await page.waitForSelector('[data-page-number]');

    const content = page.locator('.layout-page-content').first();
    await content.click();
    // Select all so Cut/Copy are enabled; the right-click lands inside the
    // selection so it doesn't collapse the caret.
    await page.keyboard.press('Control+a');
    await content.click({ button: 'right' });

    const menu = page.locator('.ctx-menu');
    await expect(menu).toBeVisible({ timeout: 3000 });
    await expect(menu.locator('.ctx-menu__label', { hasText: 'Ausschneiden' })).toBeVisible();
    await expect(menu.locator('.ctx-menu__shortcut', { hasText: 'Strg+X' })).toBeVisible();
    await expect(menu.locator('.ctx-menu__label', { hasText: 'Kopieren' })).toBeVisible();
    await expect(menu.locator('.ctx-menu__label', { hasText: 'Alles markieren' })).toBeVisible();
  });
});
