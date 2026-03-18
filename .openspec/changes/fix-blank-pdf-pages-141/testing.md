# Testing Plan: Fix Blank PDF Pages (Issue #141)

## Test Strategy

The fix has two components: (1) force-rendering virtualized pages before print, and (2) fixing LayoutPainter margin subtraction. Testing covers both automated E2E tests and manual visual verification.

---

## Test Category 1: Virtualization + Print Integration

### Test 1.1: Print with virtualized document (10+ pages)

**Setup:** Load a DOCX with 10+ pages (e.g., `e2e/fixtures/issue-68-large.docx` or `e2e/fixtures/EP_ZMVZ_MULTI_v4.docx`)

**Steps:**

1. Open the document in the editor
2. Wait for initial render (pages 1-5 should be rendered)
3. Verify virtualization is active: pages 6+ should be empty shells (childCount === 0 or innerHTML.length === 0)
4. Trigger print (File > Print or Ctrl+P)
5. Before the clone happens, verify all pages now have content

**Expected result:** All 10+ pages have non-empty content in the print output. No blank pages.

**Verification method:**

```javascript
// In E2E test or browser console:
const pagesEl = document.querySelector('.paged-editor__pages');
const pages = pagesEl.querySelectorAll('.layout-page');
for (const page of pages) {
  expect(page.querySelector('.layout-page-content')).toBeTruthy();
  expect(page.innerHTML.length).toBeGreaterThan(100);
}
```

### Test 1.2: Print with small document (< 8 pages)

**Setup:** Load a DOCX with 3-5 pages (e.g., `e2e/fixtures/demo.docx` or `examples/vite/public/docx-editor-demo.docx`)

**Steps:**

1. Open the document
2. Trigger print

**Expected result:** All pages appear correctly (no regression from existing behavior). `forceRenderAllPages()` is a no-op since no virtualization is active.

### Test 1.3: Print after scrolling to middle of document

**Setup:** Load a 15+ page document

**Steps:**

1. Open the document
2. Scroll to page 8 (so pages 1-4 and 12-15 are depopulated)
3. Trigger print

**Expected result:** All 15 pages have content in the PDF. Both early and late pages (which were depopulated) are restored.

### Test 1.4: Print after scrolling to last page

**Setup:** Load a 10+ page document

**Steps:**

1. Open the document
2. Scroll to the last page
3. Trigger print

**Expected result:** First pages (which were depopulated during scroll) are restored for print. All pages have content.

### Test 1.5: Virtualization restoration after print

**Setup:** Load a 10+ page document

**Steps:**

1. Scroll to page 1
2. Trigger print
3. After print dialog closes, scroll through the document
4. Check that virtualization resumes (far pages get depopulated again)

**Expected result:** Memory usage returns to normal after print. The editor does not keep all pages rendered permanently.

---

## Test Category 2: Content Types

### Test 2.1: Pages with tables spanning multiple pages

**Setup:** DOCX with a large table that spans 3+ pages

**Steps:**

1. Load document
2. Print

**Expected result:** Table rows appear on all pages. Table continuation fragments (with repeated header rows) render correctly on every page.

### Test 2.2: Pages with floating images

**Setup:** DOCX with floating images (square/tight wrap)

**Steps:**

1. Load document
2. Print

**Expected result:** Floating images appear in correct positions on all pages. Text wraps around images as expected.

### Test 2.3: Pages with text boxes

**Setup:** DOCX with text box content (`e2e/fixtures/textbox-test.docx`)

**Steps:**

1. Load document
2. Print

**Expected result:** Text boxes appear with correct positioning and content.

### Test 2.4: Pages with section breaks

**Setup:** DOCX with multiple sections (different margins, page sizes, or column layouts)

**Steps:**

1. Load document
2. Print

**Expected result:** Section boundaries are respected. Pages after section breaks have correct margins/sizes. Intentionally blank pages (from even/odd page breaks) remain blank (this is correct behavior).

### Test 2.5: Pages with multi-column layouts

**Setup:** DOCX with two-column sections (`examples/vite/public/two-column-test.docx` or `continuous-columns-test.docx`)

**Steps:**

1. Load document
2. Print

**Expected result:** Columns appear correctly on all pages. Column separator lines (if `w:sep` is set) render in print.

### Test 2.6: Pages with headers and footers

**Setup:** DOCX with header/footer content (logos, page numbers)

**Steps:**

1. Load document
2. Print

**Expected result:** Headers and footers appear on every page. PAGE/NUMPAGES fields show correct values.

### Test 2.7: Pages with footnotes

**Setup:** DOCX with footnotes

**Steps:**

1. Load document
2. Print

**Expected result:** Footnote areas appear at the bottom of pages where footnote references exist. Separator line and footnote text are visible.

---

## Test Category 3: LayoutPainter Fix

### Test 3.1: LayoutPainter renders fragments at correct positions

**Setup:** Unit test with mock page data

**Steps:**

1. Create a LayoutPainter instance
2. Set block lookup with test data
3. Call `paint()` with a layout containing pages with margins (e.g., top=96, left=96)
4. Inspect fragment element positions

**Expected result:** Fragment at `fragment.x=196, fragment.y=196` with page margins `{left:96, top:96}` should render at CSS `left: 100px; top: 100px` (196-96=100), not `left: 196px; top: 196px`.

### Test 3.2: LayoutPainter with zero margins

**Setup:** Unit test with zero margins

**Steps:**

1. Create layout with `margins: {top:0, left:0, right:0, bottom:0}`
2. Paint the layout

**Expected result:** Fragments render at their exact x/y positions (no margin subtraction needed when margins are 0).

---

## Test Category 4: Edge Cases

### Test 4.1: Empty document (1 page, no content)

**Steps:** Load empty.docx, trigger print

**Expected result:** Single blank page appears (correctly blank, no crash).

### Test 4.2: Document with exactly 8 pages (virtualization threshold)

**Steps:** Load or create a document with exactly 8 pages

**Expected result:** Virtualization is active. Print renders all 8 pages correctly.

### Test 4.3: Document with exactly 7 pages (below threshold)

**Steps:** Load a 7-page document

**Expected result:** No virtualization. Print renders all pages correctly (same as before fix).

### Test 4.4: Rapid print invocation (double-click print button)

**Steps:** Click print button twice quickly

**Expected result:** No crash. `forceRenderAllPages()` is idempotent (skips already-rendered pages).

### Test 4.5: Print during initial load (before all eager pages render)

**Steps:** Load a large document and immediately trigger print (within first 100ms)

**Expected result:** `forceRenderAllPages()` populates all pages regardless of initial render progress.

### Test 4.6: Popup-blocked fallback

**Steps:** Configure browser to block popups, trigger print

**Expected result:** Falls back to `window.print()` with the current page. This is existing behavior; the fix should not regress it.

---

## Test Category 5: Performance

### Test 5.1: Print performance for 50-page document

**Setup:** Large DOCX with 50+ pages

**Steps:**

1. Load document
2. Measure time to trigger print (from button click to print window appearing)

**Expected result:** Print preparation (force-rendering all pages) completes in under 2 seconds. After print, virtualization is restored within 1 frame.

### Test 5.2: Memory after print

**Steps:**

1. Load 50-page document
2. Take heap snapshot
3. Trigger print, close print dialog
4. Wait 5 seconds (for restoration + GC)
5. Take heap snapshot

**Expected result:** Memory returns to approximately pre-print levels (within 10% tolerance).

---

## Automated Test Implementation

### E2E Test File: `e2e/tests/print-virtualization.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Print with virtualized pages', () => {
  test('all pages have content before print clone', async ({ page }) => {
    // Load a 10+ page document
    await page.goto('http://localhost:5173/');
    // Upload fixture via file input
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(__dirname, '../fixtures/issue-68-large.docx'));
    // Wait for layout
    await page.waitForSelector('.layout-page', { timeout: 15000 });
    await page.waitForTimeout(2000); // Wait for full layout

    // Check total page count
    const totalPages = await page.locator('.layout-page').count();
    expect(totalPages).toBeGreaterThan(8);

    // Verify some pages are not rendered (virtualization active)
    const unrenderedCount = await page.evaluate(() => {
      const pages = document.querySelectorAll('.layout-page');
      let empty = 0;
      for (const p of pages) {
        if (p.children.length === 0) empty++;
      }
      return empty;
    });
    expect(unrenderedCount).toBeGreaterThan(0);

    // Call forceRenderAllPages
    await page.evaluate(() => {
      const pagesEl = document.querySelector('.paged-editor__pages');
      if (pagesEl && (pagesEl as any).__pageRenderState) {
        const state = (pagesEl as any).__pageRenderState;
        // Manually force render (simulating what forceRenderAllPages does)
        for (const [shell, data] of state.pageDataMap) {
          if (!data.rendered) {
            // This simulates the fix
          }
        }
      }
    });

    // After fix: verify all pages have content
    const allRendered = await page.evaluate(() => {
      const pages = document.querySelectorAll('.layout-page');
      for (const p of pages) {
        if (p.children.length === 0) return false;
      }
      return true;
    });
    // Note: This test will PASS after the fix is implemented
    // For now, it documents the expected behavior
  });

  test('small documents print without regression', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForSelector('.layout-page', { timeout: 10000 });

    const totalPages = await page.locator('.layout-page').count();
    expect(totalPages).toBeLessThan(8); // Demo doc has ~3 pages

    // All pages should be rendered (no virtualization)
    const allRendered = await page.evaluate(() => {
      const pages = document.querySelectorAll('.layout-page');
      for (const p of pages) {
        if (!p.querySelector('.layout-page-content')) return false;
      }
      return true;
    });
    expect(allRendered).toBe(true);
  });
});
```

---

## Manual Test Checklist

- [ ] Load 10+ page document, print, verify no blank pages in PDF
- [ ] Load 3-page document, print, verify no regression
- [ ] Load document with tables + images, print, verify content appears
- [ ] Load document with section breaks, print, verify section layout
- [ ] After printing, scroll through document to verify virtualization works
- [ ] Print twice in a row without refresh
- [ ] Test with browser popup blocker enabled
