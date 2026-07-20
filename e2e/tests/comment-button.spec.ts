/**
 * Comment Button Positioning Tests
 *
 * Verifies the floating "add comment" button appears vertically
 * aligned with the selected text, regardless of scroll position.
 * Regression test for #185: button drifted vertically when scrolled.
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const DEMO_DOCX_PATH = 'fixtures/demo/demo.docx';

/**
 * Find the floating comment button (position:absolute, z-index:50) and return its
 * bounding box, or null if not found.
 */
async function findCommentButton(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const btns = document.querySelectorAll('[data-testid="docx-editor"] button');
    for (const btn of btns) {
      const style = getComputedStyle(btn);
      if (style.position === 'absolute' && style.zIndex === '50') {
        const rect = btn.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        };
      }
    }
    return null;
  });
}

/** Right edge of the first visible page element, in viewport coordinates. */
async function getPageRightEdge(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const pageEl = document.querySelector('.layout-page') as HTMLElement | null;
    if (!pageEl) return null;
    return pageEl.getBoundingClientRect().right;
  });
}

/**
 * Find the visible span in .paged-editor__pages that contains the given text,
 * return its bounding box center Y.
 */
async function findTextSpanY(page: import('@playwright/test').Page, text: string) {
  return page.evaluate((searchText) => {
    const spans = document.querySelectorAll('.paged-editor__pages span[data-doc-from]');
    for (const span of spans) {
      if (span.textContent?.includes(searchText)) {
        const rect = span.getBoundingClientRect();
        return { centerY: rect.top + rect.height / 2, top: rect.top, bottom: rect.bottom };
      }
    }
    return null;
  }, text);
}

test.describe('Comment Button - Scroll Position (#185)', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.loadDocxFile(DEMO_DOCX_PATH);
    await page.waitForSelector('.paged-editor__pages .layout-page', { timeout: 10000 });
  });

  test('comment button appears aligned with selection near top', async ({ page }) => {
    const selected = await editor.selectText('Demonstration');
    expect(selected).toBe(true);
    await page.waitForTimeout(300);

    const btn = await findCommentButton(page);
    expect(btn).not.toBeNull();

    const span = await findTextSpanY(page, 'Demonstration');
    expect(span).not.toBeNull();

    // Button should be within 50px vertically of the text
    expect(Math.abs(btn!.centerY - span!.centerY)).toBeLessThan(50);
  });

  test('comment button appears aligned with selection further down (#185 regression)', async ({
    page,
  }) => {
    // Select text deeper in the document — triggers scroll in the editor
    const selected = await editor.selectText('bold-italic');
    expect(selected).toBe(true);
    await page.waitForTimeout(300);

    const btn = await findCommentButton(page);
    expect(btn).not.toBeNull();

    const span = await findTextSpanY(page, 'bold-italic');
    expect(span).not.toBeNull();

    // Before the fix, scrollTop was added to the position calculation,
    // causing the button to drift hundreds of pixels below the selection.
    // With the fix, the button should be within 50px of the span.
    expect(Math.abs(btn!.centerY - span!.centerY)).toBeLessThan(50);
  });

  test('comment button position is consistent across multiple selections (#185 regression)', async ({
    page,
  }) => {
    // Test that the button offset doesn't grow with document position
    // This is the core #185 regression: the further down you select, the more drift
    const texts = ['Demonstration', 'bold-italic', 'footnote'];
    const diffs: number[] = [];

    for (const text of texts) {
      const selected = await editor.selectText(text);
      if (!selected) continue;
      await page.waitForTimeout(300);

      const btn = await findCommentButton(page);
      const span = await findTextSpanY(page, text);
      if (!btn || !span) continue;

      diffs.push(Math.abs(btn.centerY - span.centerY));
    }

    // All diffs should be small (< 50px)
    for (const diff of diffs) {
      expect(diff).toBeLessThan(50);
    }

    // The drift should NOT increase with document position
    // (before the fix, later selections would have much larger diffs)
    if (diffs.length >= 2) {
      const maxDiff = Math.max(...diffs);
      const minDiff = Math.min(...diffs);
      // The difference between max and min drift should be small
      // Before the fix, this could be hundreds of pixels
      expect(maxDiff - minDiff).toBeLessThan(30);
    }
  });
});

test.describe('Comment Button - Geometry changes (#268 dedup)', () => {
  // Regression guard for the state-identity dedup in
  // PagedEditor.updateSelectionOverlay (#268). That fix stopped re-firing
  // onSelectionChange on every overlay redraw, so geometry-driven callers
  // like the floating comment button now subscribe to resize / zoom
  // themselves. These tests verify they still track the selection.

  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.loadDocxFile(DEMO_DOCX_PATH);
    await page.waitForSelector('.paged-editor__pages .layout-page', { timeout: 10000 });
  });

  test('floating button re-anchors to page right edge after window resize', async ({ page }) => {
    // The button's left coord is computed from the page's right edge. Before
    // the fix, resizing the window (which re-centers the page) left the button
    // stranded at the OLD page edge while the page moved.
    const selected = await editor.selectText('Demonstration');
    expect(selected).toBe(true);
    await page.waitForTimeout(300);

    await page.setViewportSize({ width: 900, height: 700 });
    await page.waitForTimeout(400);

    const btn = await findCommentButton(page);
    const pageRight = await getPageRightEdge(page);
    expect(btn, 'button should still exist after resize').not.toBeNull();
    expect(pageRight).not.toBeNull();

    // Button is centered on the page right edge (transform: translate(-50%)).
    // It must track within a few px of the current page right edge.
    expect(
      Math.abs(btn!.centerX - pageRight!),
      `button centerX=${btn!.centerX} drifted from pageRight=${pageRight}`
    ).toBeLessThan(20);
  });

  test('floating button tracks page right edge across multiple resize steps', async ({ page }) => {
    const selected = await editor.selectText('Demonstration');
    expect(selected).toBe(true);
    await page.waitForTimeout(300);

    for (const width of [1024, 800, 1400, 1100]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(300);

      const btn = await findCommentButton(page);
      const pageRight = await getPageRightEdge(page);
      expect(btn, `button missing at width ${width}`).not.toBeNull();
      expect(pageRight, `page right missing at width ${width}`).not.toBeNull();
      expect(
        Math.abs(btn!.centerX - pageRight!),
        `button drifted from page edge at width ${width}: ${btn!.centerX} vs ${pageRight}`
      ).toBeLessThan(20);
    }
  });
});
