/**
 * Vue: "Select entire table" from the right-click context menu produces a
 * CellSelection spanning every cell (parity with React #862). The select-table
 * command lives in core; this proves the Vue context-menu wiring reaches it.
 */
import { test, expect } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWin = { __DOCX_EDITOR_E2E__: { getView: () => any } };

function firstTableRowCount(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const t = document.querySelector('.layout-page-content .layout-table');
    return t ? t.querySelectorAll('.layout-table-row').length : -1;
  });
}

async function insertTable(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const view = (window as unknown as AnyWin).__DOCX_EDITOR_E2E__.getView();
    const s = view.state.schema;
    const cell = (t: string) =>
      s.nodes.tableCell.create(
        { colspan: 1, rowspan: 1, width: 3000, widthType: 'dxa' },
        s.nodes.paragraph.create(null, s.text(t))
      );
    const row = (a: string, b: string) =>
      s.nodes.tableRow.create({ height: 360, heightRule: 'atLeast' }, [cell(a), cell(b)]);
    const table = s.nodes.table.create(
      { columnWidths: [3000, 3000], width: 6000, widthType: 'dxa', tableLayout: 'fixed' },
      [row('A1', 'A2'), row('B1', 'B2'), row('C1', 'C2')]
    );
    view.dispatch(view.state.tr.insert(0, table));
  });
  await expect.poll(() => firstTableRowCount(page), { timeout: 10000 }).toBe(3);
}

test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.waitForSelector('[data-page-number]', { timeout: 25000 });
  await insertTable(page);
});

test('Vue: context menu "Select entire table" selects all cells', async ({ page }) => {
  const table = page.locator('.layout-page-content .layout-table').nth(0);
  const cell = table.locator('.layout-table-row').nth(1).locator('.layout-table-cell').nth(0);
  await cell.click();
  await cell.click({ button: 'right' });
  await page.waitForSelector('.ctx-menu', { state: 'visible', timeout: 5000 });

  await page
    .locator('.ctx-menu .ctx-menu__item')
    .filter({ hasText: /^Select entire table$/ })
    .click();

  const info = await page.evaluate(() => {
    const view = (window as unknown as AnyWin).__DOCX_EDITOR_E2E__.getView();
    const sel = view.state.selection;
    let cells = 0;
    if (sel.constructor.name === 'CellSelection') {
      sel.forEachCell(() => {
        cells += 1;
      });
    }
    return { type: sel.constructor.name, cells };
  });
  expect(info.type).toBe('CellSelection');
  expect(info.cells).toBe(6);
});
