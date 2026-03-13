import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

async function getViewportScale(page: any): Promise<number> {
  return await page.evaluate(() => {
    const pages = document.querySelector('.paged-editor__pages') as HTMLElement | null;
    const viewport = pages?.parentElement as HTMLElement | null;
    const transform = viewport?.style.transform || '';
    const match = transform.match(/scale\(([^)]+)\)/);
    if (!match) return 1;
    const value = parseFloat(match[1]);
    return Number.isFinite(value) ? value : 1;
  });
}

test.describe('Ribbon view toggles', () => {
  test('ruler toggle shows and hides rulers', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();

    await page.getByRole('tab', { name: 'View', exact: true }).click();

    const horizontalRuler = page.locator('.docx-horizontal-ruler');
    const verticalRuler = page.locator('.docx-vertical-ruler');
    const wasVisible = await horizontalRuler.isVisible();

    await page.getByTestId('ribbon-showRuler').click();
    if (wasVisible) {
      await expect(horizontalRuler).toHaveCount(0);
      await expect(verticalRuler).toHaveCount(0);

      await page.getByTestId('ribbon-showRuler').click();
      await expect(horizontalRuler).toBeVisible();
      await expect(verticalRuler).toBeVisible();
    } else {
      await expect(horizontalRuler).toBeVisible();
      await expect(verticalRuler).toBeVisible();

      await page.getByTestId('ribbon-showRuler').click();
      await expect(horizontalRuler).toHaveCount(0);
      await expect(verticalRuler).toHaveCount(0);
    }
  });

  test('page width and one page zoom update viewport scale', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 600 });
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();

    await page.getByRole('tab', { name: 'View', exact: true }).click();

    await page.getByTestId('ribbon-zoomPageWidth').click();
    await page.waitForTimeout(150);
    const pageWidthScale = await getViewportScale(page);

    await page.getByTestId('ribbon-zoomOnePage').click();
    await page.waitForTimeout(150);
    const onePageScale = await getViewportScale(page);

    expect(onePageScale).toBeLessThanOrEqual(pageWidthScale + 0.01);
  });
});
