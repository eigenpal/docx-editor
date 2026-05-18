/**
 * Scroll-and-paint utilities for PagedEditor — center-into-view that
 * survives CSS transforms, a multi-frame paint-settle hook for
 * scroll-restore, and the PM-position lookup that anchors restore after
 * `paintPages` rebuilds the DOM.
 */

import { findBodyPmAnchors } from '@eigenpal/docx-editor-core/layout-bridge';
import type { Layout } from '@eigenpal/docx-editor-core/layout-engine';
import { VIEWPORT_PADDING_TOP } from './styles';

/**
 * Vertically scroll `container` so `el`'s center aligns with the container's visible center.
 * Avoids `element.scrollIntoView()` — it misbehaves when content sits under CSS `transform`
 * (e.g. zoom viewport); see `useVisualLineNavigation` scrollIntoViewIfNeeded comment.
 */
export function scrollElementCenterIntoContainer(
  el: HTMLElement,
  container: HTMLElement,
  behavior: ScrollBehavior
): void {
  const cRect = container.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  const elCenter = eRect.top + eRect.height / 2;
  const cCenter = cRect.top + cRect.height / 2;
  const delta = elCenter - cCenter;
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
  const targetTop = Math.max(0, Math.min(maxScroll, container.scrollTop + delta));
  if (behavior === 'smooth') {
    container.scrollTo({ top: targetTop, behavior: 'smooth' });
  } else {
    container.scrollTop = targetTop;
  }
}

/**
 * Run `fn` after layout/paint has settled (3 nested rAFs). Aborts if `signal`
 * fires before any of the frames runs, and tracks rAF ids so they can be
 * cancelled by the caller. Used for the virtualized-paint settle path in
 * scrollToPositionImpl / scrollToParaIdImpl.
 */
export function runAfterPaint(fn: () => void, signal: AbortSignal): void {
  if (signal.aborted) return;
  const id1 = requestAnimationFrame(() => {
    if (signal.aborted) return;
    const id2 = requestAnimationFrame(() => {
      if (signal.aborted) return;
      const id3 = requestAnimationFrame(() => {
        if (signal.aborted) return;
        fn();
      });
      signal.addEventListener('abort', () => cancelAnimationFrame(id3), { once: true });
    });
    signal.addEventListener('abort', () => cancelAnimationFrame(id2), { once: true });
  });
  signal.addEventListener('abort', () => cancelAnimationFrame(id1), { once: true });
}

/**
 * Largest painted body `[data-doc-from]` value ≤ `pmPos`. Used to anchor scroll
 * restore when `paintPages` rebuilds the DOM. Header/footer anchors are skipped
 * because their PM positions live in a separate document and would mis-resolve.
 */
export function findPaintedPmStartAtOrBefore(pages: HTMLElement, pmPos: number): number | null {
  let best: number | null = null;
  const list = findBodyPmAnchors(pages);
  for (let i = 0; i < list.length; i++) {
    const raw = list[i].dataset.docFrom;
    if (raw == null) continue;
    const p = Number(raw);
    if (Number.isNaN(p)) continue;
    if (p <= pmPos && (best === null || p > best)) best = p;
  }
  return best;
}

/** Min-height of the zoom/viewport wrapper (padding + page stack). Must match JSX `totalHeight`. */
export function viewportMinHeightPx(layout: Layout, pageGap: number): number {
  const n = layout.pages.length;
  const pagesHeight = layout.pages.reduce((sum, page) => sum + page.size.h, 0);
  return pagesHeight + Math.max(0, n - 1) * pageGap + VIEWPORT_PADDING_TOP + 24;
}
