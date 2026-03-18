# Design: Fix Blank PDF Pages (Issue #141)

## Problem Statement

When generating a PDF from a DOCX document using the editor's print/PDF feature, some pages that contain content in the original DOCX appear blank in the resulting PDF. The issue is reported for documents with approximately 10 pages, where several of those pages lose their content during the print-to-PDF process.

## Root Cause Analysis

### Hypothesis A: Page Virtualization (PRIMARY ROOT CAUSE -- CONFIRMED)

**Verdict: This is the primary cause of blank pages in PDF output.**

The `paintPages()` function in `packages/core/src/layout-painter/paintPage.ts` implements page virtualization for performance. The key constants are:

```
VIRTUALIZATION_THRESHOLD = 8   // Pages before virtualization activates
VIRTUALIZATION_BUFFER = 2      // Pages to keep rendered around the viewport
```

For documents with 8+ pages, the system creates lightweight "shell" elements for all pages (correct dimensions, no content), then uses an `IntersectionObserver` to lazily populate/depopulate page content as the user scrolls:

- **`populatePageShell()`** -- renders full page content when the page enters/approaches the viewport
- **`depopulatePageShell()`** -- clears page content (`shell.innerHTML = ''`) when the page scrolls far away
- Only the first `VIRTUALIZATION_BUFFER + 3 = 5` pages are eagerly rendered on initial load

The print function in `DocxEditor.tsx` (`handleDirectPrint`) clones the DOM:

```typescript
const pagesClone = pagesEl.cloneNode(true) as HTMLElement;
```

This captures the **current state** of the DOM, including:

- Fully rendered pages (near viewport) -- these appear correctly in the PDF
- Empty shell pages (far from viewport) -- these appear as **blank pages** in the PDF

For a 10-page document, if the user is viewing pages 1-3, pages 6-10 (and possibly 4-5) will be depopulated shells with no content, appearing blank in the PDF.

### Hypothesis B: Fragment Positioning Overflow (SECONDARY -- MINOR RISK)

**Verdict: Unlikely primary cause, but could contribute to edge cases.**

The page element has `overflow: hidden` (line 182 of `paintPage.ts`), while the content area has `overflow: visible`. Fragment positions are correctly transformed from page-absolute coordinates to content-area-relative coordinates:

```typescript
// applyFragmentStyles in paintPage.ts
element.style.left = `${fragment.x - margins.left}px`;
element.style.top = `${fragment.y - margins.top}px`;
```

This subtraction is correct for fragments positioned inside the content area. However, the standalone `LayoutPainter` class (used in `packages/core/src/layout-painter/index.ts`) does NOT subtract margins:

```typescript
// LayoutPainter.applyFragmentPosition -- BUG for non-paintPage usage
element.style.left = `${fragment.x}px`;
element.style.top = `${fragment.y}px`;
```

This means the `LayoutPainter` class would position fragments offset by the margin amount inside a content area that already accounts for margins, potentially placing them partially outside the page's `overflow: hidden` boundary. This affects any code path that uses `LayoutPainter` directly (not the React component which uses `paintPages`).

### Hypothesis C: Page Size Mismatch (NOT CONFIRMED)

**Verdict: Unlikely.**

Page sizes are computed consistently from `SectionProperties` via `getPageSize()` and `getMargins()` in `PagedEditor.tsx`, then passed to both the layout engine and the renderer. The layout engine uses the same `pageSize` for pageComposer creation and layout output. No mismatch path was found.

### Hypothesis D: Missing Content Types in Headless/PDF Mode (NOT APPLICABLE)

**Verdict: Not the issue for browser-based PDF generation.**

The headless API (`packages/core/src/headless.ts`) is a Node.js entry point for document manipulation (insert text, apply variables, export DOCX). It does NOT include PDF rendering functionality. The browser-based print/PDF relies entirely on the DOM renderer + `window.print()`.

All block types (paragraph, table, image, textBox) are handled by the `paintPage` function with proper type-specific renderers:

- `paintParagraphFragment()` for paragraphs
- `paintTableFragment()` for tables
- `paintImageFragment()` for images
- `paintTextBoxFragment()` for text boxes
- `paintFragment()` as a fallback placeholder

The placeholder fallback is only used when `blockLookup` is missing, which wouldn't happen in the normal editor flow.

### Hypothesis E: Section Break Creating Spurious Empty Pages (MINOR)

**Verdict: Correct behavior per spec, but could confuse users.**

Section breaks with `evenPage` or `oddPage` types intentionally create blank pages for parity alignment. For example, an `evenPage` break at the end of page 3 creates a blank page 4 so the next section starts on page 5. This is correct per ECMA-376 section 17.6.22 and matches Microsoft Word behavior. These are legitimately blank pages, not a bug.

### Hypothesis F: Floating Content Rendered in Wrong Layer (NOT CONFIRMED)

**Verdict: Unlikely primary cause.**

Floating images and tables are rendered in dedicated layers:

- Floating images get a `layout-floating-images-layer` div with `z-index: 10`
- Floating tables are positioned as regular fragments with `isFloating: true`

Both are rendered inside the content area of the page and would be captured by `cloneNode(true)`. If anything, the `z-index` layering could cause visual ordering issues in print, but not blank pages.

## Proposed Solution

### Fix 1: Force-render all pages before print (Primary Fix)

Before cloning the DOM for print, force-populate all virtualized page shells. The data is already available in `__pageRenderState` on the container element. The fix should:

1. Access the `__pageRenderState` from the pages container
2. Call `populatePageShell()` for every page that has `rendered: false`
3. Then clone the DOM as currently done
4. Optionally: restore the virtualization state after cloning (depopulate pages that were far from viewport) to avoid memory bloat

Since `populatePageShell` and the render state are internal to `paintPage.ts`, a new exported utility function is needed.

### Fix 2: Fix LayoutPainter fragment positioning (Secondary Fix)

Correct the `LayoutPainter.applyFragmentPosition()` method to subtract margins, consistent with `paintPage.ts`. This fixes any code path using the `LayoutPainter` class directly. The content area is already positioned at `(margins.left, margins.top)`, so fragment positions (which include margins from the pageComposer) need the margin subtracted.

### Fix 3: Export a "render all pages for print" utility (API improvement)

Add a public function that renders all pages synchronously into a container, bypassing virtualization entirely. This can be used by:

- The built-in print function
- External integrators who want to generate PDFs via Puppeteer/Playwright
- Server-side rendering scenarios

## Architecture Impact

- **paintPage.ts**: New exported function (`forceRenderAllPages` or `prepareForPrint`)
- **DocxEditor.tsx**: Update `handleDirectPrint` to force-render before cloning
- **LayoutPainter**: Fix `applyFragmentPosition` to subtract margins
- **No changes needed**: layout engine, pageComposer, parsers, serializers, ProseMirror extensions

## Risk Assessment

- **Low risk**: The fix is isolated to the print path and fragment positioning
- **No functional changes** to normal editing, rendering, or document manipulation
- **Performance consideration**: Force-rendering all pages for a large document could temporarily increase memory usage, but this is acceptable for a print operation and matches what Word does
- **Backward compatible**: The new utility is additive; existing API is unchanged
