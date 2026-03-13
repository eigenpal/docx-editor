import { test } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';
import * as assertions from '../helpers/assertions';

test.describe('Ribbon split color buttons', () => {
  test('text color split main applies last used', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();

    await editor.typeText('Red ribbon');
    await editor.selectAll();
    await editor.setTextColor('#FF0000');

    await editor.pressEnter();
    await editor.typeText('Reapply red');
    await editor.selectText('Reapply red');
    await editor.applyLastTextColorRibbon();

    await assertions.assertTextHasColor(page, 'Reapply red', 'rgb(255, 0, 0)');
  });

  test('highlight split main applies last used', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();

    await editor.typeText('Yellow ribbon');
    await editor.selectAll();
    await editor.setHighlightColor('yellow');

    await editor.pressEnter();
    await editor.typeText('Reapply yellow');
    await editor.selectText('Reapply yellow');
    await editor.applyLastHighlightColorRibbon();

    await assertions.assertTextHasBackgroundColor(page, 'Reapply yellow', 'rgb(255, 255, 0)');
  });
});
