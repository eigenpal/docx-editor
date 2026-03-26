import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test.describe('Ribbon - Accept/Reject All', () => {
  test('Review > Accept All clears tracked insertions', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await page.waitForSelector('[data-testid="docx-editor"]', { timeout: 20000 });
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();

    await page.getByRole('tab', { name: 'Review' }).click();
    await page.getByRole('button', { name: 'Track Changes' }).click();

    await editor.typeText('Accept this');

    const insertions = page.locator('.docx-insertion');
    await expect.poll(async () => insertions.count()).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Accept All' }).click();
    await expect.poll(async () => insertions.count()).toBe(0);
  });

  test('Review > Reject All removes tracked insertions', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await page.waitForSelector('[data-testid="docx-editor"]', { timeout: 20000 });
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();

    await page.getByRole('tab', { name: 'Review' }).click();
    await page.getByRole('button', { name: 'Track Changes' }).click();

    await editor.typeText('Reject this');

    const insertions = page.locator('.docx-insertion');
    await expect.poll(async () => insertions.count()).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Reject All' }).click();
    await expect.poll(async () => insertions.count()).toBe(0);
    await expect(editor.getContentArea()).not.toContainText('Reject this');
  });
});
