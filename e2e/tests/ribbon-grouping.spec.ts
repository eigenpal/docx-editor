import { test, expect } from '@playwright/test';

test.describe('Ribbon - grouping layout', () => {
  test('groups render as blocks with large actions', async ({ page }) => {
    await page.goto('/?toolbar=ribbon');
    await page.waitForSelector('[data-testid="docx-editor"]');

    const fontGroup = page.getByRole('group', { name: 'Font' });
    await expect(fontGroup).toBeVisible();

    const items = fontGroup.locator('.ribbon__group-content > *');
    const itemCount = await items.count();
    expect(itemCount).toBeGreaterThan(4);

    const tops = await items.evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().top))
    );
    const uniqueTops = Array.from(new Set(tops)).sort((a, b) => a - b);

    expect(uniqueTops.length).toBeGreaterThan(1);
    expect(uniqueTops[uniqueTops.length - 1] - uniqueTops[0]).toBeGreaterThan(12);

    const clipboardGroup = page.getByRole('group', { name: 'Clipboard' });
    await expect(clipboardGroup).toBeVisible();

    const largeItems = clipboardGroup.locator('.ribbon__item--large');
    await expect(largeItems).toHaveCount(1);

    const largeHeight = await largeItems
      .first()
      .evaluate((node) => Math.round(node.getBoundingClientRect().height));
    expect(largeHeight).toBeGreaterThan(60);
  });
});
