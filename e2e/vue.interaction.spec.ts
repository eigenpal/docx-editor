import { expect, test } from '@playwright/test';
import { PAINTED_PAGE } from './painted-page.ts';

const VUE_URL = 'http://localhost:5274/';

test.describe('Vue contextual interactions', () => {
  test('editing mode moves focus into its open menu', async ({ page }) => {
    await page.goto(`${VUE_URL}?fixture=review-clean-demo.docx`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('composed-mount')).toBeVisible();
    await page.waitForSelector(PAINTED_PAGE, { timeout: 30_000 });

    await page.getByTestId('editing-mode-trigger').click();
    const checked = page.locator('[role="menuitemradio"][aria-checked="true"]');
    await expect(checked).toBeFocused();
  });

  test('ArrowDown moves focus into toolbar overflow', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 800 });
    await page.goto(`${VUE_URL}?fixture=review-clean-demo.docx`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('composed-mount')).toBeVisible();
    await page.waitForSelector(PAINTED_PAGE, { timeout: 30_000 });

    const trigger = page.locator('[data-slot="toolbar.more"]');
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    const panel = page.getByTestId('toolbar-overflow-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator(':focus')).toHaveCount(1);
  });

  test('table menu focuses its selection and Escape restores its trigger', async ({ page }) => {
    await page.goto(`${VUE_URL}?fixture=hyperlink-demo.docx`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('composed-mount')).toBeVisible();
    await page.waitForSelector(PAINTED_PAGE, { timeout: 30_000 });

    await page.locator('.docx-table-cell').first().click();
    const root = page.locator('[data-slot="table.borderTarget"]').first();
    const trigger = root.locator('.docx-table-chrome__trigger');
    await expect(trigger).toBeEnabled();
    await trigger.click();
    const menu = root.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[role="menuitemradio"]').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    const colorRoot = page.locator('[data-slot="table.borderColor"]').first();
    const colorTrigger = colorRoot.locator('.docx-toolbar__colorsplit-caret');
    await colorTrigger.click();
    const dialog = colorRoot.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('button').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(colorTrigger).toBeFocused();
  });

  test('nested menu flyouts open beside their parent row', async ({ page }) => {
    await page.goto(`${VUE_URL}?fixture=review-clean-demo.docx`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('composed-mount')).toBeVisible();
    await page.waitForSelector(PAINTED_PAGE, { timeout: 30_000 });

    await page.getByRole('menuitem', { name: 'Insert', exact: true }).click();
    const breakRow = page.getByRole('menuitem', { name: 'Break', exact: true });
    await breakRow.hover();
    const flyout = page.locator('.docx-menubar__submenu-panel');
    await expect(flyout).toBeVisible();
    const [rowBox, flyoutBox] = await Promise.all([breakRow.boundingBox(), flyout.boundingBox()]);
    expect(flyoutBox?.x ?? 0).toBeGreaterThanOrEqual(rowBox?.x ?? 0);
    await expect(flyout.getByRole('menuitem', { name: 'Page break' })).toBeVisible();
  });

  test('clicking an external hyperlink opens and positions its popup', async ({ page }) => {
    await page.goto(`${VUE_URL}?fixture=hyperlink-demo.docx`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('composed-mount')).toBeVisible();
    await page.waitForSelector(PAINTED_PAGE, { timeout: 30_000 });

    const link = page.locator('.docx-hyperlink').filter({ hasText: 'Example' });
    await expect(link).toBeVisible();
    await link.click();

    const popup = page.getByTestId('hyperlink-popup');
    await expect(popup).toBeVisible();
    const [linkBox, popupBox] = await Promise.all([link.boundingBox(), popup.boundingBox()]);
    expect(popupBox?.x).toBeCloseTo(linkBox?.x ?? 0, 0);
    expect(popupBox?.y ?? 0).toBeGreaterThanOrEqual(linkBox?.y ?? 0);

    await page.getByTestId('hyperlink-popup-edit').click();
    await expect(page.getByTestId('hyperlink-popup-url-input')).toBeFocused();
  });

  test('the hyperlink popup opens its safe external target', async ({ page }) => {
    await page.goto(`${VUE_URL}?fixture=hyperlink-demo.docx`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('composed-mount')).toBeVisible();
    await page.waitForSelector(PAINTED_PAGE, { timeout: 30_000 });

    const link = page.locator('.docx-hyperlink').filter({ hasText: 'Example' });
    await link.click();
    const opened = page.waitForEvent('popup');
    await page.getByTestId('hyperlink-popup-url').click();
    const target = await opened;
    await target.waitForLoadState('domcontentloaded');
    expect(target.url()).toBe('https://example.com/');
    await target.close();
  });
});
