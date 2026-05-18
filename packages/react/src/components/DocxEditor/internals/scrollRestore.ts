/**
 * Scroll-restore helpers for the layout pipeline.
 *
 * Re-painting the visible pages tears down DOM and rebuilds it from
 * scratch. Without restore, the user's scrollTop would snap to wherever
 * the new content lands. These helpers capture an anchor *before* the
 * re-paint and re-align scrollTop *after*, choosing between three
 * strategies:
 *
 *   - **Snapshot** (incremental re-paints): restore the exact pre-paint
 *     scrollTop. Used when the new layout's scrollHeight is similar to
 *     the old one's.
 *   - **DOM anchor** (non-incremental, anchor still painted): find the
 *     PM-anchored element under the cursor, measure its new offset, and
 *     shift scrollTop by the delta. Keeps the cursor visually pinned
 *     across page-break inserts / deletes that re-flow content.
 *   - **Ratio fallback** (no anchor available): preserve the relative
 *     scroll position (top / scrollHeight ratio). Coarse but always works.
 */

import { findBodyPmAnchor } from '@eigenpal/docx-editor-core/layout-bridge';
import type { RenderPagesUpdateKind } from '@eigenpal/docx-editor-core/layout-painter';

import { findPaintedPmStartAtOrBefore } from './scrollUtils';

export interface PendingScrollRestore {
  renderKind: RenderPagesUpdateKind;
  ratio: number;
  scrollTopSnapshot: number | null;
  domAnchorPmStart: number | null;
  domAnchorOffsetInScroller: number;
}

export interface ScrollAnchor {
  /** scrollTop / maxScroll captured pre-paint. Used as the ratio-fallback. */
  scrollRestoreRatioPre: number;
  /** PM-anchor position closest to the selection head, if a painted anchor exists. */
  domAnchorPmStart: number | null;
  /** Pre-paint pixel offset of that anchor relative to the scroll container. */
  domAnchorOffsetInScroller: number;
}

/**
 * Capture pre-paint scroll geometry. Also installs `overflow-anchor: none`
 * on the scroller (one-time) to opt out of the browser's own anchoring,
 * which would fight our manual restore.
 */
export function captureScrollAnchor(
  pagesEl: HTMLElement,
  scrollParent: HTMLElement,
  headPos: number
): ScrollAnchor {
  if (!scrollParent.style.overflowAnchor) {
    scrollParent.style.setProperty('overflow-anchor', 'none');
  }
  const maxBefore = Math.max(1, scrollParent.scrollHeight - scrollParent.clientHeight);
  const scrollRestoreRatioPre = scrollParent.scrollTop / maxBefore;

  let domAnchorPmStart = findPaintedPmStartAtOrBefore(pagesEl, headPos);
  let domAnchorOffsetInScroller = 0;
  if (domAnchorPmStart != null) {
    const anchorEl = findBodyPmAnchor(pagesEl, domAnchorPmStart);
    if (anchorEl) {
      const ar = anchorEl.getBoundingClientRect();
      const sr = scrollParent.getBoundingClientRect();
      domAnchorOffsetInScroller = ar.top - sr.top;
    } else {
      domAnchorPmStart = null;
    }
  }
  return { scrollRestoreRatioPre, domAnchorPmStart, domAnchorOffsetInScroller };
}

/**
 * Build the pending-restore payload that will be consumed by the
 * post-paint useLayoutEffect. Incremental re-paints carry an explicit
 * scrollTopSnapshot; full re-paints rely on the DOM anchor + ratio.
 */
export function buildPendingScrollRestore(
  paintPagesKind: RenderPagesUpdateKind,
  scrollParent: HTMLElement,
  anchor: ScrollAnchor
): PendingScrollRestore {
  let ratio = anchor.scrollRestoreRatioPre;
  if (paintPagesKind === 'incremental') {
    const maxPost = Math.max(1, scrollParent.scrollHeight - scrollParent.clientHeight);
    ratio = scrollParent.scrollTop / maxPost;
  }
  const scrollTopSnapshot = paintPagesKind === 'incremental' ? scrollParent.scrollTop : null;
  return {
    renderKind: paintPagesKind,
    ratio,
    scrollTopSnapshot,
    domAnchorPmStart: anchor.domAnchorPmStart,
    domAnchorOffsetInScroller: anchor.domAnchorOffsetInScroller,
  };
}

/**
 * Apply a captured pending-restore against the post-paint DOM. Returns
 * silently if `scrollParent` has detached (caller covers cleanup).
 */
export function applyScrollRestore(
  pending: PendingScrollRestore,
  pagesEl: HTMLElement,
  scrollParent: HTMLElement
): void {
  const { renderKind, ratio, scrollTopSnapshot, domAnchorPmStart, domAnchorOffsetInScroller } =
    pending;

  // Strategy 1: incremental snapshot — exact pre-paint scrollTop.
  if (renderKind === 'incremental' && scrollTopSnapshot != null) {
    const maxAfter = Math.max(1, scrollParent.scrollHeight - scrollParent.clientHeight);
    scrollParent.scrollTop = Math.min(Math.max(0, scrollTopSnapshot), maxAfter);
    return;
  }

  // Strategy 2: DOM anchor — find the same PM anchor in the new paint and shift by delta.
  if (renderKind !== 'incremental' && domAnchorPmStart != null) {
    const el2 = findBodyPmAnchor(pagesEl, domAnchorPmStart);
    if (el2) {
      const sr = scrollParent.getBoundingClientRect();
      const newOffset = el2.getBoundingClientRect().top - sr.top;
      scrollParent.scrollTop += domAnchorOffsetInScroller - newOffset;
      return;
    }
  }

  // Strategy 3: ratio fallback.
  const maxAfter = Math.max(1, scrollParent.scrollHeight - scrollParent.clientHeight);
  scrollParent.scrollTop = ratio * maxAfter;
}

/**
 * Re-clamp scroll when a second layout pass runs before the post-paint
 * useLayoutEffect consumes the pending snapshot. Without this, the
 * second pass would overwrite the snapshot with its own and the first
 * pass's exact scrollTop would be lost.
 *
 * `onlyIfSnapshotJustWritten` gates the re-clamp on snapshot age — the
 * 32ms threshold catches the "second pass runs before the next frame"
 * case without re-clamping every time the function is called.
 */
export function reclampIncrementalSnapshot(
  pending: PendingScrollRestore | null,
  scrollParent: HTMLElement | null,
  snapshotAgeMs: number,
  onlyIfSnapshotJustWritten: boolean
): void {
  if (pending?.renderKind !== 'incremental' || pending.scrollTopSnapshot == null) return;
  if (onlyIfSnapshotJustWritten && snapshotAgeMs > 32) return;
  if (!scrollParent?.isConnected) return;
  const max = Math.max(1, scrollParent.scrollHeight - scrollParent.clientHeight);
  const target = Math.min(Math.max(0, pending.scrollTopSnapshot), max);
  if (Math.abs(scrollParent.scrollTop - target) > 0.5) {
    scrollParent.scrollTop = target;
  }
}
