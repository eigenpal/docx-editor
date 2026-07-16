/**
 * DOM-side hit-test and scroll helpers for the Vue editor — find the
 * painted PM span containing a position, scroll a position into view,
 * resolve a click coordinate back to a PM position, and the
 * double-/triple-click word/paragraph selection helpers.
 *
 * Every function takes containers as parameters; nothing closes over a
 * Vue ref. The selection helpers take a `setPmSelection` callback so the
 * caller controls how the resulting range gets dispatched to PM.
 */

import type { EditorView } from 'prosemirror-view';
import {
  collectBodySpans,
  findBodyPmAnchor,
  resolveDomPosition,
} from '@docx-editor.dev/core/flow-model';
import { findWordBoundariesForPointer } from '@docx-editor.dev/core/utils';

/**
 * Resolve the painted header/footer instance nearest the viewport center — the
 * one the user is editing. The same HF is painted on every page (shared
 * `r:id`), so the chrome outline must track the active page rather than snap to
 * page one's copy (mirrors core's `getHfDomSnapshot` host pick; #691).
 */
export function nearestHfHostEl(position: 'header' | 'footer'): HTMLElement | null {
  const hosts = window.document.querySelectorAll<HTMLElement>(`.layout-page-${position}`);
  if (hosts.length === 0) return null;
  const vpCenter = window.innerHeight / 2;
  let host = hosts[0];
  let bestDist = Infinity;
  for (const h of Array.from(hosts)) {
    const r = h.getBoundingClientRect();
    const dist = Math.abs((r.top + r.bottom) / 2 - vpCenter);
    if (dist < bestDist) {
      bestDist = dist;
      host = h;
    }
  }
  return host;
}

/**
 * Find the painted span containing `pmPos`. By default scoped to body spans
 * (which carry both docFrom and docTo) so HF runs in the separate PM document
 * don't mis-resolve double-/triple-click selection. When `hfSection` is set
 * (the user is editing a header/footer), scope to that section's painted host
 * instead — the HF spans live in `.layout-page-header` / `.layout-page-footer`
 * and carry PM positions from the HF document, so resolving against body spans
 * would compute word/paragraph bounds from the wrong text (#691).
 */
export function findElementAtPosition(
  container: HTMLElement,
  pmPos: number,
  hfSection?: 'header' | 'footer'
): HTMLElement | null {
  const els = hfSection
    ? // The same HF doc is painted on every page; the first host's spans share
      // the HF PM coord space, so one host suffices.
      Array.from(
        container.querySelectorAll<HTMLElement>(
          `.layout-page-${hfSection} span[data-doc-from][data-doc-to]`
        )
      )
    : collectBodySpans(container);
  for (const el of els) {
    const start = Number(el.dataset.docFrom);
    const end = Number(el.dataset.docTo);
    if (!isNaN(start) && !isNaN(end) && pmPos >= start && pmPos <= end) {
      return el;
    }
  }
  return null;
}

/**
 * Smooth-scroll the viewport so the painted element at `pmPos` is
 * visible (48px top padding). Falls back to a CSS attribute selector
 * when no body span carries pmPos in its [start,end] range.
 */
export function scrollVisiblePositionIntoView(
  pagesContainer: HTMLElement | null,
  viewport: HTMLElement | null,
  pmPos: number
): void {
  if (!pagesContainer || !viewport) return;
  // Resolve the painted element the same way the React paged-scroll API does:
  // an exact, body-scoped `data-doc-from` anchor first (paragraph elements,
  // including headings, carry one), then the run-span [start,end] range. A
  // heading's pmPos is the paragraph node position, which only the anchor
  // match catches — the span loop alone would miss it (#930). The old
  // unscoped `[data-doc-from]` fallback is dropped: it could latch onto a
  // header/footer element sharing the same PM position.
  let targetEl: HTMLElement | null = findBodyPmAnchor(pagesContainer, pmPos);
  if (!targetEl) {
    for (const el of collectBodySpans(pagesContainer)) {
      const start = Number(el.dataset.docFrom);
      const end = Number(el.dataset.docTo);
      if (Number.isFinite(start) && Number.isFinite(end) && pmPos >= start && pmPos <= end) {
        targetEl = el;
        break;
      }
    }
  }
  if (!targetEl) return;
  const viewportRect = viewport.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();
  viewport.scrollTo({
    top: targetRect.top - viewportRect.top + viewport.scrollTop - 48,
    behavior: 'smooth',
  });
}

/**
 * Resolve a viewport-space click coordinate to a PM document position,
 * clamped to `doc.content.size`.
 */
export function resolvePos(
  pagesContainer: HTMLElement | null,
  view: EditorView | null,
  clientX: number,
  clientY: number
): number | null {
  if (!pagesContainer || !view) return null;
  const pos = resolveDomPosition(pagesContainer, clientX, clientY, 1);
  if (pos === null || pos < 0) return null;
  return Math.min(pos, view.state.doc.content.size);
}

/**
 * Double-click word selection — expand `pos` to its word bounds and
 * hand the resulting range to `setPmSelection`.
 */
export function selectWord(
  pagesContainer: HTMLElement | null,
  pos: number,
  setPmSelection: (from: number, to: number) => void,
  hfSection?: 'header' | 'footer',
  view?: EditorView | null
): void {
  if (view) {
    const $pos = view.state.doc.resolve(pos);
    const parent = $pos.parent;
    if (parent.isTextblock) {
      const text = parent.textBetween(0, parent.content.size, undefined, ' ');
      const [start, end] = findWordBoundariesForPointer(text, $pos.parentOffset);
      const from = $pos.start() + start;
      const to = $pos.start() + end;
      if (from < to) setPmSelection(from, to);
      return;
    }
  }

  if (!pagesContainer) return;
  const el = findElementAtPosition(pagesContainer, pos, hfSection);
  if (!el) return;
  const text = el.textContent || '';
  const docFrom = Number(el.dataset.docFrom) || 0;
  const offset = pos - docFrom;
  const [start, end] = findWordBoundariesForPointer(text, offset);
  const from = docFrom + start;
  const to = docFrom + end;
  if (from < to) {
    setPmSelection(from, to);
  }
}

/**
 * Triple-click paragraph selection — expand `pos` to the enclosing
 * `.layout-paragraph` element's PM range.
 */
export function selectParagraph(
  pagesContainer: HTMLElement | null,
  pos: number,
  setPmSelection: (from: number, to: number) => void,
  hfSection?: 'header' | 'footer'
): void {
  if (!pagesContainer) return;
  const el = findElementAtPosition(pagesContainer, pos, hfSection);
  if (!el) return;
  const paragraph = el.closest('.layout-paragraph') as HTMLElement | null;
  if (!paragraph) return;
  const docFrom = Number(paragraph.dataset.docFrom);
  const docTo = Number(paragraph.dataset.docTo);
  if (!isNaN(docFrom) && !isNaN(docTo) && docFrom < docTo) {
    setPmSelection(docFrom, docTo);
  }
}
