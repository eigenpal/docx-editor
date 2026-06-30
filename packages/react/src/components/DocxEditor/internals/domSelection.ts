/**
 * DOM-based selection / caret helpers for PagedEditor.
 *
 * The core DOM walks (`getCaretPositionFromDom` / `readSelectionGeometry`)
 * live in `@eigenpal/docx-editor-core/flow-model` and are shared with the
 * Vue adapter. These thin React wrappers resolve the selection-overlay rect,
 * call the core walk, then divide by `zoom` so the result lands in the
 * React overlay's own (unscaled-but-CSS-scaled) coordinate space. React's
 * overlay sits OUTSIDE the scroll container, so — unlike Vue — it does not add
 * scrollTop/scrollLeft (intentional divergence, #670).
 *
 * `applyCellSelectionHighlight` is re-exported from core (shared with Vue).
 */

import {
  getCaretPositionFromDom,
  readSelectionGeometry,
  type CaretPosition,
  type SelectionBox,
} from '@eigenpal/docx-editor-core/flow-model';

export { applyCellSelectionHighlight } from '@eigenpal/docx-editor-core/flow-model';

/**
 * Resolve a caret position by measuring the rendered DOM. Delegates the walk
 * to core, then converts overlay-space pixels into the React overlay's scaled
 * coordinate space (divide by zoom). Returns `null` when the overlay isn't
 * mounted or the position falls outside any painted run.
 */
export function getCaretFromDom(
  pagesContainer: HTMLElement,
  pmPos: number,
  currentZoom: number
): CaretPosition | null {
  const overlay = pagesContainer.parentElement?.querySelector('[data-testid="selection-overlay"]');
  if (!overlay) return null;
  const overlayRect = overlay.getBoundingClientRect();
  const caret = getCaretPositionFromDom(pagesContainer, pmPos, overlayRect, currentZoom);
  if (!caret) return null;
  return {
    // x/y are screen-space deltas → divide by zoom. height is already returned
    // in layout px by getCaretPositionFromDom (#928), so it passes through.
    x: caret.x / currentZoom,
    y: caret.y / currentZoom,
    height: caret.height,
    pageIndex: caret.pageIndex,
  };
}

/**
 * Build SelectionBox[] for a range [from, to) via the core DOM walk, then
 * convert overlay-space pixels into the React overlay's scaled coordinate
 * space. Returns `[]` when no painted spans overlap the range (caller falls
 * back to layout-based rectsForSelection).
 */
export function computeSelectionGeometryFromDom(
  pagesContainer: HTMLElement,
  overlayRect: DOMRect,
  from: number,
  to: number,
  zoom: number
): SelectionBox[] {
  const rects = readSelectionGeometry(pagesContainer, from, to, overlayRect);
  return rects.map((rect) => ({
    x: rect.x / zoom,
    y: rect.y / zoom,
    width: rect.width / zoom,
    height: rect.height / zoom,
    pageIndex: rect.pageIndex,
  }));
}
