/**
 * Caret position inside a table cell that spans pages (issue #763).
 *
 * When a row breaks mid-content across a page boundary the painter renders the
 * cell content in both fragments with identical `data-doc-from`/`data-doc-to`.
 * The caret lookup used to return the first (page-1, clipped) copy, leaving the
 * cursor on the previous page. It must land on the page where the cursor's text
 * is actually visible. Core fix (resolveDomPosition) → covers React and Vue.
 *
 * Background: https://github.com/eigenpal/docx-editor/issues/763
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test('caret follows a table cell across a page break (#763)', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();

  // Build a single-cell table whose content is tall enough to break across a
  // page boundary, insert it at the top of the body, and put the cursor on the
  // LAST line (which lands on the continuation page).
  const setup = await page.evaluate(() => {
    type V = { state: any; dispatch: (tr: unknown) => void; focus: () => void };
    const view = (
      window as unknown as { __DOCX_EDITOR_E2E__: { getView: () => V | null } }
    ).__DOCX_EDITOR_E2E__.getView();
    if (!view) throw new Error('no view');
    const schema = view.state.schema;

    const LINES = 70;
    const paras = [];
    for (let i = 0; i < LINES; i++) {
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

    const tr = view.state.tr.insert(0, table);
    view.dispatch(tr);
    return { lines: LINES };
  });
  expect(setup.lines).toBe(70);

  // Let the painter paginate the tall table.
  await page.waitForTimeout(500);

  // Place the cursor at the end of the last line in the cell.
  await page.evaluate(() => {
    type V = { state: any; dispatch: (tr: unknown) => void; focus: () => void };
    const view = (
      window as unknown as { __DOCX_EDITOR_E2E__: { getView: () => V | null } }
    ).__DOCX_EDITOR_E2E__.getView();
    if (!view) throw new Error('no view');
    // Locate the first table's range, then the last text position within it.
    let tableStart = -1;
    let tableEnd = -1;
    view.state.doc.descendants((node: any, pos: number) => {
      if (tableStart >= 0) return false;
      if (node.type.name === 'table') {
        tableStart = pos;
        tableEnd = pos + node.nodeSize;
        return false;
      }
      return true;
    });
    let lastTextEnd = tableStart + 1;
    view.state.doc.nodesBetween(tableStart, tableEnd, (node: any, pos: number) => {
      if (node.isText) lastTextEnd = pos + node.nodeSize;
      return true;
    });
    const TS = view.state.selection.constructor;
    view.dispatch(view.state.tr.setSelection(TS.create(view.state.doc, lastTextEnd)));
    view.focus();
  });
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => {
    const caretEl = document.querySelector('[data-testid="caret"]') as HTMLElement | null;
    if (!caretEl) return { error: 'no caret' };
    const caret = caretEl.getBoundingClientRect();
    const caretMidY = caret.top + caret.height / 2;

    const pageIndexAt = (y: number) => {
      const pages = Array.from(document.querySelectorAll('.layout-page')) as HTMLElement[];
      for (const p of pages) {
        const r = p.getBoundingClientRect();
        if (y >= r.top && y <= r.bottom) return Number(p.dataset.pageNumber || '1') - 1;
      }
      return -1;
    };

    // The visible "Line 70" copy: the one whose box is inside its table fragment.
    let line70Page = -1;
    let line70Y = -1;
    document.querySelectorAll('.layout-page-content .layout-table .layout-line').forEach((el) => {
      if (!/(^|\b)Line 70\b/.test(el.textContent || '')) return;
      const r = (el as HTMLElement).getBoundingClientRect();
      const tableEl = (el as HTMLElement).closest('.layout-table') as HTMLElement | null;
      if (!tableEl) return;
      const t = tableEl.getBoundingClientRect();
      const mid = (r.top + r.bottom) / 2;
      const visible = mid >= t.top - 1 && mid <= t.bottom + 1;
      if (visible) {
        line70Page = pageIndexAt(mid);
        line70Y = r.top;
      }
    });

    return {
      caretPage: pageIndexAt(caretMidY),
      caretTop: caret.top,
      line70Page,
      line70Y,
    };
  });

  expect(result.error).toBeUndefined();
  // The cell genuinely spans onto a continuation page.
  expect(result.line70Page).toBeGreaterThanOrEqual(1);
  // The caret is on the same page as the visible last line, not page 1.
  expect(result.caretPage).toBe(result.line70Page);
  // And vertically aligned with that visible line.
  expect(Math.abs(result.caretTop! - result.line70Y!)).toBeLessThan(12);
});
