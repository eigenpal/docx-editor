/**
 * Issue #781 — resizing a table column must make Word honor the new widths.
 *
 * Dragging a column boundary now switches the table to fixed layout in the PM
 * doc (`tableLayout: 'fixed'`), which serializes as `<w:tblLayout
 * w:type="fixed"/>`. Without it Word autofits and discards the widths. The
 * serializer output is asserted by the unit test
 * (packages/core/src/docx/issue-781-table-layout.test.ts); here we verify the
 * real drag gesture flips the attr end-to-end. Core resize commit → React + Vue.
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test('resizing a table column switches it to fixed layout (#781)', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();
  await page.waitForSelector('.layout-page-content .layout-table-resize-handle');

  const before = await page.evaluate(() => {
    const handle = document.querySelector(
      '.layout-page-content .layout-table-resize-handle'
    ) as HTMLElement | null;
    if (!handle) return null;
    const r = handle.getBoundingClientRect();
    // Prefer a point that isn't covered by a crossing row-resize handle
    // (those sit on top at the cell corner / mid-edge crossings).
    const x = r.x + r.width / 2;
    let y = r.y + Math.min(20, r.height / 4);
    for (const cand of [y, r.y + r.height / 2, r.y + r.height - 20]) {
      const top = document.elementFromPoint(x, cand);
      if (top?.classList.contains('layout-table-resize-handle')) {
        y = cand;
        break;
      }
    }
    const docFrom = Number(handle.dataset.tablePmStart ?? '0');
    const view = (
      window as unknown as { __DOCX_EDITOR_E2E__: { getView: () => any } }
    ).__DOCX_EDITOR_E2E__.getView();
    let layout: unknown = 'NO_TABLE';
    let widths: number[] | null = null;
    view.state.doc.nodesBetween(docFrom, docFrom + 1, (n: any) => {
      if (n.type.name === 'table') {
        layout = n.attrs.tableLayout;
        widths = n.attrs.columnWidths;
      }
    });
    return { x, y, docFrom, layout, widths };
  });

  expect(before, 'a body table with a resize handle exists').toBeTruthy();

  // Drag the column boundary ~60px to the left.
  await page.mouse.move(before!.x, before!.y);
  await page.mouse.down();
  await page.mouse.move(before!.x - 60, before!.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const after = await page.evaluate((docFrom: number) => {
    const view = (
      window as unknown as { __DOCX_EDITOR_E2E__: { getView: () => any } }
    ).__DOCX_EDITOR_E2E__.getView();
    let layout: unknown = 'NO_TABLE';
    let widths: number[] | null = null;
    view.state.doc.nodesBetween(docFrom, docFrom + 1, (n: any) => {
      if (n.type.name === 'table') {
        layout = n.attrs.tableLayout;
        widths = n.attrs.columnWidths;
      }
    });
    return { layout, widths };
  }, before!.docFrom);

  expect(after.layout).toBe('fixed');
  // The drag actually changed a width.
  expect(JSON.stringify(after.widths)).not.toBe(JSON.stringify(before!.widths));
});
