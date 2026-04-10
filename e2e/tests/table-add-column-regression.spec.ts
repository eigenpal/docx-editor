import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

async function fillTableWithCoordinates(editor: EditorPage, rows: number, cols: number) {
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      await editor.clickTableCell(0, row, col);
      await editor.page.keyboard.type(`${row + 1}${col + 1}`);
    }
  }
}

async function getTableMatrix(editor: EditorPage) {
  return await editor.page.evaluate(() => {
    const table = document.querySelector('.ProseMirror table');
    if (!table) return null;

    return Array.from(table.querySelectorAll('tr')).map((row) =>
      Array.from(row.querySelectorAll('td, th')).map((cell) => (cell.textContent || '').trim())
    );
  });
}

test.describe('Table Add Column Regression', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.focus();
  });

  test('adding a row and then a column from the middle cell preserves a 4x4 matrix', async () => {
    await editor.insertTable(3, 3);
    await fillTableWithCoordinates(editor, 3, 3);

    await editor.clickTableCell(0, 1, 1);
    await editor.addRowBelow();
    await editor.page.waitForTimeout(400);

    await editor.clickTableCell(0, 1, 1);
    await editor.addColumnRight();
    await editor.page.waitForTimeout(600);

    const matrix = await getTableMatrix(editor);
    expect(matrix).toEqual([
      ['11', '12', '', '13'],
      ['21', '22', '', '23'],
      ['', '', '', ''],
      ['31', '32', '', '33'],
    ]);
  });
});
