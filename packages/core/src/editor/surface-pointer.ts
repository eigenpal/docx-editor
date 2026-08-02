// Pointer gestures over the painted pages.
//
// The surface owns this rather than each host, so React, Vue and a plain page get identical
// behaviour instead of three hand-written pointer handlers that drift.
//
// WHY THE ENGINE CLAIMS THE GESTURE. Left to itself the browser can only place a caret where
// it finds an inline box, and the painted pages are a stack of shrink-to-fit line boxes: the
// left indent, the right margin, the leading between two lines and a cell's padding are all
// outside every box it knows about. Clicks there — which is where people aim when they want
// the start or the end of a line — landed wherever its own fallback chose. Resolving the
// point against the layout records instead answers all of them the way a word processor does,
// and answers them the same way headlessly.
//
// Geometry still comes from ONE place. The only thing measured here is where the pages layer
// sits on screen, which is the one fact the records cannot carry; every position, band and
// clamp comes from `semantic-hit-test.ts`.

import { cellSelectionBetween, type CellSelection } from '../layout/semantic-cell-selection.ts';
import {
  hitTestPage,
  pageAtY,
  type SemanticHit,
  type TableCellAddress,
} from '../layout/semantic-hit-test.ts';
import {
  documentOrder,
  paragraphTextFromLayout,
  wordBoundary,
  type SemanticPosition,
  type SemanticSelection,
} from '../layout/semantic-interaction.ts';
import type { SemanticLayout, TextMeasurer } from '../layout/semantic-records.ts';

/** What the controller needs from the surface it drives. */
export interface PointerHost {
  readonly pagesLayer: HTMLElement;
  readonly container: HTMLElement;
  /**
   * Points to CSS pixels, read per gesture rather than captured.
   *
   * A getter, not a value: a surface that ever rescales in place would otherwise leave this
   * transform silently converting with a stale factor, and every click would be wrong by the
   * ratio between the two.
   */
  scale(): number;
  /**
   * The horizontal offset the painter drew a page at, beyond its record position.
   *
   * Pages of differing width are centred individually, so on a mixed-orientation document a
   * page's painted x is not the x its record carries. The transform has to undo that or every
   * point on such a page resolves shifted.
   */
  pageOffsetX(pageIndex: number): number;
  layout(): SemanticLayout;
  measurer(): TextMeasurer | undefined;
  selection(): SemanticSelection;
  setSelection(next: SemanticSelection): void;
  cellSelection(): CellSelection | null;
  setCellSelection(next: CellSelection | null): void;
  focus(): void;
}

export interface PointerControllerOptions {
  /**
   * `'engine'` resolves points from the layout records; `'native'` binds nothing and leaves
   * the browser's own caret placement in charge.
   *
   * A switch on the primary input path, so a host that hits trouble in a browser this could
   * not be tested in has somewhere to go that is not "downgrade the package".
   */
  readonly mode?: 'engine' | 'native';
}

export interface PointerController {
  /**
   * True while a gesture owns the selection.
   *
   * The surface's `selectionchange` listener reads this: the browser keeps reporting its own
   * idea of the selection during a drag, and adopting those would fight the gesture halfway
   * through it.
   */
  dragging(): boolean;
  destroy(): void;
}

/** How long after a click a second one still counts as a double. */
const MULTI_CLICK_MS = 500;
/** How far it may move and still count — a click, not a tiny drag. */
const MULTI_CLICK_SLOP_PX = 4;
/** How close to the scroller's edge a drag must reach before the view starts following it. */
const AUTO_SCROLL_EDGE_PX = 40;
/** Fastest the view follows, per frame. */
const AUTO_SCROLL_MAX_PX = 12;

type Granularity = 'character' | 'word' | 'paragraph';

interface PositionRange {
  readonly from: SemanticPosition;
  readonly to: SemanticPosition;
}

interface Gesture {
  readonly pointerId: number;
  readonly granularity: Granularity;
  /** What the press itself selected — a caret, a word, or a paragraph. */
  readonly anchorRange: PositionRange;
  /** The cell the press landed in, or null outside a table. */
  readonly anchorCell: TableCellAddress | null;
  /** Set once the drag leaves the cell it started in, and never unset before the release. */
  cellDragging: boolean;
  /** Last client point, so autoscroll can keep extending while the pointer is still. */
  clientX: number;
  clientY: number;
}

export function createPointerController(
  host: PointerHost,
  options: PointerControllerOptions = {}
): PointerController {
  if (options.mode === 'native') {
    return { dragging: () => false, destroy: () => {} };
  }

  const { pagesLayer, container } = host;
  const document = pagesLayer.ownerDocument;
  const view = document.defaultView;

  let gesture: Gesture | null = null;
  /** Cached for the life of one gesture, and dropped whenever the page can have moved. */
  let layerRect: { left: number; top: number } | null = null;
  let clickCount = 0;
  let lastClickAt = 0;
  let lastClickX = 0;
  let lastClickY = 0;
  let autoScrollHandle: number | null = null;

  // ---------------------------------------------------------------------------------
  // Client pixels to model points
  // ---------------------------------------------------------------------------------

  /**
   * The pages layer's own top-left IS the sheet origin — every page is painted at its record
   * position inside it — so one rect read converts a client point for the whole document, and
   * keeps working over a gutter, beside a page, or past the last one.
   */
  function sheetPoint(clientX: number, clientY: number): { x: number; y: number } {
    if (!layerRect) {
      const rect = pagesLayer.getBoundingClientRect();
      layerRect = { left: rect.left, top: rect.top };
    }
    const scale = host.scale() || 1;
    return { x: (clientX - layerRect.left) / scale, y: (clientY - layerRect.top) / scale };
  }

  function resolve(clientX: number, clientY: number): SemanticHit | null {
    const layout = host.layout();
    const sheet = sheetPoint(clientX, clientY);
    const pageIndex = pageAtY(layout, sheet.y);
    const page = layout.pages[pageIndex];
    if (!page) return null;
    const measurer = host.measurer();
    return hitTestPage(
      layout,
      pageIndex,
      {
        x: sheet.x - page.contentBox.x - host.pageOffsetX(pageIndex),
        y: sheet.y - page.contentBox.y,
      },
      measurer ? { measurer } : {}
    );
  }

  // ---------------------------------------------------------------------------------
  // Ordering and granularity
  // ---------------------------------------------------------------------------------

  const orderCache = new WeakMap<SemanticLayout, Map<string, number>>();

  function paragraphRank(layout: SemanticLayout, paragraphId: string): number {
    let index = orderCache.get(layout);
    if (!index) {
      index = new Map(documentOrder(layout).map((id, at) => [id, at]));
      orderCache.set(layout, index);
    }
    return index.get(paragraphId) ?? -1;
  }

  function isBefore(layout: SemanticLayout, a: SemanticPosition, b: SemanticPosition): boolean {
    const rankA = paragraphRank(layout, a.paragraphId);
    const rankB = paragraphRank(layout, b.paragraphId);
    if (rankA !== rankB) return rankA < rankB;
    return a.offset < b.offset;
  }

  const WORD_CHARACTER = /[\p{L}\p{N}_'’]/u;
  const isWordCharacter = (character: string | undefined): boolean =>
    character !== undefined && WORD_CHARACTER.test(character);

  /**
   * The range one press selects, at the granularity the click count asked for.
   *
   * A caret sits BETWEEN characters, so a double-click at a word's edge is ambiguous. Word
   * resolves it by preferring the character to the right and falling back to the one on the
   * left, which is what stops a double-click at the end of a word from selecting the space
   * after it instead of the word itself.
   */
  function rangeAt(
    layout: SemanticLayout,
    position: SemanticPosition,
    granularity: Granularity
  ): PositionRange {
    if (granularity === 'character') return { from: position, to: position };
    const text = paragraphTextFromLayout(layout, position.paragraphId);
    const id = position.paragraphId;
    if (granularity === 'paragraph') {
      return { from: { paragraphId: id, offset: 0 }, to: { paragraphId: id, offset: text.length } };
    }

    const offset = Math.max(0, Math.min(position.offset, text.length));
    let anchor = -1;
    if (isWordCharacter(text[offset])) anchor = offset;
    else if (offset > 0 && isWordCharacter(text[offset - 1])) anchor = offset - 1;

    if (anchor === -1) {
      // Neither side is a word: take the run of whitespace the pointer is in, or the single
      // character it is on, rather than reaching into a word that was not clicked.
      let from = offset;
      let to = offset;
      while (from > 0 && /\s/.test(text[from - 1] ?? '')) from -= 1;
      while (to < text.length && /\s/.test(text[to] ?? '')) to += 1;
      if (from === to && to < text.length) to += 1;
      return { from: { paragraphId: id, offset: from }, to: { paragraphId: id, offset: to } };
    }
    return {
      from: { paragraphId: id, offset: wordBoundary(text, anchor + 1, -1) },
      to: { paragraphId: id, offset: wordBoundary(text, anchor, 1) },
    };
  }

  /** Anchor range plus the range under the pointer, oriented so the head follows the drag. */
  function extend(
    layout: SemanticLayout,
    anchorRange: PositionRange,
    head: SemanticPosition,
    granularity: Granularity
  ): SemanticSelection {
    const headRange = rangeAt(layout, head, granularity);
    return isBefore(layout, headRange.from, anchorRange.from)
      ? { anchor: anchorRange.to, head: headRange.from }
      : { anchor: anchorRange.from, head: headRange.to };
  }

  // ---------------------------------------------------------------------------------
  // Autoscroll
  // ---------------------------------------------------------------------------------

  function scroller(): HTMLElement | null {
    return container.closest('.docx-editor__scroll-container');
  }

  /** How far the view should move this frame, from how deep into the edge zone the drag is. */
  function autoScrollDelta(top: number, bottom: number, clientY: number): number {
    if (clientY < top + AUTO_SCROLL_EDGE_PX) {
      const depth = Math.max(0, top + AUTO_SCROLL_EDGE_PX - clientY);
      return -Math.min(AUTO_SCROLL_MAX_PX, (depth / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_PX);
    }
    if (clientY > bottom - AUTO_SCROLL_EDGE_PX) {
      const depth = Math.max(0, clientY - (bottom - AUTO_SCROLL_EDGE_PX));
      return Math.min(AUTO_SCROLL_MAX_PX, (depth / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_PX);
    }
    return 0;
  }

  function stopAutoScroll(): void {
    if (autoScrollHandle === null) return;
    view?.cancelAnimationFrame(autoScrollHandle);
    autoScrollHandle = null;
  }

  /**
   * Follow the drag past the edge of the view.
   *
   * The selection is re-extended at the LAST pointer position every frame, not only when the
   * pointer moves: holding still at the bottom of the window has to keep selecting, and a
   * stationary pointer produces no events at all.
   */
  function tickAutoScroll(): void {
    autoScrollHandle = null;
    const active = gesture;
    const element = scroller();
    if (!active || !element || !view) return;
    const rect = element.getBoundingClientRect();
    const delta = autoScrollDelta(rect.top, rect.bottom, active.clientY);
    if (delta === 0) return;
    element.scrollTop += delta;
    // The layer moved under the pointer, so the cached transform is stale by exactly the
    // amount just scrolled. Drop it rather than correcting it: one rect read is cheaper than
    // a second source of truth for where the pages are.
    layerRect = null;
    extendTo(active.clientX, active.clientY);
    autoScrollHandle = view.requestAnimationFrame(tickAutoScroll);
  }

  function maybeAutoScroll(): void {
    if (autoScrollHandle !== null || !view || !gesture) return;
    const element = scroller();
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (autoScrollDelta(rect.top, rect.bottom, gesture.clientY) === 0) return;
    autoScrollHandle = view.requestAnimationFrame(tickAutoScroll);
  }

  // ---------------------------------------------------------------------------------
  // Gesture
  // ---------------------------------------------------------------------------------

  function extendTo(clientX: number, clientY: number): void {
    const active = gesture;
    if (!active) return;
    const hit = resolve(clientX, clientY);
    // An unresolvable move is a no-op, never a collapse: a pointer that has left the document
    // should leave the selection where it last was rather than throwing it away.
    if (!hit) return;
    if (extendCells(active, hit)) return;
    host.setSelection(extend(host.layout(), active.anchorRange, hit.position, active.granularity));
  }

  /**
   * Promote a drag that has crossed into another cell, and keep it promoted.
   *
   * Leaving a cell is the whole signal — no pixel threshold, because a threshold would make
   * the same gesture mean different things depending on how the cells happen to be sized. Once
   * promoted it STAYS promoted for the rest of the drag: dragging back into the cell it
   * started in gives a one-cell rectangle, not a text selection, so the gesture cannot flip
   * type under the pointer.
   */
  function extendCells(active: Gesture, hit: SemanticHit): boolean {
    const anchorCell = active.anchorCell;
    if (!anchorCell || !hit.cell) return false;
    if (hit.cell.tableId !== anchorCell.tableId) return false;
    if (!active.cellDragging && hit.cell.cellId === anchorCell.cellId) return false;
    const next = cellSelectionBetween(host.layout(), anchorCell, hit.cell);
    if (!next) return false;
    active.cellDragging = true;
    host.setCellSelection(next);
    return true;
  }

  function countClick(event: PointerEvent): number {
    const now = event.timeStamp || Date.now();
    const near =
      Math.abs(event.clientX - lastClickX) <= MULTI_CLICK_SLOP_PX &&
      Math.abs(event.clientY - lastClickY) <= MULTI_CLICK_SLOP_PX;
    // Counted here rather than read off `detail`, which browsers disagree about on
    // `pointerdown` — some report the click count, some report zero.
    clickCount = near && now - lastClickAt <= MULTI_CLICK_MS ? clickCount + 1 : 1;
    lastClickAt = now;
    lastClickX = event.clientX;
    lastClickY = event.clientY;
    return clickCount;
  }

  const GRANULARITIES: readonly Granularity[] = ['character', 'word', 'paragraph'];

  const onPointerDown = (event: PointerEvent): void => {
    // Anything but the primary button keeps its native behaviour: a right-click must reach the
    // context menu with the existing selection intact, not move the caret out from under it.
    if (event.button !== 0) return;
    // Page furniture is not editable and not selectable. A click there is a no-op — taking it
    // would jump the caret to the top of the body, which reads as the click having gone wrong.
    if ((event.target as Element | null)?.closest('[data-docx-hf]')) return;
    // Touch keeps the browser's own panning: claiming the gesture would stop the page
    // scrolling under a finger, which is a much worse trade than a less exact caret.
    if (event.pointerType === 'touch') return;

    layerRect = null;
    const hit = resolve(event.clientX, event.clientY);
    if (!hit) return;

    event.preventDefault();
    // Preventing the default cancels the browser's own focus transfer, and the surface only
    // writes the caret into the DOM when it owns the selection — so focus has to be taken
    // explicitly, and BEFORE the selection is set.
    host.focus();

    const layout = host.layout();
    const count = countClick(event);
    const granularity = GRANULARITIES[(count - 1) % GRANULARITIES.length]!;

    if (event.shiftKey && granularity === 'character') {
      // Extend from the anchor the existing selection already has, so shift-clicking on the
      // far side of a range pivots around the end the user did not place.
      const current = host.selection();
      gesture = {
        pointerId: event.pointerId,
        granularity,
        anchorRange: { from: current.anchor, to: current.anchor },
        anchorCell: hit.cell,
        cellDragging: false,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      host.setSelection({ anchor: current.anchor, head: hit.position });
    } else {
      const anchorRange = rangeAt(layout, hit.position, granularity);
      gesture = {
        pointerId: event.pointerId,
        granularity,
        anchorRange,
        anchorCell: hit.cell,
        cellDragging: false,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      host.setSelection({ anchor: anchorRange.from, head: anchorRange.to });
    }

    try {
      pagesLayer.setPointerCapture(event.pointerId);
    } catch {
      // Capture is an optimisation, not a requirement — the document-level listeners below
      // already see the rest of the gesture wherever the pointer goes.
    }
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const active = gesture;
    if (!active || event.pointerId !== active.pointerId) return;
    event.preventDefault();
    active.clientX = event.clientX;
    active.clientY = event.clientY;
    extendTo(event.clientX, event.clientY);
    maybeAutoScroll();
  };

  const onPointerUp = (event: PointerEvent): void => {
    const active = gesture;
    if (!active || event.pointerId !== active.pointerId) return;
    endGesture();
    try {
      pagesLayer.releasePointerCapture(active.pointerId);
    } catch {
      // Already released, or never captured.
    }
    // One last assertion of the model's selection over whatever the browser settled on while
    // the gesture was running, now that the drag guard has been lifted. A rectangle has to be
    // re-asserted as a rectangle, or writing the plain selection would collapse it back to
    // the text range it stands in for.
    const cells = host.cellSelection();
    if (cells) host.setCellSelection(cells);
    else host.setSelection(host.selection());
  };

  function endGesture(): void {
    gesture = null;
    layerRect = null;
    stopAutoScroll();
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerUp);
  }

  // A scroll moves the pages under the pointer, so anything cached about where they are is
  // stale. Passive: this only invalidates, it never blocks the scroll.
  const onScroll = (): void => {
    layerRect = null;
  };

  pagesLayer.addEventListener('pointerdown', onPointerDown);
  scroller()?.addEventListener('scroll', onScroll, { passive: true });

  return {
    dragging: () => gesture !== null,
    destroy() {
      endGesture();
      pagesLayer.removeEventListener('pointerdown', onPointerDown);
      scroller()?.removeEventListener('scroll', onScroll);
    },
  };
}
