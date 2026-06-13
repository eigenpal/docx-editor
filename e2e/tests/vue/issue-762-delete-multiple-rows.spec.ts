/**
 * Vue parity for issue #762 — "Delete row" must remove every row a multi-cell
 * selection spans. The command is shared core (`deleteRow`), invoked in Vue via
 * `mgr.getCommands().deleteRow`. Vue's painter has no drag-to-cell-select yet
 * (a separate gap), so we establish the multi-row CellSelection programmatically
 * — the runtime-faithful way to feed the command — then delete via the real
 * Vue context menu and confirm BOTH rows go.
 */

import { test, expect } from '@playwright/test';

function paintedRowCount(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const t = document.querySelector('.layout-page-content .layout-table');
    return t ? t.querySelectorAll('.layout-table-row').length : -1;
  });
}

test('Vue: delete row removes every row a multi-row CellSelection spans (#762)', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.waitForSelector('[data-page-number]');

  // Insert a clean 3-row × 1-col table at the document start.
  await page.evaluate(() => {
    const view = (
      window as unknown as { __DOCX_EDITOR_E2E__: { getView: () => any } }
    ).__DOCX_EDITOR_E2E__.getView();
    const s = view.state.schema;
    const cell = (t: string) =>
      s.nodes.tableCell.create(
        { colspan: 1, rowspan: 1, width: 4000, widthType: 'dxa' },
        s.nodes.paragraph.create(null, s.text(t))
      );
    const row = (t: string) =>
      s.nodes.tableRow.create({ height: 360, heightRule: 'atLeast' }, [cell(t)]);
    const table = s.nodes.table.create(
      { columnWidths: [4000], width: 4000, widthType: 'dxa', tableLayout: 'fixed' },
      [row('R1'), row('R2'), row('R3')]
    );
    view.dispatch(view.state.tr.insert(0, table));
  });
  await page.waitForTimeout(300);
  expect(await paintedRowCount(page)).toBe(3);

  // Select cells in rows 0 and 1 (a CellSelection) programmatically.
  await page.evaluate(() => {
    const view = (
      window as unknown as { __DOCX_EDITOR_E2E__: { getView: () => any } }
    ).__DOCX_EDITOR_E2E__.getView();
    let tStart = -1;
    view.state.doc.descendants((n: any, p: number) => {
      if (tStart >= 0) return false;
      if (n.type.name === 'table') {
        tStart = p;
        return false;
      }
      return true;
    });
    const tableNode = view.state.doc.nodeAt(tStart);
    const cellPos: number[] = [];
    view.state.doc.nodesBetween(tStart, tStart + tableNode.nodeSize, (n: any, p: number) => {
      if (n.type.name === 'tableCell') cellPos.push(p);
      return true;
    });
    const Selection = Object.getPrototypeOf(view.state.selection.constructor);
    const sel = Selection.fromJSON(view.state.doc, {
      type: 'cell',
      anchor: cellPos[0],
      head: cellPos[1],
    });
    view.dispatch(view.state.tr.setSelection(sel));
  });
  await page.waitForTimeout(150);

  // Right-click the painted head cell (row 1) and choose "Delete row".
  const headCell = page
    .locator('.layout-page-content .layout-table .layout-table-row')
    .nth(1)
    .locator('.layout-table-cell')
    .first();
  await headCell.click({ button: 'right' });
  await page.waitForSelector('.ctx-menu', { state: 'visible', timeout: 5000 });

  // Right-click can move the cursor; re-assert the CellSelection right before
  // the command so we test the multi-row path, not a collapsed single cell.
  await page.evaluate(() => {
    const view = (
      window as unknown as { __DOCX_EDITOR_E2E__: { getView: () => any } }
    ).__DOCX_EDITOR_E2E__.getView();
    if (view.state.selection.$anchorCell) return; // still a CellSelection
    let tStart = -1;
    view.state.doc.descendants((n: any, p: number) => {
      if (tStart >= 0) return false;
      if (n.type.name === 'table') {
        tStart = p;
        return false;
      }
      return true;
    });
    const tableNode = view.state.doc.nodeAt(tStart);
    const cellPos: number[] = [];
    view.state.doc.nodesBetween(tStart, tStart + tableNode.nodeSize, (n: any, p: number) => {
      if (n.type.name === 'tableCell') cellPos.push(p);
      return true;
    });
    const Selection = Object.getPrototypeOf(view.state.selection.constructor);
    view.dispatch(
      view.state.tr.setSelection(
        Selection.fromJSON(view.state.doc, { type: 'cell', anchor: cellPos[0], head: cellPos[1] })
      )
    );
  });

  await page
    .locator('.ctx-menu .ctx-menu__item')
    .filter({ hasText: /^Delete row$/ })
    .click();
  await page.waitForTimeout(300);

  // Rows 0 and 1 gone → only R3 remains.
  expect(await paintedRowCount(page)).toBe(1);
});
