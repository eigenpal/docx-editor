import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

/**
 * issue #705 — a header containing page-anchored floating objects (a full-page
 * letterhead built from anchored text boxes / shapes) used to inflate the
 * effective top margin past the page height. The pageComposer then threw
 * "page size and margins yield no content area" and the body rendered blank.
 *
 * The fix drives the body-margin push from the header's IN-FLOW band height
 * (`flowHeight`), so page/margin-anchored floats no longer push the body —
 * matching Word, where a letterhead sits behind the body and body text starts
 * at the top margin.
 */
test.describe('issue #705 — page-anchored header letterhead', () => {
  test('paginates and renders the body instead of throwing', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1100 });

    const layoutErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (text.includes('Layout pipeline error') || text.includes('no content area')) {
        layoutErrors.push(text);
      }
    });

    const editor = new EditorPage(page);
    await editor.goto();
    await editor.loadDocxFile('fixtures/issue-705-anchored-header-letterhead.docx');
    await page.waitForTimeout(2000);

    // 1. The pageComposer must not abort.
    expect(layoutErrors, layoutErrors.join('\n')).toEqual([]);

    // 2. At least one page paints body content (the document is not blank).
    const painted = await page.evaluate(() => {
      const pages = Array.from(document.querySelectorAll('.layout-page'));
      const bodyText = pages
        .map((p) => p.querySelector('.layout-page-content')?.textContent ?? '')
        .join('')
        .replace(/\s+/g, '');
      return { pageCount: pages.length, bodyTextLength: bodyText.length };
    });
    expect(painted.pageCount).toBeGreaterThan(0);
    expect(painted.bodyTextLength).toBeGreaterThan(0);
  });
});
