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
