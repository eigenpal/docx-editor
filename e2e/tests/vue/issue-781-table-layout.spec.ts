/**
 * Vue parity for issue #781 — resizing a table column must switch the table to
 * fixed layout in the PM doc (`tableLayout: 'fixed'`) so Word honors the
 * explicit widths. The commit lives in core (`commitColumnResize`); this proves
 * the Vue `useTableResize` wiring reaches it identically to React.
 */

import { test, expect } from '@playwright/test';

test('Vue: resizing a table column switches it to fixed layout (#781)', async ({ page }) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.locator('input[type="file"]').first().setInputFiles('e2e/fixtures/with-tables.docx');
  await page.waitForSelector('.layout-page-content .layout-table-resize-handle');

  const before = await page.evaluate(() => {
    const handle = document.querySelector(
      '.layout-page-content .layout-table-resize-handle'
    ) as HTMLElement | null;
    if (!handle) return null;
    const r = handle.getBoundingClientRect();
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
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, docFrom, layout, widths };
  });
  expect(before).toBeTruthy();

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
  expect(JSON.stringify(after.widths)).not.toBe(JSON.stringify(before!.widths));
});
