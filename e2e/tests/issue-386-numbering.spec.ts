import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test.describe('issue #386: numbering with multiple numIds sharing one abstractNum', () => {
  test('counter restarts on each numId with startOverride and continues across', async ({
    page,
  }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.loadDocxFile('fixtures/docx-editor-numbering.docx');

    const markers = await page.locator('.layout-list-marker').allTextContents();
    // Per ECMA-376 §17.9.18: numIds 8/9/10/11 each have <w:lvlOverride> with
    // startOverride=1 pointing to the abstract num shared with numId 4. Each
    // table cell restarts at (1) via the override, then continues with the
    // shared counter.
    expect(markers).toEqual(['(1)', '(2)', '(1)', '(2)', '(1)', '(2)', '(3)', '(1)', '(2)', '(3)']);
  });

  test('table cell body lines fill full cell width when level ind uses w:start', async ({
    page,
  }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.loadDocxFile('fixtures/docx-editor-numbering.docx');

    const measurements = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('.layout-table-cell'));
      const right = cells.find((c) => (c.textContent || '').includes('Contractors undertake'));
      if (!right) return null;
      const cellWidth = (right as HTMLElement).getBoundingClientRect().width;
      const lineWidths = Array.from(right.querySelectorAll('.layout-line')).map(
        (l) => (l as HTMLElement).getBoundingClientRect().width
      );
      return { cellWidth, lineWidths };
    });
    expect(measurements).not.toBeNull();
    // Pre-fix lines were ~48px short of the cell because the level's
    // `<w:ind w:start="0"/>` was ignored and a 720-twip fallback applied.
    // 2px tolerance avoids sub-pixel flakes; the original gap was 48px.
    for (const w of measurements!.lineWidths) {
      expect(measurements!.cellWidth - w).toBeLessThan(2);
    }
  });
});
