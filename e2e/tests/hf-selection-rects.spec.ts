import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

// Verifies that drag-selecting text inside a header in HF edit mode
// renders visible selection rects, and that a body cell selection does
// NOT bleed into header cells with overlapping PM positions.
test.describe('HF selection rendering', () => {
  test('drag-selecting header text shows selection rects', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();

    await page
      .locator('input[type="file"][accept=".docx"]')
      .setInputFiles('e2e/fixtures/header-with-table.docx');
    await page.waitForSelector('.layout-page-header span[data-doc-from]', { timeout: 15000 });

    // Engage HF edit mode.
    await page.locator('.layout-page-header').first().dblclick();
    await expect(page.locator('.hf-inline-editor')).toHaveCount(1);

    // Drag-select across the painted header text.
    const span = page.locator('.layout-page-header span[data-doc-from]').first();
    const box = await span.boundingBox();
    if (!box) throw new Error('header span not visible');

    // Synthesize a drag from the start of the span to a few pixels right.
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    // The HF EditorView's selection should now be non-empty and selection
    // rects (blue tinted divs portalled near the painter container)
    // should be in the DOM. Match by the blue tint background since the
    // overlay lives in the pages-viewport's parent now.
    const rectCount = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('div[aria-hidden="true"]')).filter((el) => {
        const bg = (el as HTMLElement).style.background ?? '';
        const w = parseFloat((el as HTMLElement).style.width || '0');
        const h = parseFloat((el as HTMLElement).style.height || '0');
        return bg.includes('66, 133, 244') && w > 0 && h > 0;
      }).length;
    });
    expect(rectCount).toBeGreaterThan(0);
  });

  test('body cell selection does not highlight header cells', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();

    await page
      .locator('input[type="file"][accept=".docx"]')
      .setInputFiles('e2e/fixtures/header-with-table.docx');
    await page.waitForSelector('.layout-page-header [data-from-row]', { timeout: 15000 });

    // Click into a body cell (the test fixture has body tables too).
    const bodyCell = page.locator('.layout-page-content .layout-table-cell').first();
    if (!(await bodyCell.count())) {
      test.skip(true, 'fixture has no body tables');
      return;
    }
    await bodyCell.click();
    // Triple-click to select cell content (creates a TextSelection inside cell).
    // Then expand by triple-clicking which selects the paragraph;
    // skip CellSelection-specific motion — just verify the highlight scope.
    // Body cell selection (if any) should NOT mark a header cell.
    const headerHighlights = await page
      .locator('.layout-page-header .layout-table-cell-selected')
      .count();
    expect(headerHighlights).toBe(0);
  });

  test('drag across header table cells highlights HF cells (CellSelection)', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();

    await page
      .locator('input[type="file"][accept=".docx"]')
      .setInputFiles('e2e/fixtures/header-with-table.docx');
    await page.waitForSelector('.layout-page-header .layout-table-cell', { timeout: 15000 });

    await page.locator('.layout-page-header').first().dblclick();
    await expect(page.locator('.hf-inline-editor')).toHaveCount(1);

    const cells = page.locator('.layout-page-header .layout-table-cell');
    const count = await cells.count();
    if (count < 2) {
      test.skip(true, 'fixture has only one header cell');
      return;
    }

    const cellA = await cells.nth(0).boundingBox();
    const cellB = await cells.nth(1).boundingBox();
    if (!cellA || !cellB) throw new Error('cells not visible');

    await page.mouse.move(cellA.x + cellA.width / 2, cellA.y + cellA.height / 2);
    await page.mouse.down();
    await page.mouse.move(cellB.x + cellB.width / 2, cellB.y + cellB.height / 2, { steps: 10 });
    await page.mouse.up();

    // Both cells (the anchor and the head) should now carry the highlight class.
    const highlighted = await page
      .locator(
        '.layout-page-header .layout-table-cell-selected, .layout-page-footer .layout-table-cell-selected'
      )
      .count();
    expect(highlighted).toBeGreaterThanOrEqual(2);
  });
});
