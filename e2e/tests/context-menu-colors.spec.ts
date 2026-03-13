import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';
import * as assertions from '../helpers/assertions';

test.describe('Context menu colors', () => {
  test('text color split main applies last used', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();

    await editor.typeText('Red text');
    await editor.selectAll();
    await editor.setTextColor('#FF0000');

    await editor.pressEnter();
    await editor.typeText('Reapply red');
    await editor.selectText('Reapply red');
    await editor.openContextMenu();
    await editor.contextMenuApplyTextColor();

    await assertions.assertTextHasColor(page, 'Reapply red', 'rgb(255, 0, 0)');
  });

  test('highlight submenu applies chosen color', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();

    await editor.typeText('Highlight me');
    await editor.selectAll();
    await editor.openContextMenu();
    await editor.contextMenuOpenHighlightSubmenu();
    await expect(page.locator('.docx-text-context-menu-submenu--colors')).toBeVisible({
      timeout: 5000,
    });
    await editor.contextMenuPickHighlight('Yellow');

    await assertions.assertTextHasBackgroundColor(page, 'Highlight me', 'rgb(255, 255, 0)');
  });

  test('text color picker applies custom color', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();

    await editor.typeText('Custom color');
    await editor.selectAll();
    await editor.openContextMenu();
    await editor.contextMenuOpenTextColorSubmenu();
    await editor.contextMenuPickCustomTextColor('#00ff00');

    await assertions.assertTextHasColor(page, 'Custom color', 'rgb(0, 255, 0)');
  });

  test('text color picker keeps menu open while choosing', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();

    await editor.typeText('Picker stays open');
    await editor.selectAll();
    await editor.openContextMenu();
    await editor.contextMenuOpenTextColorSubmenu();
    const submenu = page.locator('.docx-text-context-menu-submenu--colors');
    await expect(submenu).toBeVisible({
      timeout: 5000,
    });

    await editor.contextMenuPreviewCustomTextColor('#00ff00');

    await page.waitForTimeout(200);
    await expect(submenu).toBeVisible({
      timeout: 5000,
    });
  });
});
