import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test.describe('Toolbar mode', () => {
  test('toolbar=compact shows compact toolbar and hides ribbon', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=compact');
    await editor.waitForReady();
    await expect(page.getByTestId('toolbar')).toBeVisible();
    await expect(page.getByTestId('ribbon')).toHaveCount(0);
  });

  test('toolbar=ribbon shows ribbon and hides compact toolbar', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();
    await expect(page.getByTestId('ribbon')).toBeVisible();
    await expect(page.getByTestId('toolbar')).toHaveCount(0);
  });

  test('toolbar omitted shows compact toolbar by default', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/');
    await editor.waitForReady();
    await expect(page.getByTestId('ribbon')).toHaveCount(0);
    await expect(page.getByTestId('toolbar')).toBeVisible();
  });

  test('toolbar toggle switches modes and updates URL', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/');
    await editor.waitForReady();

    const toggle = page.getByTestId('toolbar-mode-toggle');

    await expect(page.getByTestId('toolbar')).toBeVisible();
    await expect(page.getByTestId('ribbon')).toHaveCount(0);

    await toggle.click();
    await expect(page.getByTestId('ribbon')).toBeVisible();
    await expect(page.getByTestId('toolbar')).toHaveCount(0);
    await expect(page).toHaveURL(/toolbar=ribbon/);

    await toggle.click();
    await expect(page.getByTestId('toolbar')).toBeVisible();
    await expect(page.getByTestId('ribbon')).toHaveCount(0);
    await expect(page).toHaveURL(/toolbar=compact/);
  });
});
