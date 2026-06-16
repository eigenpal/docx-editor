/**
 * Full-width floating (positioned) tables must paginate across pages.
 *
 * A DOCX table with `w:tblpPr` is a positioned/text-wrapped table. When such a
 * table spans (nearly) the full content width there is no room for text beside
 * it, so Word and Google Docs treat it as a normal in-flow block: it breaks
 * across pages and following content flows beneath it.
 *
 * The editor used to route it through the floating path, which (1) placed every
 * row in one fragment that overflowed past the page's bottom margin and (2) gave
 * the next paragraph a wrap-zone skip the height of the whole table — pushing it
 * off the next page and stranding the body text a page later. `computeLayout`
 * now demotes such block-like floating tables to inline before measure + layout
 * (core fix → covers React and Vue).
 *
 * Fixture is synthetic (lorem ipsum only) so it can live in the repo.
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/floating-table-full-width-paginates.docx';

test('a full-width floating table paginates instead of overflowing the page', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1200, height: 1400 });
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();
  await editor.loadDocxFile(FIXTURE);
  await page.waitForTimeout(1000);

  const metrics = await page.evaluate(() => {
    const pages = Array.from(document.querySelectorAll('.layout-page')) as HTMLElement[];

    let tableFragmentCount = 0;
    let maxTableBottomOverflow = -Infinity;
    const pagesWithTable = new Set<string>();

    for (const pageEl of pages) {
      const content = pageEl.querySelector('.layout-page-content') as HTMLElement | null;
      if (!content) continue;
      const contentRect = content.getBoundingClientRect();
      for (const t of Array.from(content.querySelectorAll('.layout-table')) as HTMLElement[]) {
        tableFragmentCount++;
        pagesWithTable.add(pageEl.dataset.pageNumber ?? '?');
        const r = t.getBoundingClientRect();
        // How far the fragment's bottom extends past the content area bottom.
        maxTableBottomOverflow = Math.max(maxTableBottomOverflow, r.bottom - contentRect.bottom);
      }
    }

    // The body heading that follows the table.
    const afterEls = Array.from(document.querySelectorAll('.layout-paragraph')).filter((el) =>
      (el.textContent ?? '').includes('THE FOLLOWING TEXT APPEARS AFTER THE TABLE')
    ) as HTMLElement[];
    const afterParagraphHeight = afterEls[0]
      ? Math.round(afterEls[0].getBoundingClientRect().height)
      : -1;

    return {
      totalPages: pages.length,
      tableFragmentCount,
      pagesWithTableCount: pagesWithTable.size,
      maxTableBottomOverflow: Math.round(maxTableBottomOverflow),
      afterParagraphHeight,
    };
  });

  // The table breaks across multiple pages rather than rendering as one block.
  expect(metrics.tableFragmentCount).toBeGreaterThan(1);
  expect(metrics.pagesWithTableCount).toBeGreaterThan(1);

  // No table fragment overflows its page's content area (a few px tolerance for
  // sub-pixel rounding). The bug placed a single fragment hundreds of px past it.
  expect(metrics.maxTableBottomOverflow).toBeLessThanOrEqual(4);

  // The paragraph after the table is a normal one-line heading, not pushed past
  // the whole table height by a stale wrap zone (the bug inflated it to ~2500px).
  expect(metrics.afterParagraphHeight).toBeGreaterThan(0);
  expect(metrics.afterParagraphHeight).toBeLessThan(100);
});
