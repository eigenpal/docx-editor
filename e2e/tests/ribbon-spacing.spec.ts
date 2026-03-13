import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test.describe('Ribbon - Spacing', () => {
  test('Layout > Paragraph spacing steppers adjust margins', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await page.waitForSelector('[data-testid="docx-editor"]', { timeout: 20000 });
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();
    await editor.typeText('Spacing');

    await page.getByRole('tab', { name: 'Layout' }).click();
    const ribbon = page.getByTestId('ribbon');
    await expect(ribbon.getByText('Spacing', { exact: true })).toBeVisible();

    const spacingBeforeInput = page.locator('input[aria-label="Spacing Before"]');
    await spacingBeforeInput.fill('6');
    await spacingBeforeInput.press('Enter');

    const paragraph = page.locator('p').first();
    const marginTop = await paragraph.evaluate((el) => window.getComputedStyle(el).marginTop);
    expect(marginTop).not.toBe('0px');

    const spacingAfterInput = page.locator('input[aria-label="Spacing After"]');
    await spacingAfterInput.fill('6');
    await spacingAfterInput.press('Enter');
    const marginBottom = await paragraph.evaluate((el) => window.getComputedStyle(el).marginBottom);
    expect(marginBottom).not.toBe('0px');
  });
});
