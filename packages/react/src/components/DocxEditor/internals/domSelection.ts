/**
 * DOM-based selection / caret helpers for PagedEditor.
 *
 * Layout painter renders pages as static DOM with `data-doc-from` /
 * `data-doc-to` attributes. These helpers walk that DOM to translate PM
 * positions back to pixel-space caret + selection geometry, and to apply
 * the visual cell-selection highlight class onto rendered table cells.
 */

import type { EditorState } from 'prosemirror-state';
import {
  findBodyEmptyRuns,
  collectBodySpans,
  type CaretPosition,
  type SelectionBox,
} from '@eigenpal/docx-editor-core/layout-bridge';

/**
 * Resolve a caret position by measuring the rendered DOM rather than
 * recomputing it from layout geometry. Walks `[data-doc-from/-pm-end]`
 * spans inside `pagesContainer` to find the run containing `pmPos`, then
 * creates a zero-length DOM Range at the character offset to read the
 * exact pixel position.
 *
 * Returns `null` when the position falls outside any painted run (caller
 * falls back to layout-based caret math).
 */
export function getCaretFromDom(
  pagesContainer: HTMLElement,
  pmPos: number,
  currentZoom: number
): CaretPosition | null {
  const overlay = pagesContainer.parentElement?.querySelector('[data-testid="selection-overlay"]');
  if (!overlay) return null;

  const overlayRect = overlay.getBoundingClientRect();
  const spans = collectBodySpans(pagesContainer);

  for (const spanEl of spans) {
    const docFrom = Number(spanEl.dataset.docFrom);
    const docTo = Number(spanEl.dataset.docTo);

    // Tab spans use exclusive end — pos at docTo belongs to the next run.
    if (spanEl.classList.contains('layout-run-tab')) {
      if (pmPos >= docFrom && pmPos < docTo) {
        const spanRect = spanEl.getBoundingClientRect();
        const pageEl = spanEl.closest('.layout-page');
        const pageIndex = pageEl ? Number((pageEl as HTMLElement).dataset.pageNumber) - 1 : 0;
        const lineEl = spanEl.closest('.layout-line');
        const lineHeight = lineEl ? (lineEl as HTMLElement).offsetHeight : 16;
        return {
          x: (spanRect.left - overlayRect.left) / currentZoom,
          y: (spanRect.top - overlayRect.top) / currentZoom,
          height: lineHeight,
          pageIndex,
        };
      }
      continue;
    }

    if (pmPos >= docFrom && pmPos <= docTo && spanEl.firstChild?.nodeType === Node.TEXT_NODE) {
      const textNode = spanEl.firstChild as Text;
      const charIndex = Math.min(pmPos - docFrom, textNode.length);

      const ownerDoc = spanEl.ownerDocument;
      if (!ownerDoc) continue;
      const range = ownerDoc.createRange();
      range.setStart(textNode, charIndex);
      range.setEnd(textNode, charIndex);

      const rangeRect = range.getBoundingClientRect();
      const pageEl = spanEl.closest('.layout-page');
      const pageIndex = pageEl ? Number((pageEl as HTMLElement).dataset.pageNumber) - 1 : 0;
      const lineEl = spanEl.closest('.layout-line');
      const lineHeight = lineEl ? (lineEl as HTMLElement).offsetHeight : 16;

      return {
        x: (rangeRect.left - overlayRect.left) / currentZoom,
        y: (rangeRect.top - overlayRect.top) / currentZoom,
        height: lineHeight,
        pageIndex,
      };
    }
  }

  // Fallback: empty paragraphs have empty runs but no span text node.
  const emptyRuns = findBodyEmptyRuns(pagesContainer);
  for (const emptyRun of emptyRuns) {
    const paragraph = emptyRun.closest('.layout-paragraph') as HTMLElement | null;
    if (!paragraph) continue;

    const docFrom = Number(paragraph.dataset.docFrom);
    const docTo = Number(paragraph.dataset.docTo);

    if (pmPos >= docFrom && pmPos <= docTo) {
      const runRect = emptyRun.getBoundingClientRect();
      const pageEl = paragraph.closest('.layout-page');
      const pageIndex = pageEl ? Number((pageEl as HTMLElement).dataset.pageNumber) - 1 : 0;
      const lineEl = emptyRun.closest('.layout-line');
      const lineHeight = lineEl ? (lineEl as HTMLElement).offsetHeight : 16;

      return {
        x: (runRect.left - overlayRect.left) / currentZoom,
        y: (runRect.top - overlayRect.top) / currentZoom,
        height: lineHeight,
        pageIndex,
      };
    }
  }

  return null;
}

/**
 * Build SelectionBox[] for a range [from, to) by walking the painted PM
 * spans and using DOM Range.getClientRects() per overlapping span. Handles
 * line wraps (multiple rects per span) and hyperlink-wrapped text nodes.
 *
 * Returns `[]` when no painted spans overlap the range (caller falls back
 * to layout-based rectsForSelection).
 */
export function computeSelectionGeometryFromDom(
  pagesContainer: HTMLElement,
  overlayRect: DOMRect,
  from: number,
  to: number,
  zoom: number
): SelectionBox[] {
  const domRects: SelectionBox[] = [];
  const spans = collectBodySpans(pagesContainer);

  for (const spanEl of spans) {
    const docFrom = Number(spanEl.dataset.docFrom);
    const docTo = Number(spanEl.dataset.docTo);

    if (docTo <= from || docFrom >= to) continue;

    if (spanEl.classList.contains('layout-run-tab')) {
      const spanRect = spanEl.getBoundingClientRect();
      const pageEl = spanEl.closest('.layout-page');
      const pageIndex = pageEl ? Number((pageEl as HTMLElement).dataset.pageNumber) - 1 : 0;
      domRects.push({
        x: (spanRect.left - overlayRect.left) / zoom,
        y: (spanRect.top - overlayRect.top) / zoom,
        width: spanRect.width / zoom,
        height: spanRect.height / zoom,
        pageIndex,
      });
      continue;
    }

    // Text node may be a direct child, or nested inside an <a> for hyperlinks.
    let textNode: Text | null = null;
    if (spanEl.firstChild?.nodeType === Node.TEXT_NODE) {
      textNode = spanEl.firstChild as Text;
    } else if (
      spanEl.firstChild?.nodeType === Node.ELEMENT_NODE &&
      (spanEl.firstChild as HTMLElement).tagName === 'A' &&
      spanEl.firstChild.firstChild?.nodeType === Node.TEXT_NODE
    ) {
      textNode = spanEl.firstChild.firstChild as Text;
    }
    if (!textNode) continue;
    const ownerDoc = spanEl.ownerDocument;
    if (!ownerDoc) continue;

    const startChar = Math.max(0, from - docFrom);
    const endChar = Math.min(textNode.length, to - docFrom);
    if (startChar >= endChar) continue;

    const range = ownerDoc.createRange();
    range.setStart(textNode, startChar);
    range.setEnd(textNode, endChar);

    const clientRects = range.getClientRects();
    for (const rect of Array.from(clientRects)) {
      const pageEl = spanEl.closest('.layout-page');
      const pageIndex = pageEl ? Number((pageEl as HTMLElement).dataset.pageNumber) - 1 : 0;
      domRects.push({
        x: (rect.left - overlayRect.left) / zoom,
        y: (rect.top - overlayRect.top) / zoom,
        width: rect.width / zoom,
        height: rect.height / zoom,
        pageIndex,
      });
    }
  }

  return domRects;
}

/**
 * Apply the `.layout-table-cell-selected` class to painted layout cells
 * matching a CellSelection in the PM state. Clears the class everywhere
 * first so toggling off (or moving to a TextSelection) erases prior
 * highlights.
 *
 * Duck-types CellSelection via `$anchorCell` / `forEachCell` rather than
 * `instanceof` to dodge bundling issues across `prosemirror-tables`
 * copies (the same trick used inline in updateSelectionOverlay).
 */
export function applyCellSelectionHighlight(
  pagesContainer: HTMLElement,
  state: EditorState,
  options: { scope?: 'body' | 'header' | 'footer' } = {}
): void {
  const scope = options.scope ?? 'body';
  // The selector that limits which cells this call can highlight. Header and
  // footer cells live in `.layout-page-header` / `.layout-page-footer`
  // (separate PM docs), body cells in `.layout-page-content`. PM positions
  // overlap across all three docs, so we MUST scope the walk to the matching
  // tree — a footer CellSelection at pos 100 would otherwise also light up a
  // header cell at `data-doc-from="100"` (#671), and a body selection would
  // bleed into both.
  const scopeClass = scope === 'body' ? 'layout-page-content' : `layout-page-${scope}`;
  const scopeSelector = `.${scopeClass} .layout-table-cell`;

  // Only clear highlights inside this scope so the body call doesn't wipe
  // HF highlights (and vice versa), and the header call doesn't wipe the
  // footer's.
  const prevSelected = pagesContainer.querySelectorAll(
    `.${scopeClass} .layout-table-cell-selected`
  );
  for (const el of Array.from(prevSelected)) {
    el.classList.remove('layout-table-cell-selected');
  }

  const sel = state.selection as unknown as {
    $anchorCell?: unknown;
    forEachCell?: (cb: (node: { nodeSize: number }, pos: number) => void) => void;
  };
  const isCellSel = '$anchorCell' in sel && typeof sel.forEachCell === 'function';
  if (!isCellSel || !sel.forEachCell) return;

  const selectedRanges: Array<[number, number]> = [];
  sel.forEachCell((node, pos) => {
    selectedRanges.push([pos, pos + node.nodeSize]);
  });

  const allCells = pagesContainer.querySelectorAll(scopeSelector);
  for (const cellEl of Array.from(allCells)) {
    const htmlEl = cellEl as HTMLElement;
    const docFromAttr = htmlEl.dataset.docFrom;
    if (docFromAttr === undefined) continue;
    const pmPos = Number(docFromAttr);
    for (const [start, end] of selectedRanges) {
      if (pmPos >= start && pmPos < end) {
        htmlEl.classList.add('layout-table-cell-selected');
        break;
      }
    }
  }
}
