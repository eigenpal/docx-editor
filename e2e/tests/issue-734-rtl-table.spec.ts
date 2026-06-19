/**
 * Issue #734: an RTL table (`w:bidiVisual`) must render its columns in reversed
 * visual order — the Hebrew label in logical cell 0 belongs to the RIGHT of the
 * underline field in cell 1, matching Word. Before the painter mirror the label
 * rendered on the wrong (left) side.
 *
 * React demo (port 5173). The painter is shared core, so Vue is covered by
 * e2e/tests/vue/issue-734-rtl-table.spec.ts with the same assertion.
 */
import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/rtl-table-bidivisual.docx';
const LABEL = 'בדיקה';

async function labelIsRightOfField(page: Page): Promise<{ labelX: number; fieldX: number }> {
  return page.evaluate((label) => {
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
}

test.describe('Issue #734 — RTL (bidiVisual) table column order', () => {
  test('Hebrew label cell renders to the right of the field cell', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
    // Wait for THIS fixture to paint (not a pre-existing demo doc) by keying on
    // its Hebrew label inside a painted table cell.
    await page.waitForFunction((label) => {
      const cells = document.querySelectorAll('.layout-page-content .layout-table-cell');
      return [...cells].some((c) => (c.textContent ?? '').includes(label as string));
    }, LABEL);

    const { labelX, fieldX } = await labelIsRightOfField(page);
    // RTL: the label (logical column 0) sits to the right of the field.
    expect(labelX).toBeGreaterThan(fieldX);
  });
});
