import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test.describe('Ribbon - Breaks', () => {
  test('Layout > Breaks inserts page and section breaks', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await page.waitForSelector('[data-testid="docx-editor"]', { timeout: 20000 });
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();

    await page.getByRole('tab', { name: 'Layout' }).click();
    const pageBreaks = page.locator('div.docx-page-break');
    const initialBreakCount = await pageBreaks.count();
    await page.getByRole('button', { name: 'Breaks' }).click();
    await page.getByRole('button', { name: 'Page Break' }).click();

    await expect(pageBreaks).toHaveCount(initialBreakCount + 1);

    await page.getByRole('button', { name: 'Breaks' }).click();
    await page.getByRole('button', { name: 'Section Breaks' }).hover();
    await page.getByRole('button', { name: 'Next Page' }).click();

    await expect(page.locator('p[data-section-break="nextPage"]')).toHaveCount(1);
  });
});
