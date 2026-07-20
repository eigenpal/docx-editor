import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test.describe('Table Context Menu', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.focus();
  });

  test('right-click table menu shows merge and split actions and can insert a row', async ({
    page,
  }) => {
    await editor.loadDocxFile('fixtures/with-tables.docx');
    await editor.rightClickTableCell(0, 0, 0);

    const menu = page.locator('[role="menu"]');
    await expect(menu).toHaveCount(1);
    await expect(
      menu.locator('[role="menuitem"]').filter({ hasText: /^Merge cells$/ })
    ).toHaveCount(1);
    await expect(menu.locator('[role="menuitem"]').filter({ hasText: /^Split cell$/ })).toHaveCount(
      1
    );

    await menu
      .locator('[role="menuitem"]')
      .filter({ hasText: /^Insert row below$/ })
      .click();
    await page.waitForTimeout(300);

    const dimensions = await editor.getTableDimensions(0);
    expect(dimensions.rows).toBe(4);
    expect(dimensions.cols).toBeGreaterThan(0);
  });

  test('delete row removes every row a multi-row selection spans (issue #762)', async ({
    page,
  }) => {
    await editor.loadDocxFile('fixtures/with-tables.docx');

    const before = await editor.getTableDimensions(0);
    expect(before.rows).toBeGreaterThanOrEqual(3);

    // Drag a cell selection from row 0 to row 1 in the first column.
    const table = page.locator('.paged-editor__pages .layout-table').nth(0);
    const cell00 = table.locator('.layout-table-row').nth(0).locator('.layout-table-cell').nth(0);
    const cell10 = table.locator('.layout-table-row').nth(1).locator('.layout-table-cell').nth(0);
    const a = await cell00.boundingBox();
    const b = await cell10.boundingBox();
    if (!a || !b) throw new Error('cells not found');
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    await editor.rightClickTableCell(0, 1, 0);
    await page
      .locator('[role="menu"] [role="menuitem"]')
      .filter({ hasText: /^Delete row$/ })
      .click();
    await page.waitForTimeout(300);

    const after = await editor.getTableDimensions(0);
    expect(after.rows).toBe(before.rows - 2);
  });

  test('right-click split cell applies a one-by-two split', async ({ page }) => {
    await editor.loadDocxFile('fixtures/with-tables.docx');
    await editor.rightClickTableCell(0, 0, 0);

    const menu = page.locator('[role="menu"]');
    await menu
      .locator('[role="menuitem"]')
      .filter({ hasText: /^Split cell$/ })
      .click();

    const dialog = page.getByRole('dialog', { name: 'Split Cell' });
    await expect(dialog).toBeVisible();

    const inputs = dialog.locator('input[type="number"]');
    await inputs.nth(0).fill('1');
    await inputs.nth(1).fill('2');
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await page.waitForTimeout(300);

    const dimensions = await editor.getTableDimensions(0);
    expect(dimensions.cols).toBe(4);
  });
});
