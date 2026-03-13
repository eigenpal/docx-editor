import { test, expect } from '@playwright/test';

test.describe('Ribbon - tabs', () => {
  test('renders all primary tabs and hides contextual tabs by default', async ({ page }) => {
    await page.goto('/?toolbar=ribbon');
    await page.waitForSelector('[data-testid="docx-editor"]');

    await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Insert' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Layout' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Review' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'View' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'References' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Developer' })).toBeVisible();

    await expect(page.getByRole('tab', { name: 'Table Design' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Table Layout' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Header & Footer' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Picture Format' })).toHaveCount(0);
  });
});
