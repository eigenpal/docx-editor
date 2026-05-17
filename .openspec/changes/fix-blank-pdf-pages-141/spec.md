# Technical Specification: Fix Blank PDF Pages (Issue #141)

## Overview

Documents with 8+ pages use page virtualization (IntersectionObserver) to only render pages near the viewport. When the user triggers print/PDF export, the DOM is cloned including empty (depopulated) page shells, causing off-screen pages to appear blank in the PDF.

## File Changes

### 1. `packages/core/src/layout-painter/paintPage.ts`

#### 1.1 New exported function: `forceRenderAllPages()`

Add a function that ensures all page shells in a virtualized container are fully rendered. This is the core fix that the print function will call before cloning the DOM.

**Signature:**

```typescript
export function forceRenderAllPages(container: HTMLElement): void;
```

**Behavior:**

1. Access the `__pageRenderState` from the container (cast to `PageContainer`)
2. If no render state exists (non-virtualized document), return immediately -- all pages are already rendered
3. Iterate over all entries in `pageDataMap`
4. For each entry where `rendered === false`, call `populatePageShell()` with the stored `currentOptions` and `totalPages`
5. This ensures every page shell has full DOM content

**Implementation details:**

- The function accesses the private `PageContainer` interface's `__pageRenderState` property
- It reuses the existing `populatePageShell()` internal function
- No new page shells are created; it only fills existing empty shells
- The function is synchronous (DOM operations are synchronous)

#### 1.2 New exported function: `restoreVirtualization()`

After print completes, optionally depopulate pages that were force-rendered to restore memory-efficient virtualization.

**Signature:**

```typescript
export function restoreVirtualization(container: HTMLElement): void;
```

**Behavior:**

1. Access `__pageRenderState` from the container
2. If no render state, return immediately
3. Trigger the same sweep logic that the IntersectionObserver uses: depopulate pages far from the viewport
4. This is optional but recommended for long documents to avoid keeping 50+ pages in DOM memory

#### 1.3 Alternative: New exported function `renderAllPagesForPrint()`

A higher-level utility that creates a new container with all pages fully rendered, suitable for cloning into a print window. This avoids mutating the live editor DOM.

**Signature:**

```typescript
export function renderAllPagesForPrint(
  pages: Page[],
  options: RenderPageOptions & {
    pageGap?: number;
    footnotesByPage?: Map<number, FootnoteRenderItem[]>;
  }
): HTMLElement;
```

**Behavior:**

1. Create a new detached `div` element
2. Call `paintPage()` for every page (no virtualization)
3. Apply container styles (flex column, gap, etc.)
4. Return the fully-rendered container

**Advantage**: Does not touch the live editor DOM at all. No need to restore virtualization afterward. The print function can use this container directly.

**Trade-off**: Requires access to the `pages` array and render options, which means the print function needs to receive them from the PagedEditor (currently it only reads the DOM).

### 2. `packages/react/src/components/DocxEditor.tsx`

#### 2.1 Update `handleDirectPrint()`

**Current code (lines 2375-2443):**

```typescript
const handleDirectPrint = useCallback(() => {
  const pagesEl = containerRef.current?.querySelector('.paged-editor__pages');
  if (!pagesEl) {
    window.print();
    return;
  }

  const pagesClone = pagesEl.cloneNode(true) as HTMLElement;
  // ... write to print window
}, [onPrint]);
```

**Updated code:**

```typescript
const handleDirectPrint = useCallback(() => {
  const pagesEl = containerRef.current?.querySelector('.paged-editor__pages');
  if (!pagesEl) {
    window.print();
    onPrint?.();
    return;
  }

  // Force-render all virtualized page shells before cloning
  forceRenderAllPages(pagesEl as HTMLElement);

  // Clone pages with all content now present
  const pagesClone = pagesEl.cloneNode(true) as HTMLElement;
  pagesClone.style.cssText = 'display: block; margin: 0; padding: 0;';
  for (const page of Array.from(pagesClone.querySelectorAll('.layout-page'))) {
    const el = page as HTMLElement;
    el.style.boxShadow = 'none';
    el.style.margin = '0';
  }

  // ... rest of print window code unchanged ...

  // Restore virtualization after cloning is done (async, non-blocking)
  requestAnimationFrame(() => {
    restoreVirtualization(pagesEl as HTMLElement);
  });

  onPrint?.();
}, [onPrint]);
```

**Key changes:**

1. Import `forceRenderAllPages` and `restoreVirtualization` from `@eigenpal/docx-editor-core/layout-painter/paintPage`
2. Call `forceRenderAllPages()` before `cloneNode(true)`
3. Call `restoreVirtualization()` after cloning in a `requestAnimationFrame` to defer the cleanup

### 3. `packages/core/src/layout-painter/index.ts`

#### 3.1 Fix `LayoutPainter.applyFragmentPosition()`

**Current code (line 273-281):**

```typescript
private applyFragmentPosition(element: HTMLElement, fragment: Fragment): void {
  element.style.position = 'absolute';
  element.style.left = `${fragment.x}px`;
  element.style.top = `${fragment.y}px`;
  element.style.width = `${fragment.width}px`;
  if ('height' in fragment) {
    element.style.height = `${fragment.height}px`;
  }
}
```

**Updated code:**

```typescript
private applyFragmentPosition(element: HTMLElement, fragment: Fragment, page: Page): void {
  element.style.position = 'absolute';
  // Fragment x/y include page margins from the pageComposer.
  // Content area is already offset by margins, so subtract them
  // for correct content-area-relative positioning.
  element.style.left = `${fragment.x - page.margins.left}px`;
  element.style.top = `${fragment.y - page.margins.top}px`;
  element.style.width = `${fragment.width}px`;
  if ('height' in fragment) {
    element.style.height = `${fragment.height}px`;
  }
}
```

**Also update the call site** in `paintPageWithLookup()` (line 220):

```typescript
// Before:
this.applyFragmentPosition(fragmentEl, fragment);
// After:
this.applyFragmentPosition(fragmentEl, fragment, page);
```

#### 3.2 Re-export new functions

Add re-exports for the new print utility functions:

```typescript
export {
  // ... existing exports ...
  forceRenderAllPages,
  restoreVirtualization,
} from './paintPage';
```

### 4. `packages/react/src/paged-editor/PagedEditor.tsx`

#### 4.1 Expose layout data for alternative print approach

If using the `renderAllPagesForPrint()` approach instead of the force-render approach, add a method to `PagedEditorRef`:

```typescript
export interface PagedEditorRef {
  // ... existing methods ...
  /** Get current layout pages for print rendering. */
  getPrintData(): {
    pages: Page[];
    options: RenderPageOptions;
    footnotesByPage?: Map<number, FootnoteRenderItem[]>;
  } | null;
}
```

This is only needed for the alternative approach and can be deferred.

## Data Flow for Print (After Fix)

```
User clicks Print
  -> handleDirectPrint()
  -> forceRenderAllPages(pagesEl)     // NEW: populate all page shells
     -> for each shell where rendered === false:
        -> populatePageShell(shell, ...)
           -> buildPageRenderArgs(page, totalPages, options)
           -> paintPage(page, context, pageOptions)
           -> append children to shell
           -> data.rendered = true
  -> pagesEl.cloneNode(true)          // Now all pages have content
  -> strip box-shadows, margins
  -> open print window with cloned content
  -> restoreVirtualization(pagesEl)    // NEW: restore memory efficiency
     -> depopulate far-from-viewport pages
  -> window.print() in new window
```

## Edge Cases

### Large documents (50+ pages)

Force-rendering all 50 pages creates significant DOM content temporarily. Mitigation:

- `restoreVirtualization()` cleans up after the clone
- Browser garbage collection handles the print window DOM after it closes
- The print window gets a fresh copy, so the editor's DOM is restored to efficient state

### Documents with exactly 8 pages (threshold boundary)

Documents with exactly `VIRTUALIZATION_THRESHOLD` pages will have virtualization active. The first 5 pages are eagerly rendered, pages 6-8 may or may not be rendered depending on scroll position. The fix handles this correctly since it checks `rendered` status per-page.

### Documents with fewer than 8 pages

No virtualization is used. All pages are eagerly rendered. `forceRenderAllPages()` returns immediately (no `__pageRenderState`). No behavior change.

### Print while scrolling

If the user triggers print during scroll, some pages may be in the process of being populated by the IntersectionObserver. `forceRenderAllPages()` skips pages where `rendered === true`, so already-rendered pages are not re-rendered. The function is synchronous, so it completes before `cloneNode`.

### Concurrent edits during print

The print function runs synchronously in the main thread. No PM transactions can interleave. By the time `cloneNode` runs, the DOM is in a consistent state.

### Images not loaded in force-rendered pages

Pages that were just force-rendered may have `<img>` elements whose images haven't loaded yet. The existing fallback timer in `handleDirectPrint` (1000ms timeout before calling `printWindow.print()`) provides time for images to load. For very large documents with many images, this timeout may need to be increased or replaced with a `Promise.all` on image load events.

## Constants

No new constants are introduced. The existing `VIRTUALIZATION_THRESHOLD = 8` and `VIRTUALIZATION_BUFFER = 2` remain unchanged.

## TypeScript Types

No new types are needed. The `PageContainer` interface (private in `paintPage.ts`) is already defined and has the `__pageRenderState` property. The exported functions only need the `HTMLElement` type in their signatures.

## Dependencies

No new dependencies. All functionality uses existing DOM APIs and the already-imported `paintPage` function.
