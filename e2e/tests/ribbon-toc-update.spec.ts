import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test.describe('Ribbon - TOC Update', () => {
  test('References > Update Table regenerates TOC', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await page.waitForSelector('[data-testid="docx-editor"]', { timeout: 20000 });
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();

    await editor.applyHeading1();
    await editor.typeText('Heading A');
    await editor.pressEnter();

    await page.getByRole('tab', { name: 'References' }).click();
    await page.getByRole('button', { name: 'Table of Contents' }).click();

    await editor.pressEnter();
    await editor.applyHeading1();
    await editor.typeText('Heading B');

    await page.getByRole('tab', { name: 'References' }).click();
    await page.getByRole('button', { name: 'Update Table' }).click();

    await expect(editor.getContentArea()).toContainText('Heading B');
  });
});
