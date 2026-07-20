import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/header-with-table.docx';

// Regression: a body selection used to spawn phantom selection rects on top of
// header (and footer) text whenever the header's PM positions overlapped the
// body's. Header content is parsed via a separate ProseMirror document
// (convertHeaderFooterToContent) whose positions also start at 1, so
// `data-doc-from` collides between body and HF runs. The DOM-based selection
// painter in PagedEditor.tsx queried every span on the page, matched both
// trees, and painted a rect on each. Now scoped to `.layout-page-content`.
test.describe('Header/footer selection-rect isolation', () => {
  test('selecting body text does not paint selection rects in the header', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();

    await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
    await page.waitForSelector('.paged-editor__pages');
    await page.waitForSelector('[data-page-number]');
    await expect(page.locator('.layout-page-header [data-from-row]')).toHaveCount(1, {
      timeout: 15000,
    });

    // Triple-click on body text to select the entire body paragraph. This
    // produces a body selection that starts at low PM positions, which is
    // exactly the case that used to leak into the header.
    const bodyParagraph = page.locator('.layout-page-content .layout-paragraph').first();
    await expect(bodyParagraph).toContainText('BODY TEXT');
    await bodyParagraph.click({ clickCount: 3 });

    // Selection rects render on the next tick.
    await page.waitForTimeout(150);

    const result = await page.evaluate(() => {
      const headerEl = document.querySelector<HTMLElement>('.layout-page-header');
      const footerEl = document.querySelector<HTMLElement>('.layout-page-footer');
      const headerRect = headerEl?.getBoundingClientRect() ?? null;
      const footerRect = footerEl?.getBoundingClientRect() ?? null;

      const intersects = (a: DOMRect, b: DOMRect | null) =>
        b !== null && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

      const rects = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid^="selection-rect"]')
      );

      const totalRects = rects.length;
      const inHeader = rects.filter((r) =>
        intersects(r.getBoundingClientRect(), headerRect)
      ).length;
      const inFooter = rects.filter((r) =>
        intersects(r.getBoundingClientRect(), footerRect)
      ).length;

      return { totalRects, inHeader, inFooter };
    });

    // The body has selectable content, so we expect at least one rect.
    expect(result.totalRects).toBeGreaterThan(0);
    // Before the fix this was equal to the number of header runs whose
    // docFrom..docTo overlapped the body selection (HEADER LOGO + HEADER TEXT
    // cells in this fixture). The fix scopes the DOM query so HF spans are
    // never matched by a body selection.
    expect(result.inHeader).toBe(0);
    expect(result.inFooter).toBe(0);
  });
});
