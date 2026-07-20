/**
 * Issue #734 (Vue parity): an RTL table (`w:bidiVisual`) renders columns in
 * reversed visual order. Same assertion as the React spec — the painter is
 * shared core, this proves the Vue adapter reaches the same code path.
 */
import { test, expect } from '@playwright/test';

const FIXTURE = 'e2e/fixtures/rtl-table-bidivisual.docx';
const LABEL = 'בדיקה';

test.describe('Issue #734 — RTL (bidiVisual) table column order [Vue]', () => {
  test('Hebrew label cell renders to the right of the field cell', async ({ page }) => {
    await page.goto('http://localhost:5174/?e2e=1');
    await page.locator('.docx-editor-vue').waitFor();
    await page.locator('.paged-editor__pages').waitFor();
    await page.locator('input[type="file"][accept=".docx"]').setInputFiles(FIXTURE);
    // Wait for THIS fixture to paint (not a pre-existing demo doc) by keying on
    // its Hebrew label inside a painted table cell.
    await page.waitForFunction((label) => {
      const cells = document.querySelectorAll('.layout-page-content .layout-table-cell');
      return [...cells].some((c) => (c.textContent ?? '').includes(label as string));
    }, LABEL);

    const { labelX, fieldX } = await page.evaluate((label) => {
      const cells = [
        ...document.querySelectorAll<HTMLElement>('.layout-page-content .layout-table-cell'),
      ].filter((c) => !c.dataset.vmergeContinuation);
      const labelCell = cells.find((c) => (c.textContent ?? '').includes(label));
      const fieldCell = cells.find((c) => !(c.textContent ?? '').includes(label));
      if (!labelCell || !fieldCell) throw new Error(`expected 2 table cells, got ${cells.length}`);
      return {
        labelX: labelCell.getBoundingClientRect().left,
        fieldX: fieldCell.getBoundingClientRect().left,
      };
    }, LABEL);

    expect(labelX).toBeGreaterThan(fieldX);
  });
});
