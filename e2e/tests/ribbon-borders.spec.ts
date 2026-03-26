import { test, expect } from '@playwright/test';

test.describe('Ribbon - group borders', () => {
  test('group separators reach the right edge of the ribbon body', async ({ page }) => {
    await page.goto('/?toolbar=ribbon');
    await page.waitForSelector('[data-testid="ribbon"]');

    const groups = page.getByTestId('ribbon').locator('.ribbon__groups');
    const lastGroup = groups.locator('.ribbon__group').last();
    const firstGroup = groups.locator('.ribbon__group').first();
    const firstLabel = firstGroup.locator('.ribbon__group-label');

    const groupsBox = await groups.boundingBox();
    const lastBox = await lastGroup.boundingBox();
    const firstBox = await firstGroup.boundingBox();
    const labelBox = await firstLabel.boundingBox();

    expect(groupsBox).not.toBeNull();
    expect(lastBox).not.toBeNull();
    expect(firstBox).not.toBeNull();
    expect(labelBox).not.toBeNull();

    if (groupsBox && lastBox) {
      const groupsRight = Math.round(groupsBox.x + groupsBox.width);
      const lastRight = Math.round(lastBox.x + lastBox.width);
      expect(Math.abs(groupsRight - lastRight)).toBeLessThanOrEqual(1);
    }

    if (firstBox && labelBox) {
      const groupWidth = Math.round(firstBox.width);
      const labelWidth = Math.round(labelBox.width);
      expect(Math.abs(groupWidth - labelWidth)).toBeLessThanOrEqual(1);
    }
  });
});
