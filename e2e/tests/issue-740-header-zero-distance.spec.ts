import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

/**
 * issue #740 — a document with `w:header="0"` (header pinned to the page top)
 * paginated to 2 pages while Word fits it on 1. The header distance `0` was
 * treated as falsy and replaced with Word's 0.5in default, over-reserving the
 * header band and pushing content onto a second page. With the explicit 0
 * honored, the content fits on a single page like Word.
 */
test.describe('issue #740 — w:header="0" pagination parity', () => {
  test('fits on a single page like Word', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1100 });

    const editor = new EditorPage(page);
    await editor.goto();
    await editor.loadDocxFile('fixtures/issue-740-header-zero-distance.docx');
    await page.waitForSelector('[data-page-number]');
    await page.waitForTimeout(1500);

    const pageCount = await page.evaluate(() => document.querySelectorAll('.layout-page').length);
    expect(pageCount).toBe(1);

    // This fixture deliberately contains several very long Latin tokens. Word
    // breaks them at character boundaries; treating each token as atomic makes
    // the body collapse into a handful of overflowing lines while this page-
    // count assertion still passes.
    const bodyGeometry = await page.evaluate(() => {
      const pageElement = document.querySelector<HTMLElement>('.layout-page');
      const paragraphs = Array.from(
        document.querySelectorAll<HTMLElement>('.layout-page-content .layout-paragraph')
      );
      const lines = paragraphs.flatMap((paragraph) =>
        Array.from(paragraph.querySelectorAll<HTMLElement>('.layout-line'))
      );
      const maxTextOverflow = lines.reduce((max, line) => {
        const paragraphRight =
          line.closest<HTMLElement>('.layout-paragraph')?.getBoundingClientRect().right ??
          line.getBoundingClientRect().right;
        const overflow = Array.from(line.querySelectorAll<HTMLElement>('.layout-run-text')).reduce(
          (lineMax, run) => Math.max(lineMax, run.getBoundingClientRect().right - paragraphRight),
          0
        );
        return Math.max(max, overflow);
      }, 0);
      const pageRect = pageElement?.getBoundingClientRect();
      const lastRect = paragraphs.at(-1)?.getBoundingClientRect();
      const contentRect = document
        .querySelector<HTMLElement>('.layout-page-content')
        ?.getBoundingClientRect();

      return {
        paragraphCount: paragraphs.length,
        totalLineCount: lines.length,
        firstLongParagraphLineCount: paragraphs[2]?.querySelectorAll('.layout-line').length ?? 0,
        firstLineHeight: Number.parseFloat(lines[0]?.style.lineHeight ?? '0'),
        lastParagraphBottomRatio:
          pageRect && lastRect ? (lastRect.bottom - pageRect.top) / pageRect.height : 0,
        maxTextOverflow,
        maxLineExtension: contentRect
          ? Math.max(...lines.map((line) => line.getBoundingClientRect().right - contentRect.right))
          : 0,
      };
    });

    expect(bodyGeometry.paragraphCount).toBe(12);
    expect(bodyGeometry.firstLongParagraphLineCount).toBe(8);
    expect(bodyGeometry.totalLineCount).toBe(43);
    expect(bodyGeometry.firstLineHeight).toBeCloseTo(17.7184, 2);
    expect(bodyGeometry.lastParagraphBottomRatio).toBeCloseTo(0.88447, 2);
    expect(bodyGeometry.maxTextOverflow).toBeLessThanOrEqual(1);
    expect(bodyGeometry.maxLineExtension).toBeCloseTo(23 / 15, 1);

    // The header is pinned to the page top (`w:header="0"`), so the body content
    // area starts right below the header band — not the 0.5in-default offset.
    const headerTop = await page.evaluate(() => {
      const p = document.querySelector('.layout-page');
      const header = p?.querySelector('.layout-page-header');
      if (!p || !header) return null;
      return Math.round(header.getBoundingClientRect().top - p.getBoundingClientRect().top);
    });
    expect(headerTop).toBe(0);
  });
});
