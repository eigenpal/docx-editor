import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/table-cell-selection-drag.docx';

async function loadFixture(page: Page) {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();
  await editor.loadDocxFile(FIXTURE);
  await page.waitForSelector('.layout-page-content .layout-table-cell');
}

async function textPoint(page: Page, cellIndex: number, needle: string) {
  return await page.evaluate(
    ({ cellIndex, needle }) => {
      const cell = document.querySelectorAll('.layout-page-content .layout-table-cell')[cellIndex];
      if (!cell) throw new Error(`cell ${cellIndex} not found`);

      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      let node: Text | null = null;
      while ((node = walker.nextNode() as Text | null)) {
        const index = node.textContent?.indexOf(needle) ?? -1;
        if (index === -1) continue;

        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + 1, y: rect.top + rect.height / 2 };
      }
      throw new Error(`text "${needle}" not found`);
    },
    { cellIndex, needle }
  );
}

async function sameCellWhitespacePoint(page: Page) {
  return await page.evaluate(() => {
    const cell = document.querySelector('.layout-page-content .layout-table-cell');
    if (!cell) throw new Error('first cell not found');
    const rect = cell.getBoundingClientRect();
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    let lastNode: Text | null = null;
    while (walker.nextNode()) lastNode = walker.currentNode as Text;
    if (!lastNode) throw new Error('first cell text not found');

    const range = document.createRange();
    range.setStart(lastNode, lastNode.length);
    range.setEnd(lastNode, lastNode.length);
    const endRect = range.getBoundingClientRect();
    return {
      x: Math.min(rect.right - 16, endRect.left + 48),
      y: endRect.top + Math.max(1, endRect.height / 2),
    };
  });
}

async function drag(page: Page, start: { x: number; y: number }, end: { x: number; y: number }) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 3, start.y, { steps: 2 });
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

async function isCellSelection(page: Page) {
  return await page.evaluate(() => {
    const selection = window.__DOCX_EDITOR_E2E__?.getView?.()?.state.selection as
      | { $anchorCell?: unknown; forEachCell?: unknown }
      | undefined;
    return Boolean(selection?.$anchorCell && typeof selection.forEachCell === 'function');
  });
}

test.describe('table cell text selection', () => {
  test('dragging within one cell keeps a precise text selection', async ({ page }) => {
    await loadFixture(page);

    await drag(page, await textPoint(page, 0, 'planning'), await sameCellWhitespacePoint(page));

    await expect
      .poll(() => page.evaluate(() => window.__DOCX_EDITOR_E2E__?.agentSelection()?.selectedText))
      .toContain('planning');

    const selectedText = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.agentSelection()?.selectedText ?? ''
    );
    expect(selectedText).not.toContain('Quarterly');
    expect(await isCellSelection(page)).toBe(false);
    expect(await page.locator('.layout-table-cell-selected').count()).toBe(0);
  });

  test('dragging into another cell still selects cells', async ({ page }) => {
    await loadFixture(page);

    await drag(page, await textPoint(page, 0, 'planning'), await textPoint(page, 1, 'neighboring'));

    expect(await isCellSelection(page)).toBe(true);
    await expect.poll(() => page.locator('.layout-table-cell-selected').count()).toBeGreaterThan(1);
  });
});
