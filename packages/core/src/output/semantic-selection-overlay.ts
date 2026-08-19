// The selection the browser cannot draw.
//
// A native selection is a run of characters, so it can highlight a text range and nothing
// else. A rectangle of table cells is not a run of characters — sweeping A1 to B2 selects four
// cells, and asking the DOM to show that would draw a band through every character between the
// first and the last instead.
//
// So it is painted, from the same records everything else is painted from. A pure sink like
// the page painter: geometry in, elements out, nothing measured back.

import type { SemanticLayout } from '../layout/semantic-records.ts';

/** A rectangle in page-content coordinates, on a named page. */
export interface OverlayRect {
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /**
   * Class for THIS rectangle, overriding the layer's default.
   *
   * One layer draws bands that mean different things — every commented range, and the one the
   * caret is in — and splitting them into two layers would stack two absolutely positioned
   * sheets over the pages just to vary a colour.
   */
  readonly className?: string;
  /**
   * WHOSE band this is, as CSS hooks on the rectangle: `data-author`, `data-author-slot`, and
   * `--doc-review-author` set to the colour that author resolves to.
   *
   * The same three the review card carries, and deliberately so — a host restyling one
   * reviewer writes one selector that reaches both the card and the text it annotates. The
   * band's DEFAULT colour does not change with the author (Word keeps every comment yellow);
   * this only makes the author reachable from CSS.
   */
  readonly author?: ReviewRectAuthor;
}

/** The author hooks one overlay rectangle carries. See {@link OverlayRect.author}. */
export interface ReviewRectAuthor {
  readonly name: string;
  readonly slot: number;
  /** Resolved colour — a host declaration when there is one, otherwise the ramp slot. */
  readonly color: string;
}

/**
 * How the selection overlay draws its rectangles over the painted pages.
 *
 * `scale` and `pageOffsetX` must match what the page painter used, or the highlight lands beside
 * the content it describes rather than on it.
 */
export interface SelectionOverlayOptions {
  /** Points to CSS pixels. */
  readonly scale: number;
  /**
   * Per-page horizontal offset the page painter applied, by page index.
   *
   * A document whose pages differ in width centres each one individually, so a page is drawn
   * at an x its record does not carry. Without the same offset here a highlight would sit
   * beside the cells it describes.
   */
  readonly pageOffsetX?: ReadonlyMap<number, number>;
  /**
   * Class for each painted rectangle. Defaults to the cell-selection class, because a cell
   * rectangle was the only thing this layer drew when it was written.
   *
   * A retained TEXT range is drawn here too and must not look like selected cells — one is
   * "these cells are chosen", the other is "your selection is still here while you type in
   * this panel". Same geometry, different meaning, so the caller names the class.
   */
  readonly className?: string;
}

/**
 * Draw a set of rectangles over the pages.
 *
 * The layer is a SIBLING of the pages, never a child: the page painter sweeps anything it did
 * not paint out of its own subtree, and a stray child of a contenteditable is editable content
 * a keystroke could land in.
 */
export function paintSelectionOverlay(
  layer: HTMLElement,
  layout: SemanticLayout,
  rects: readonly OverlayRect[],
  options: SelectionOverlayOptions
): void {
  const document = layer.ownerDocument;
  const scale = options.scale;
  const painted: HTMLElement[] = [];
  for (const rect of rects) {
    const page = layout.pages[rect.pageIndex];
    if (!page) continue;
    const element = document.createElement('div');
    element.className = rect.className ?? options.className ?? 'docx-cell-selection-rect';
    element.style.position = 'absolute';
    // Page-content coordinates to the sheet space the layer is laid out in.
    const offsetX = options.pageOffsetX?.get(rect.pageIndex) ?? 0;
    element.style.left = `${(page.contentBox.x + rect.x + offsetX) * scale}px`;
    element.style.top = `${(page.contentBox.y + rect.y) * scale}px`;
    element.style.width = `${rect.width * scale}px`;
    element.style.height = `${rect.height * scale}px`;
    // Author hooks, when the rect carries them. `setAttribute`/`dataset` with the raw value —
    // never interpolated into markup — because `w:author` is attacker-controlled; the colour
    // is engine-resolved or host-declared, and `setProperty` drops a value it cannot parse.
    if (rect.author) {
      element.dataset.author = rect.author.name;
      element.dataset.authorSlot = String(rect.author.slot);
      element.style.setProperty('--doc-review-author', rect.author.color);
    }
    painted.push(element);
  }
  layer.replaceChildren(...painted);
}
