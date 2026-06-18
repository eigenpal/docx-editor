import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

/**
 * #856 — a header containing a page/margin-anchored shape (a full-page
 * letterhead banner) must not inflate the header's interactive box to cover the
 * whole page. The shape still renders, but clicking the body must place the
 * caret in the body, not be swallowed by the header.
 */
test.describe('#856 header shape overlay', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.loadDocxFile('fixtures/issue-856-custom-header.docx');
    await page.waitForTimeout(1200);
  });

  test('header box does not cover the body and the shape still renders', async () => {
    const info = await editor.page.evaluate(() => {
      const header = document.querySelector('.layout-page-header') as HTMLElement | null;
      const content = document.querySelector('.layout-page-content') as HTMLElement | null;
      // The anchored shape renders as a textbox inside the header.
      const shape = document.querySelector(
        '.layout-page-header .layout-textbox'
      ) as HTMLElement | null;
      const hr = header?.getBoundingClientRect();
      const cr = content?.getBoundingClientRect();
      const sr = shape?.getBoundingClientRect();
      // What is the topmost element over a point inside the body text column?
      const probeX = cr ? cr.left + 80 : 0;
      const probeY = cr ? cr.top + 140 : 0;
      const top = document.elementsFromPoint(probeX, probeY)[0] as HTMLElement | undefined;
      return {
        headerHeight: hr ? Math.round(hr.height) : -1,
        pageContentTop: cr ? Math.round(cr.top) : -1,
        shapeHeight: sr ? Math.round(sr.height) : -1,
        topElementIsBody: !!top?.closest('.layout-page-content'),
        topElementInHeader: !!top?.closest('.layout-page-header'),
      };
    });

    // The header box is the in-flow band, not the ~868px shape extent.
    expect(info.headerHeight).toBeLessThan(120);
    // The shape itself is still painted at full height (it's a tall banner).
    expect(info.shapeHeight).toBeGreaterThan(400);
    // A point in the body column hits the body, not the header/shape.
    expect(info.topElementIsBody).toBe(true);
    expect(info.topElementInHeader).toBe(false);
  });

  test('clicking the body places the caret in the body text', async () => {
    // Click a body paragraph and confirm the PM caret lands in the body doc.
    const para = editor.page.locator('.layout-page-content .layout-paragraph').nth(2);
    await para.scrollIntoViewIfNeeded();
    const box = await para.boundingBox();
    if (!box) throw new Error('body paragraph not found');
    await editor.page.mouse.click(box.x + 20, box.y + box.height / 2);

    const sel = await editor.page.evaluate(() => {
      const view = window.__DOCX_EDITOR_E2E__?.getView();
      return { from: view?.state.selection.from ?? -1, docSize: view?.state.doc.content.size ?? 0 };
    });
    // Caret moved into the body (not stuck at 0/no-op).
    expect(sel.from).toBeGreaterThan(0);
    expect(sel.from).toBeLessThan(sel.docSize);
  });
});
