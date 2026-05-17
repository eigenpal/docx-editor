# Tasks: Fix Blank PDF Pages (Issue #141)

## Task 1: Add `forceRenderAllPages()` to paintPage.ts

**File:** `packages/core/src/layout-painter/paintPage.ts`

1. Add a new exported function `forceRenderAllPages(container: HTMLElement): void`
2. Cast the container to `PageContainer` to access `__pageRenderState`
3. If `__pageRenderState` is undefined, return immediately (no virtualization active)
4. Iterate over `pageDataMap` entries
5. For each entry where `data.rendered === false`, call `populatePageShell(shell, pageDataMap, totalPages, currentOptions)`
6. The function references `populatePageShell` (already defined as a private function in the same file), so no import changes are needed

**Estimated effort:** Small (15-20 lines of code)

## Task 2: Add `restoreVirtualization()` to paintPage.ts

**File:** `packages/core/src/layout-painter/paintPage.ts`

1. Add a new exported function `restoreVirtualization(container: HTMLElement): void`
2. Cast to `PageContainer`, check for `__pageRenderState`
3. Perform the same viewport-distance sweep as the IntersectionObserver callback:
   - For each rendered page, check if it is far from the viewport
   - If far, call `depopulatePageShell(shell, pageDataMap)` to clear its content
4. Use `window.innerHeight * 3` as the "near" threshold (matches existing observer logic)

**Estimated effort:** Small (20-25 lines of code)

## Task 3: Update `handleDirectPrint()` in DocxEditor.tsx

**File:** `packages/react/src/components/DocxEditor.tsx`

1. Add import for `forceRenderAllPages` and `restoreVirtualization` from `@eigenpal/docx-editor-core/layout-painter/paintPage`
2. In `handleDirectPrint()`, insert `forceRenderAllPages(pagesEl as HTMLElement)` before the `cloneNode(true)` call
3. After the clone and print window setup, add `requestAnimationFrame(() => restoreVirtualization(pagesEl as HTMLElement))` to defer cleanup
4. Ensure the function handles the case where `forceRenderAllPages` is a no-op (documents with fewer than 8 pages)

**Estimated effort:** Small (5 lines of new code + 1 import change)

## Task 4: Fix `LayoutPainter.applyFragmentPosition()` margin subtraction

**File:** `packages/core/src/layout-painter/index.ts`

1. Update `applyFragmentPosition()` signature to accept `page: Page` parameter
2. Subtract `page.margins.left` from `fragment.x` and `page.margins.top` from `fragment.y`
3. Update the call site in `paintPageWithLookup()` to pass `page`
4. Import `Page` type if not already imported

**Estimated effort:** Small (5 lines changed)

## Task 5: Re-export new functions from layout-painter barrel

**File:** `packages/core/src/layout-painter/index.ts`

1. Add `forceRenderAllPages` and `restoreVirtualization` to the re-exports from `./paintPage`

**Estimated effort:** Trivial (1-2 lines)

## Task 6: Add E2E test for print with virtualized pages

**File:** `e2e/tests/print-pdf.spec.ts` (new file)

1. Create a test that loads a DOCX document with 10+ pages
2. Trigger print via the File menu or keyboard shortcut (Ctrl+P)
3. Verify that all pages have content (no blank pages) before print is triggered
4. Alternatively, test the `forceRenderAllPages()` function directly:
   - Load a 10+ page document
   - Scroll to page 1 (pages 6+ should be depopulated)
   - Call `forceRenderAllPages()` on the pages container
   - Verify all page shells now have content (innerHTML.length > 0)
   - Call `restoreVirtualization()`
   - Verify far-from-viewport pages are depopulated again

**Note:** Testing actual PDF output is hard in E2E. The test should verify that all page DOM elements have content before the clone step.

**Estimated effort:** Medium (40-60 lines of test code)

## Task 7: Add unit test for `forceRenderAllPages()`

**File:** `packages/core/src/layout-painter/paintPage.test.ts` (new or existing)

1. Create a mock container with `__pageRenderState` containing some rendered and some unrendered pages
2. Call `forceRenderAllPages()` and verify all pages become rendered
3. Test edge cases:
   - Container without `__pageRenderState` (no-op)
   - All pages already rendered (no-op)
   - Single unrendered page in the middle

**Estimated effort:** Medium (30-40 lines)

## Task 8: TypeCheck and verify

Run `bun run typecheck` to ensure no type errors are introduced.

**Estimated effort:** Trivial

## Task 9: Visual verification in Chrome

1. Open the editor with a 10+ page document
2. Trigger print via File > Print
3. Verify all pages appear with content in the print preview / PDF
4. Verify the editor returns to efficient virtualization state after print

**Estimated effort:** Small (manual testing)

---

## Priority Order

1. **Task 1** (forceRenderAllPages) -- core fix
2. **Task 3** (update handleDirectPrint) -- integrate the fix
3. **Task 2** (restoreVirtualization) -- cleanup after print
4. **Task 5** (re-export) -- make functions accessible
5. **Task 4** (LayoutPainter fix) -- secondary fix
6. **Task 8** (typecheck) -- verify no regressions
7. **Task 9** (visual verification) -- manual smoke test
8. **Task 6** (E2E test) -- automated regression test
9. **Task 7** (unit test) -- additional coverage

## Verification Commands

```bash
# Quick typecheck
bun run typecheck

# Run relevant E2E tests (if print test exists)
npx playwright test tests/print-pdf.spec.ts --timeout=30000

# Run general rendering regression tests
npx playwright test tests/demo-docx.spec.ts --timeout=30000 --workers=4

# Full suite (final validation only)
bun run typecheck && npx playwright test --timeout=60000 --workers=4
```
