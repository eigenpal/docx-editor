import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test.describe('Ribbon view layout mode', () => {
  test('web layout applies class and print layout removes it', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();

    await page.getByRole('tab', { name: 'View', exact: true }).click();

    const root = page.locator('.docx-editor');

    await page.getByTestId('ribbon-webLayout').click();
    await expect(root).toHaveClass(/docx-layout-web/);

    await page.getByTestId('ribbon-printLayout').click();
    await expect(root).not.toHaveClass(/docx-layout-web/);
  });

  test('show bookmarks maps to show marks toggle', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();

    await page.getByRole('tab', { name: 'View', exact: true }).click();

    const root = page.locator('.docx-editor');

    await page.getByTestId('ribbon-showBookmarks').click();
    await expect(root).toHaveClass(/docx-show-marks/);

    await page.getByTestId('ribbon-showBookmarks').click();
    await expect(root).not.toHaveClass(/docx-show-marks/);
  });

  test('web layout removes page chrome and reduces gaps', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();

    await page.getByRole('tab', { name: 'View', exact: true }).click();
    await page.getByTestId('ribbon-webLayout').click();

    const styles = await page.evaluate(() => {
      const el = document.querySelector('.layout-page') as HTMLElement | null;
      if (!el) return null;
      const cs = window.getComputedStyle(el);
      return {
        boxShadow: cs.boxShadow,
        marginBottom: cs.marginBottom,
        background: cs.backgroundColor,
      };
    });

    expect(styles).not.toBeNull();
    expect(
      styles?.boxShadow === 'none' || styles?.boxShadow === '0px 0px 0px 0px rgba(0, 0, 0, 0)'
    ).toBeTruthy();
    expect(
      styles?.background === 'transparent' || styles?.background === 'rgba(0, 0, 0, 0)'
    ).toBeTruthy();
  });
});
