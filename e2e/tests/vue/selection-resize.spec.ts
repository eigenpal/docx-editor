import { test, expect } from '@playwright/test';

test('Vue: body selection geometry follows the page after viewport resize', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.locator('.paged-editor__pages').waitFor();
  await page.waitForSelector('.layout-page-content span[data-doc-from]');

  const span = page.locator('.layout-page-content span[data-doc-from]').first();
  await span.click();
  await page.keyboard.press('Shift+ArrowRight');

  const selection = page.locator('.ep-selection-rect').first();
  await expect(selection).toBeVisible();

  const relativeLeft = async () => {
    const [spanBox, selectionBox] = await Promise.all([span.boundingBox(), selection.boundingBox()]);
    expect(spanBox).not.toBeNull();
    expect(selectionBox).not.toBeNull();
    return selectionBox!.x - spanBox!.x;
  };

  const before = await relativeLeft();
  await page.setViewportSize({ width: 1500, height: 900 });
  await expect.poll(relativeLeft).toBeCloseTo(before, 1);
});
