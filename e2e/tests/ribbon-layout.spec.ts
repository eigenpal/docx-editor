import { test, expect } from '@playwright/test';

test.describe('Ribbon - layout', () => {
  test('ribbon stays fixed while editor scrolls', async ({ page }) => {
    await page.goto('/?toolbar=ribbon');
    await page.waitForSelector('[data-testid="docx-editor"]');

    const ribbon = page.getByTestId('ribbon');
    const scrollContainer = page.getByTestId('editor-scroll');

    await expect(ribbon).toBeVisible();
    await expect(scrollContainer).toBeVisible();

    const before = await ribbon.boundingBox();
    expect(before).not.toBeNull();

    await scrollContainer.evaluate((el) => {
      el.scrollTop = 500;
    });

    await page.waitForTimeout(100);

    const after = await ribbon.boundingBox();
    expect(after).not.toBeNull();

    expect(before?.y).toBeCloseTo(after?.y ?? 0, 1);
  });
});
