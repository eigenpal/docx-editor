import { test, expect } from '@playwright/test';

test.describe('Ribbon - style metrics', () => {
  test('tabs, groups, and buttons match expected metrics', async ({ page }) => {
    await page.goto('/?toolbar=ribbon');
    await page.waitForSelector('[data-testid="ribbon"]');

    const tabText = page.getByRole('tab', { name: 'Home' }).locator('.ribbon__tab-text');
    await expect(tabText).toHaveCSS('font-size', '14px');
    await expect(tabText).toHaveCSS('font-weight', '600');

    const tabRow = page.getByTestId('ribbon').locator('.ribbon__tabs');
    await expect(tabRow).toHaveCSS('height', '47px');

    const activeTab = page.getByRole('tab', { name: 'Home' });
    const activeTabBackground = await activeTab.evaluate(
      (node) => getComputedStyle(node).backgroundColor
    );
    expect(activeTabBackground).not.toBe('rgba(0, 0, 0, 0)');

    const groupLabel = page.getByTestId('ribbon').locator('.ribbon__group-label').first();
    await expect(groupLabel).toHaveCSS('font-size', '10px');

    const ribbonBox = await page.getByTestId('ribbon').boundingBox();
    const labelBox = await groupLabel.boundingBox();
    expect(ribbonBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    if (ribbonBox && labelBox) {
      expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(ribbonBox.y + ribbonBox.height - 1);
    }

    const iconButton = page.getByTestId('ribbon').locator('.ribbon__button').first();
    await expect(iconButton).toHaveCSS('height', '34px');
  });
});
