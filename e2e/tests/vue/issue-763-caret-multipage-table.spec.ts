/**
 * Vue parity for issue #763 — the caret must follow a table cell across a page
 * break instead of stranding on the previous page. The lookup lives in core
 * (`getCaretPositionFromDom`); this proves the Vue selection-overlay wiring
 * (`useSelectionSync`) resolves the on-window copy like React.
 */

import { test, expect } from '@playwright/test';

test('Vue: caret follows a table cell across a page break (#763)', async ({ page }) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.locator('input[type="file"]').first().setInputFiles('e2e/fixtures/demo.docx');
  await page.waitForSelector('[data-page-number]');

  // Build a single-cell table tall enough to break across a page boundary.
  await page.evaluate(() => {
    const view = (
      window as unknown as { __DOCX_EDITOR_E2E__: { getView: () => any } }
    ).__DOCX_EDITOR_E2E__.getView();
    const schema = view.state.schema;
    const paras = [];
    for (let i = 0; i < 70; i++) {
      paras.push(schema.nodes.paragraph.create(null, schema.text(`Line ${i + 1}`)));
    }
    const border = { style: 'single', size: 4, color: { rgb: '000000' } };
    const cell = schema.nodes.tableCell.create(
      {
        colspan: 1,
        rowspan: 1,
        width: 9000,
        widthType: 'dxa',
        borders: { top: border, bottom: border, left: border, right: border },
      },
      paras
    );
    const row = schema.nodes.tableRow.create({ height: 360, heightRule: 'atLeast' }, [cell]);
    const table = schema.nodes.table.create(
      { columnWidths: [9000], width: 9000, widthType: 'dxa', tableLayout: 'fixed' },
      [row]
    );
    view.dispatch(view.state.tr.insert(0, table));
  });
  await page.waitForTimeout(600);

  // Place the cursor at the end of the last line of the first table.
  await page.evaluate(() => {
    const view = (
      window as unknown as { __DOCX_EDITOR_E2E__: { getView: () => any } }
    ).__DOCX_EDITOR_E2E__.getView();
    let tStart = -1;
    let tEnd = -1;
    view.state.doc.descendants((n: any, p: number) => {
      if (tStart >= 0) return false;
      if (n.type.name === 'table') {
        tStart = p;
        tEnd = p + n.nodeSize;
        return false;
      }
      return true;
    });
    let last = tStart + 1;
    view.state.doc.nodesBetween(tStart, tEnd, (n: any, p: number) => {
      if (n.isText) last = p + n.nodeSize;
      return true;
    });
    const TS = view.state.selection.constructor;
    view.dispatch(view.state.tr.setSelection(TS.create(view.state.doc, last)));
    view.focus();
  });
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => {
    // Vue paints the caret as `.vue-caret`.
    const caretEl = document.querySelector('.vue-caret') as HTMLElement | null;
    if (!caretEl) return { error: 'no caret' };
    const caret = caretEl.getBoundingClientRect();
    const caretMid = caret.top + caret.height / 2;
    const pageAt = (y: number) => {
      for (const p of Array.from(document.querySelectorAll('.layout-page')) as HTMLElement[]) {
        const r = p.getBoundingClientRect();
        if (y >= r.top && y <= r.bottom) return Number(p.dataset.pageNumber || '1') - 1;
      }
      return -1;
    };
    let line70Page = -1;
    let line70Y = -1;
    document.querySelectorAll('.layout-page-content .layout-table .layout-line').forEach((el) => {
      if (!/\bLine 70\b/.test(el.textContent || '')) return;
      const r = (el as HTMLElement).getBoundingClientRect();
      const t = (el as HTMLElement).closest('.layout-table')!.getBoundingClientRect();
      const mid = (r.top + r.bottom) / 2;
      if (mid >= t.top - 1 && mid <= t.bottom + 1) {
        line70Page = pageAt(mid);
        line70Y = r.top;
      }
    });
    return { caretPage: pageAt(caretMid), caretTop: caret.top, line70Page, line70Y };
  });

  expect(result.error).toBeUndefined();
  expect(result.line70Page).toBeGreaterThanOrEqual(1);
  expect(result.caretPage).toBe(result.line70Page);
  expect(Math.abs(result.caretTop! - result.line70Y!)).toBeLessThan(12);
});
