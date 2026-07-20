/**
 * A wide image fits its container (text column or table cell) while keeping its
 * aspect ratio — it neither squashes nor overflows (issue raised on #760). The
 * fit is done in the core painter, so React and Vue behave identically.
 */
import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const WIDE_IMG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('a wide image in a table cell fits and keeps its aspect ratio', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();

  // Insert a 2x2 table, place the cursor in the first cell, then insert a 3:1
  // image far wider than the cell.
  await page.evaluate((src) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const e2e = (window as any).__DOCX_EDITOR_E2E__;
    const view = e2e.getView();
    const TS = view.state.selection.constructor;
    view.dispatch(view.state.tr.setSelection(TS.create(view.state.doc, 1)));
    e2e.insertTable(2, 2);
    let ci: number | null = null;
    view.state.doc.descendants((n: any, p: number) => {
      if (ci !== null) return false;
      if (n.type.name === 'tableCell') {
        ci = p + 2;
        return false;
      }
      return true;
    });
    view.dispatch(view.state.tr.setSelection(TS.create(view.state.doc, ci)));
    e2e.insertImage(src, 600, 200);
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }, WIDE_IMG);

  const img = page.locator('.layout-run-image').first();
  await expect(img).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(300);

  const m = await img.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cell = el.closest('.layout-table-cell, [class*=table-cell], td') as HTMLElement | null;
    const cellRect = cell?.getBoundingClientRect();
    return {
      w: r.width,
      h: r.height,
      cellW: cellRect?.width ?? null,
      cellH: cellRect?.height ?? null,
    };
  });
  expect(m.w / m.h).toBeCloseTo(3, 1); // aspect preserved (not squashed)
  expect(m.cellW).not.toBeNull();
  expect(m.w).toBeLessThanOrEqual(m.cellW! + 1); // fits the cell
  expect(m.cellH).not.toBeNull();
  // An image-only paragraph contributes the image's painted height, plus only
  // table padding/borders. Its text line box must not create a hidden extra gap.
  expect(m.cellH! - m.h).toBeLessThanOrEqual(18);
});
