import { test, expect } from '@playwright/test';

test.describe('Ribbon - tab integration', () => {
  test('active tab blends into ribbon surface', async ({ page }) => {
    await page.goto('/?toolbar=ribbon');
    await page.waitForSelector('[data-testid="ribbon"]');

    const ribbon = page.getByTestId('ribbon');
    const tabsRow = ribbon.locator('.ribbon__tabs');
    const groups = ribbon.locator('.ribbon__groups');
    const activeTab = page.getByRole('tab', { name: 'Home' });

    const rowBackground = await tabsRow.evaluate((node) => getComputedStyle(node).backgroundColor);
    const groupsBackground = await groups.evaluate(
      (node) => getComputedStyle(node).backgroundColor
    );
    const activeBackground = await activeTab.evaluate(
      (node) => getComputedStyle(node).backgroundColor
    );

    expect(rowBackground).toBe(groupsBackground);
    expect(activeBackground).toBe(groupsBackground);

    const borderBottomColor = await activeTab.evaluate(
      (node) => getComputedStyle(node).borderBottomColor
    );
    expect(borderBottomColor).toBe('rgba(0, 0, 0, 0)');
  });
});
