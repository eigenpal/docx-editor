import { test, expect } from '@playwright/test';

test.describe('Ribbon - basic behavior', () => {
  test('toolbar=ribbon replaces toolbar', async ({ page }) => {
    await page.goto('/?toolbar=ribbon');
    await page.waitForSelector('[data-testid="docx-editor"]');

    await expect(page.getByTestId('ribbon')).toBeVisible();
    await expect(page.getByTestId('toolbar')).toHaveCount(0);
  });

  test('ribbon stays visible in read-only by default', async ({ page }) => {
    await page.goto('/?toolbar=ribbon&readOnly=1');
    await page.waitForSelector('[data-testid="docx-editor"]');

    await expect(page.getByTestId('ribbon')).toBeVisible();
  });

  test('ribbon can be hidden in read-only via flag', async ({ page }) => {
    await page.goto('/?toolbar=ribbon&readOnly=1&showToolbarWhenReadOnly=0');
    await page.waitForSelector('[data-testid="docx-editor"]');

    await expect(page.getByTestId('ribbon')).toHaveCount(0);
  });
});
