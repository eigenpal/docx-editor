import { expect, test } from '@playwright/test';

const VUE_URL = 'http://localhost:5274/';

test.describe('Vue contextual interactions', () => {
  test('nested menu flyouts open beside their parent row', async ({ page }) => {
    await page.goto(`${VUE_URL}?fixture=review-clean-demo.docx`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('composed-mount')).toBeVisible();
    await page.waitForSelector('.docx-page', { timeout: 30_000 });

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
    await page.waitForSelector('.docx-page', { timeout: 30_000 });

    const link = page.locator('.docx-hyperlink').filter({ hasText: 'Example' });
    await expect(link).toBeVisible();
    await link.click();

    const popup = page.getByTestId('hyperlink-popup');
    await expect(popup).toBeVisible();
    const [linkBox, popupBox] = await Promise.all([link.boundingBox(), popup.boundingBox()]);
    expect(popupBox?.x).toBeCloseTo(linkBox?.x ?? 0, 0);
    expect(popupBox?.y ?? 0).toBeGreaterThanOrEqual(linkBox?.y ?? 0);

    const opened = page.waitForEvent('popup');
    await page.getByTestId('hyperlink-popup-url').click();
    const target = await opened;
    await target.waitForLoadState('domcontentloaded');
    expect(target.url()).toBe('https://example.com/');
    await target.close();
  });
});
