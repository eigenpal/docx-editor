import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const getMenu = (page) => page.locator('[role="menu"]').first();

test.describe('Ribbon - Page Setup dropdowns', () => {
  test('margins dropdown applies preset and shows checkmark', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();

    await page.getByRole('tab', { name: 'Layout' }).click();
    const pageBox = await page.locator('.layout-page').first().boundingBox();
    expect(pageBox).not.toBeNull();

    const contentBoxBefore = await page.locator('.layout-page-content').first().boundingBox();
    expect(contentBoxBefore).not.toBeNull();
    const beforeLeft = Math.round(contentBoxBefore!.x - pageBox!.x);
    const beforeTop = Math.round(contentBoxBefore!.y - pageBox!.y);

    await page.getByTestId('ribbon-margins').click();
    const menu = getMenu(page);
    await expect(menu).toBeVisible();
    const narrowItem = menu.getByRole('menuitem').filter({ hasText: 'Narrow' });
    await narrowItem.click();

    const contentBoxAfter = await page.locator('.layout-page-content').first().boundingBox();
    expect(contentBoxAfter).not.toBeNull();
    const afterLeft = Math.round(contentBoxAfter!.x - pageBox!.x);
    const afterTop = Math.round(contentBoxAfter!.y - pageBox!.y);

    expect(beforeLeft).toBeGreaterThan(afterLeft);
    expect(beforeTop).toBeGreaterThan(afterTop);
    expect(Math.abs(beforeLeft - afterLeft - 48)).toBeLessThanOrEqual(4);
  });

  test('orientation dropdown applies landscape', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();

    await page.getByRole('tab', { name: 'Layout' }).click();
    await page.getByTestId('ribbon-orientation').click();

    const menu = getMenu(page);
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem').filter({ hasText: 'Landscape' }).click();

    const pageBox = await page.locator('.layout-page').first().boundingBox();
    expect(pageBox).not.toBeNull();
    expect(pageBox!.width).toBeGreaterThan(pageBox!.height);
  });

  test('size dropdown applies A4', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();

    await page.getByRole('tab', { name: 'Layout' }).click();
    await page.getByTestId('ribbon-size').click();

    const menu = getMenu(page);
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem').filter({ hasText: 'A4' }).click();

    const pageEl = page.locator('.layout-page').first();
    const width = await pageEl.evaluate((el) => parseFloat((el as HTMLElement).style.width));
    const height = await pageEl.evaluate((el) => parseFloat((el as HTMLElement).style.height));
    expect(Math.round(width)).toBeCloseTo(794, 1);
    expect(Math.round(height)).toBeCloseTo(1123, 1);
  });
});
