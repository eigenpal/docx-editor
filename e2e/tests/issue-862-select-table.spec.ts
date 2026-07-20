import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

/**
 * #862 — "Select entire table" from the right-click context menu (and the
 * table toolbar) must produce a CellSelection spanning every cell, so the
 * whole table can be cut/copied in one gesture.
 */

async function selectionInfo(editor: EditorPage) {
  return editor.page.evaluate(() => {
    const view = window.__DOCX_EDITOR_E2E__?.getView();
    const sel = view?.state.selection;
    let cells = 0;
    if (sel && sel.constructor.name === 'CellSelection') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sel as any).forEachCell(() => {
        cells += 1;
      });
    }
    return { type: sel?.constructor.name ?? 'none', cells };
  });
}

test.describe('#862 select entire table', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.gotoEmpty();
    await editor.waitForReady();
    await editor.focus();
  });

  test('context menu "Select entire table" selects all cells', async () => {
    await editor.insertTable(3, 3);
    await editor.clickTableCell(0, 1, 1);

    await editor.rightClickTableCell(0, 1, 1);
    await editor.page.getByRole('menuitem', { name: 'Select entire table' }).click();

    const info = await selectionInfo(editor);
    expect(info.type).toBe('CellSelection');
    expect(info.cells).toBe(9);
  });

  test('toolbar "Select entire table" selects all cells', async () => {
    await editor.insertTable(2, 2);
    // Let the freshly inserted table settle before opening the dropdown — under
    // parallel load the initial layout pass re-renders the toolbar repeatedly.
    await editor.page.waitForTimeout(500);
    await editor.clickTableCell(0, 0, 0);

    await editor.openTableMore();
    // The dropdown re-renders frequently, so a Playwright click can lose the
    // element to the stability/detach retry loop. Click it synchronously in a
    // single evaluate tick instead.
    await editor.page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
      const item = items.find((el) => el.textContent?.trim() === 'Select entire table');
      (item as HTMLElement | undefined)?.click();
    });

    const info = await selectionInfo(editor);
    expect(info.type).toBe('CellSelection');
    expect(info.cells).toBe(4);
  });
});
