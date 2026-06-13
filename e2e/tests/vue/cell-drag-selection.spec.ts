/**
 * Vue: drag-selecting table cells produces a CellSelection (parity with React).
 * Previously Vue's pages-pointer only ever made a text selection, so multi-cell
 * table ops (delete row/column across a range, fill, merge) were unreachable by
 * dragging. Shared logic lives in core (`createCellDragTracker`).
 */
import { test, expect } from '@playwright/test';

function firstTableRowCount(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const t = document.querySelector('.layout-page-content .layout-table');
    return t ? t.querySelectorAll('.layout-table-row').length : -1;
  });
}

// Insert a deterministic 3-row × 2-col table at the document start.
async function insertTable(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const view = (
      window as unknown as { __DOCX_EDITOR_E2E__: { getView: () => any } }
    ).__DOCX_EDITOR_E2E__.getView();
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

async function dragAcrossFirstColumn(page: import('@playwright/test').Page) {
  const table = page.locator('.layout-page-content .layout-table').nth(0);
  const c00 = table.locator('.layout-table-row').nth(0).locator('.layout-table-cell').nth(0);
  const c10 = table.locator('.layout-table-row').nth(1).locator('.layout-table-cell').nth(0);
  const a = await c00.boundingBox();
  const b = await c10.boundingBox();
  if (!a || !b) throw new Error('cells not found');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  return c10;
}

test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.waitForSelector('[data-page-number]', { timeout: 25000 });
  await insertTable(page);
});

test('Vue: dragging across cells forms a CellSelection', async ({ page }) => {
  await dragAcrossFirstColumn(page);
  const sel = await page.evaluate(() => {
    const view = (
      window as unknown as { __DOCX_EDITOR_E2E__: { getView: () => any } }
    ).__DOCX_EDITOR_E2E__.getView();
    return { isCell: !!view.state.selection.$anchorCell };
  });
  expect(sel.isCell, 'drag produced a CellSelection').toBe(true);
});

test('Vue: drag-select + Delete row removes every spanned row', async ({ page }) => {
  const c10 = await dragAcrossFirstColumn(page);
  await c10.click({ button: 'right' });
  await page.waitForSelector('.ctx-menu', { state: 'visible', timeout: 5000 });
  await page
    .locator('.ctx-menu .ctx-menu__item')
    .filter({ hasText: /^Delete row$/ })
    .click();
  await page.waitForTimeout(300);
  expect(await firstTableRowCount(page)).toBe(1);
});
