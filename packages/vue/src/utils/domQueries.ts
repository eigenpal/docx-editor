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
import { collectBodySpans, resolveDomPosition } from '@eigenpal/docx-editor-core/layout-bridge';
import { findWordBoundaries } from '@eigenpal/docx-editor-core/utils';

/**
 * Find the body PM span containing `pmPos`. Scoped to body spans (which
 * carry both docFrom and docTo) so HF runs in the separate PM document
 * don't mis-resolve double-/triple-click selection.
 */
export function findElementAtPosition(container: HTMLElement, pmPos: number): HTMLElement | null {
  const els = collectBodySpans(container);
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
  let targetEl: HTMLElement | null = null;
  for (const el of collectBodySpans(pagesContainer)) {
    const start = Number(el.dataset.docFrom);
    const end = Number(el.dataset.docTo);
    if (Number.isFinite(start) && Number.isFinite(end) && pmPos >= start && pmPos <= end) {
      targetEl = el;
      break;
    }
  }
  if (!targetEl) {
    targetEl = pagesContainer.querySelector<HTMLElement>(`[data-doc-from="${pmPos}"]`);
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
  setPmSelection: (from: number, to: number) => void
): void {
  if (!pagesContainer) return;
  const el = findElementAtPosition(pagesContainer, pos);
  if (!el) return;
  const text = el.textContent || '';
  const docFrom = Number(el.dataset.docFrom) || 0;
  const offset = pos - docFrom;
  const [start, end] = findWordBoundaries(text, offset);
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
  setPmSelection: (from: number, to: number) => void
): void {
  if (!pagesContainer) return;
  const el = findElementAtPosition(pagesContainer, pos);
  if (!el) return;
  const paragraph = el.closest('.layout-paragraph') as HTMLElement | null;
  if (!paragraph) return;
  const docFrom = Number(paragraph.dataset.docFrom);
  const docTo = Number(paragraph.dataset.docTo);
  if (!isNaN(docFrom) && !isNaN(docTo) && docFrom < docTo) {
    setPmSelection(docFrom, docTo);
  }
}
