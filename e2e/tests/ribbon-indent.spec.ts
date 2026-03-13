import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test.describe('Ribbon - Indent', () => {
  test('Layout > Paragraph indent steppers adjust margins', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await page.waitForSelector('[data-testid="docx-editor"]', { timeout: 20000 });
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();
    await editor.typeText('Indent me');

    await page.getByRole('tab', { name: 'Layout' }).click();
    const ribbon = page.getByTestId('ribbon');
    await expect(ribbon.getByText('Indent', { exact: true })).toBeVisible();

    const indentLeftInput = page.locator('input[aria-label="Indent Left"]');
    await indentLeftInput.fill('0.2');
    await indentLeftInput.press('Enter');

    const paragraph = page.locator('p').first();
    const marginLeft = await paragraph.evaluate((el) => window.getComputedStyle(el).marginLeft);
    expect(marginLeft).not.toBe('0px');

    const indentRightInput = page.locator('input[aria-label="Indent Right"]');
    await indentRightInput.fill('0.2');
    await indentRightInput.press('Enter');
    const marginRight = await paragraph.evaluate((el) => window.getComputedStyle(el).marginRight);
    expect(marginRight).not.toBe('0px');
  });
});
