import { test, expect } from '@playwright/test';

test.describe('Ribbon - disabled actions', () => {
  test('Insert > Bookmark is disabled when command is missing', async ({ page }) => {
    await page.goto('/?toolbar=ribbon');
    await page.waitForSelector('[data-testid="docx-editor"]');

    await page.getByRole('tab', { name: 'Insert' }).click();
    const bookmark = page.getByRole('button', { name: 'Bookmark' });
    await expect(bookmark).toBeDisabled();
  });
});
