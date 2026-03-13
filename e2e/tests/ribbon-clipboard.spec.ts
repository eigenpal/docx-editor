import { test } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';
import * as assertions from '../helpers/assertions';

test.describe('Ribbon - clipboard', () => {
  test('local clipboard toggle controls paste source', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();
    await editor.focus();

    await editor.selectAll();
    await editor.typeText('Local Clip');
    await editor.selectAll();
    await editor.copyViaRibbon();
    await page.keyboard.press('End');
    await editor.typeText(' | ');

    await page.evaluate(async () => {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText('OS CLIP');
        return;
      }
      const textarea = document.createElement('textarea');
      textarea.value = 'OS CLIP';
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    });

    await editor.toggleLocalClipboard();
    await editor.pasteViaRibbon();

    await assertions.assertDocumentContainsText(page, 'Local Clip | Local Clip');

    await editor.typeText(' | ');
    await editor.toggleLocalClipboard();
    await editor.pasteViaRibbon();

    await assertions.assertDocumentContainsText(page, 'Local Clip | Local Clip | OS CLIP');
  });
});
