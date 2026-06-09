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
