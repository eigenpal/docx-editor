// Semantic caret stops, hit regions, selection and keyboard navigation (task 7.4).
//
// Everything here is derived from the layout records and nothing else. No DOM ranges, no
// element rectangles, no remeasurement — which is what makes interaction answerable
// headlessly and identical between adapters.
//
// A position is always (paragraph node id, UTF-16 offset). The same address the tree ops
// take, so a click, a caret and an edit all speak one coordinate system: a hit test can be
// handed straight to `insertText` without a translation step that could disagree.

import {
  caretBoxOnLine,
  contentControlAtPoint,
  hitTestPage,
  spanOffsetX,
} from './semantic-hit-test.ts';
import type {
  BlockFragmentRecord,
  ContentControlBoundaryRecord,
  LineRecord,
  SemanticLayout,
  StyleSpanRecord,
  TextMeasurer,
} from './semantic-records.ts';
import { contentControlsOfLayout, paragraphFragmentsOf } from './semantic-records.ts';

/** A caret position in the model. */
export interface SemanticPosition {
  readonly paragraphId: string;
  readonly offset: number;
}

/** A caret position with the geometry that renders it. */
export interface CaretGeometry {
  readonly position: SemanticPosition;
  /** Page-relative, in the same coordinate space as the line boxes. */
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly lineId: string;
  readonly pageIndex: number;
}

export interface SemanticSelection {
  readonly anchor: SemanticPosition;
  readonly head: SemanticPosition;
}

export interface SelectionRect {
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Lines grouped by the paragraph they render, with the page each sits on.
 *
 * Memoized PER LAYOUT — a published layout is immutable, so the grouping is computed once
 * per revision instead of once per read. The reads this serves — caret geometry, span
 * lookup for a selection, text reconstruction — are all "the lines of ONE paragraph", and
 * answering them by scanning every line of every page made each one O(document); the
 * toolbar asks after every commit, so the scans multiplied per keystroke.
 */
interface PlacedLine {
  readonly line: LineRecord;
  readonly pageIndex: number;
}

const paragraphLinesCache = new WeakMap<SemanticLayout, Map<string, PlacedLine[]>>();

function paragraphLinesIndex(layout: SemanticLayout): Map<string, PlacedLine[]> {
  const cached = paragraphLinesCache.get(layout);
  if (cached) return cached;
  const index = new Map<string, PlacedLine[]>();
  const indexFragments = (
    fragments: readonly import('./semantic-records.ts').BlockFragmentRecord[],
    pageIndex: number
  ): void => {
    const visit = (
      blocks: readonly import('./semantic-records.ts').BlockFragmentRecord[]
    ): void => {
      for (const block of blocks) {
        if (block.kind === 'paragraph') {
          for (const line of block.lines) {
            const entry = index.get(line.range.paragraphId);
            const placed = { line, pageIndex };
            if (entry) entry.push(placed);
            else index.set(line.range.paragraphId, [placed]);
          }
          continue;
        }
        for (const row of block.rows) {
          if (row.isHeaderRepeat) continue;
          for (const cell of row.cells) visit(cell.blocks);
        }
      }
    };
    visit(fragments);
  };
  for (const page of layout.pages) {
    // Body first — primary story for caret stops built elsewhere via paragraphFragmentsOf.
    for (const fragment of paragraphFragmentsOf(page)) {
      for (const line of fragment.lines) {
        const entry = index.get(line.range.paragraphId);
        const placed = { line, pageIndex: page.index };
        if (entry) entry.push(placed);
        else index.set(line.range.paragraphId, [placed]);
      }
    }
    // Furniture paragraphs share this index so formatting / paragraphTextFromLayout can
    // resolve an open header/footer selection. documentOrder and caretStops stay body-only.
    if (page.header) indexFragments(page.header.fragments, page.index);
    if (page.footer) indexFragments(page.footer.fragments, page.index);
    // Note stories (footnotes/endnotes) — same formatting lane as furniture; not body order.
    for (const area of [page.footnotes, page.endnotes]) {
      if (!area) continue;
      for (const note of area.notes) indexFragments(note.fragments, page.index);
    }
  }
  paragraphLinesCache.set(layout, index);
  return index;
}

/** The x offset of `offset` within a line, by walking its spans. */
function xWithinLine(
  line: LineRecord,
  offset: number,
  measurer?: TextMeasurer | undefined
): number {
  let x = line.box.x;
  for (const span of line.spans) {
    if (offset <= span.range.start) return span.box.x;
    if (offset >= span.range.end) {
      x = span.box.x + span.box.width;
      continue;
    }
    // MEASURED, not interpolated. Interpolating across the span's advance is exact only for a
    // uniform one — in any proportional face it draws the caret a fraction of the way through
    // the span rather than at a glyph edge, so a caret between two letters appeared on top of
    // one. Without a measurer it still interpolates, and says so.
    return spanOffsetX(span, offset, measurer);
  }
  return x;
}

/**
 * Whether a LATER line of the same paragraph starts at this offset, and so owns it.
 *
 * Asked across the whole paragraph rather than the current fragment: a paragraph split by a
 * page boundary continues on the next page, and the line that owns the position may live in
 * a different fragment. `caretAt` resolves against the same paragraph-wide index, so both
 * lanes answer with the same line. When nothing later claims it — a layout that produced no
 * line after the break — the break's own line keeps the stop rather than losing the position.
 */
function laterLineOwns(layout: SemanticLayout, line: LineRecord, offset: number): boolean {
  const lines = paragraphLinesIndex(layout).get(line.range.paragraphId) ?? [];
  let seen = false;
  for (const placed of lines) {
    if (placed.line === line) {
      seen = true;
      continue;
    }
    if (seen && placed.line.range.start === offset) return true;
  }
  return false;
}

/**
 * True when this offset sits strictly INSIDE deleted content on the line.
 *
 * The boundaries are kept: the position immediately before a deletion and the one immediately
 * after it are both real places to put a caret, and dropping them would make the deletion
 * unreachable — including for the accept or reject that resolves it.
 */
function insideDeletedContent(line: LineRecord, offset: number): boolean {
  const ranges = line.deletedRanges;
  if (ranges === undefined) return false;
  for (const range of ranges) {
    if (offset > range.start && offset < range.end) return true;
  }
  return false;
}

/**
 * True when `offset` sits strictly inside a span that is not a 1:1 model↔paint mapping
 * (projected PAGE digits, leaders) — those interiors are not navigable caret stops.
 * Tabs keep a 1:1 `\t` range; their wide box is still only two stops (before/after).
 */
function isNonNavigableInterior(line: LineRecord, offset: number): boolean {
  for (const span of line.spans) {
    if (offset <= span.range.start || offset >= span.range.end) continue;
    if (span.projected) return true;
    if (span.text.length !== span.range.end - span.range.start) return true;
  }
  return false;
}

/**
 * Whether a hard line break is what ended this line.
 *
 * The break OCCUPIES a model offset and is published as a zero-width span, so a line that a
 * Shift+Enter terminated carries it as its last span. That is the one case where a position
 * shared by two lines is not ambiguous — see `caretAt`.
 */
function endsWithLineBreak(line: {
  readonly spans: readonly { readonly text: string }[];
}): boolean {
  return line.spans[line.spans.length - 1]?.text === '\n';
}

function pushLineCaretStops(
  stops: CaretGeometry[],
  layout: SemanticLayout,
  line: LineRecord,
  pageIndex: number,
  fragmentStart: number,
  measurer?: TextMeasurer
): void {
  for (let offset = line.range.start; offset <= line.range.end; offset += 1) {
    // A line ENDED BY A HARD BREAK does not own the position after it — the line the
    // break opened does, and `caretAt` places the caret there. Emitting it here too
    // would put the stop this lane navigates to on a different line from the caret
    // the user can see: Home would jump to the row above, Down would skip the new
    // line entirely, and the empty line a trailing Shift+Enter opens would be
    // unreachable because the dedup below discarded its only stop as a duplicate.
    if (
      offset === line.range.end &&
      offset > line.range.start &&
      endsWithLineBreak(line) &&
      laterLineOwns(layout, line, offset)
    ) {
      continue;
    }
    // A continuation line's first stop is the same model position as the previous
    // line's last, so it is emitted once — by the line that starts there.
    if (offset === line.range.start && offset > fragmentStart && stops.length > 0) {
      const previous = stops[stops.length - 1]!;
      if (
        previous.position.paragraphId === line.range.paragraphId &&
        previous.position.offset === offset
      ) {
        continue;
      }
    }
    if (isNonNavigableInterior(line, offset)) continue;
    // Deleted content is skipped for the same reason and by the same lane: `moveCaret` reads
    // this list and nothing else, so arrow keys, word jumps, page jumps and Home/End all
    // inherit "step over a deletion, never into it" from one place.
    if (insideDeletedContent(line, offset)) continue;
    stops.push({
      position: { paragraphId: line.range.paragraphId, offset },
      x: xWithinLine(line, offset, measurer),
      y: line.box.y,
      height: line.box.height,
      lineId: line.id,
      pageIndex,
    });
  }
}

function visitParagraphFragments(
  layout: SemanticLayout,
  blocks: readonly BlockFragmentRecord[],
  pageIndex: number,
  stops: CaretGeometry[],
  measurer?: TextMeasurer
): void {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      for (const line of block.lines) {
        pushLineCaretStops(stops, layout, line, pageIndex, block.range.start, measurer);
      }
      continue;
    }
    for (const row of block.rows) {
      if (row.isHeaderRepeat) continue;
      for (const cell of row.cells)
        visitParagraphFragments(layout, cell.blocks, pageIndex, stops, measurer);
    }
  }
}

/**
 * Every caret stop in the document body, in reading order.
 *
 * One per character boundary on every line, plus the line end. Derived rather than stored,
 * so a stop can never survive the content it described. Ownership of a position SHARED by
 * two lines is decided here exactly as `caretAt` decides it. Furniture stories use
 * {@link caretStopsForBlocks} so open header/footer navigation never walks body stops.
 */
export function caretStops(layout: SemanticLayout, measurer?: TextMeasurer): CaretGeometry[] {
  const stops: CaretGeometry[] = [];
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      for (const line of fragment.lines) {
        pushLineCaretStops(stops, layout, line, page.index, fragment.range.start, measurer);
      }
    }
  }
  return stops;
}

/**
 * Caret stops for one story's block fragments (header/footer), in reading order.
 *
 * Coordinates stay story-relative — the same space `hitTestFragments` and furniture paint
 * use — so arrow motion follows tab-stop geometry and projected field atoms without mixing
 * body sheet offsets.
 */
export function caretStopsForBlocks(
  layout: SemanticLayout,
  pageIndex: number,
  fragments: readonly BlockFragmentRecord[],
  measurer?: TextMeasurer
): CaretGeometry[] {
  if (!layout.pages[pageIndex]) return [];
  const stops: CaretGeometry[] = [];
  visitParagraphFragments(layout, fragments, pageIndex, stops, measurer);
  return stops;
}

export interface CaretAtOptions {
  readonly measurer?: TextMeasurer;
  /**
   * Prefer geometry from this sheet when the same paragraph paints on multiple pages
   * (shared header/footer copies).
   */
  readonly preferredPageIndex?: number;
}

function resolveCaretAtOptions(measurerOrOptions?: TextMeasurer | CaretAtOptions): CaretAtOptions {
  if (!measurerOrOptions) return {};
  if (typeof (measurerOrOptions as TextMeasurer).measure === 'function') {
    return { measurer: measurerOrOptions as TextMeasurer };
  }
  return measurerOrOptions as CaretAtOptions;
}

/** Geometry for one model position, or null when it is not laid out. */
export function caretAt(
  layout: SemanticLayout,
  position: SemanticPosition,
  measurerOrOptions?: TextMeasurer | CaretAtOptions
): CaretGeometry | null {
  const options = resolveCaretAtOptions(measurerOrOptions);
  const placed = paragraphLinesIndex(layout).get(position.paragraphId) ?? [];
  const preferred = options.preferredPageIndex;
  const ordered =
    preferred === undefined
      ? placed
      : [...placed].sort((a, b) => {
          const aHit = a.pageIndex === preferred ? 0 : 1;
          const bHit = b.pageIndex === preferred ? 0 : 1;
          return aHit - bHit;
        });
  // A position at a line's END is also the START of the next one, and the first line that
  // contains it is not always the right answer. After a HARD BREAK it is the wrong one: the
  // break is what ended the line, so the caret belongs at the start of the line the user
  // just opened — not a break's width to the right of the last glyph on the line above,
  // which is what a Shift+Enter looked like. Soft wraps stay on the first match, where the
  // offset is genuinely shared and the end of the visual line is the conventional answer.
  let afterBreak: { line: LineRecord; pageIndex: number } | null = null;
  for (const { line, pageIndex } of ordered) {
    if (position.offset < line.range.start || position.offset > line.range.end) continue;
    if (
      position.offset === line.range.end &&
      position.offset > line.range.start &&
      endsWithLineBreak(line)
    ) {
      // Remember it, but keep looking for the line that STARTS here. Falling back to it
      // keeps a caret placed rather than lost if no such line was laid out.
      afterBreak ??= { line, pageIndex };
      continue;
    }
    const box = caretBoxOnLine(line, position.offset, options.measurer);
    return { position, x: box.x, y: box.y, height: box.height, lineId: line.id, pageIndex };
  }
  if (afterBreak) {
    const box = caretBoxOnLine(afterBreak.line, position.offset, options.measurer);
    return {
      position,
      x: box.x,
      y: box.y,
      height: box.height,
      lineId: afterBreak.line.id,
      pageIndex: afterBreak.pageIndex,
    };
  }
  return null;
}

/**
 * The caret position nearest a point, in PAGE-CONTENT coordinates.
 *
 * Never returns null for a point inside the document: a click in the margin, past the end of
 * a line, or below the last line still has an obvious intended caret, and refusing to answer
 * would make those clicks do nothing.
 *
 * The rules live in `semantic-hit-test.ts`, which answers with the cell address and the
 * on-glyphs flag a pointer controller needs too; this keeps the geometry-only shape for
 * callers that want nothing else.
 */
export function hitTestSemantic(
  layout: SemanticLayout,
  point: { readonly x: number; readonly y: number; readonly pageIndex?: number }
): CaretGeometry | null {
  // The point is PAGE-CONTENT relative, so it only means something on one page. Scoring it
  // against every page cost a full-document walk to answer with page 0 anyway: on uniform
  // geometry each page produces an identical score and the first one wins by construction.
  // Naming page 0 outright is the same answer, honestly, in constant time.
  const pageIndex =
    point.pageIndex !== undefined && layout.pages[point.pageIndex] ? point.pageIndex : 0;
  return hitTestPage(layout, pageIndex, point)?.caret ?? null;
}

/**
 * Innermost content-control boundary at a page-content point, or null outside every control.
 *
 * Prefers the deepest nesting depth when nested boundaries share geometry.
 */
export function contentControlAtSemantic(
  layout: SemanticLayout,
  point: { readonly x: number; readonly y: number; readonly pageIndex?: number }
): ContentControlBoundaryRecord | null {
  const pageIndex =
    point.pageIndex !== undefined && layout.pages[point.pageIndex] ? point.pageIndex : 0;
  return contentControlAtPoint(layout, pageIndex, point);
}

/** Layout-published content-control boundaries in document order. */
export function contentControlsInLayout(
  layout: SemanticLayout
): readonly ContentControlBoundaryRecord[] {
  return contentControlsOfLayout(layout);
}

/** The rectangles covering a selection, one per line it spans. */
export function selectionRects(
  layout: SemanticLayout,
  selection: SemanticSelection
): SelectionRect[] {
  const ordered = orderPositions(layout, selection);
  if (!ordered) return [];
  const rects: SelectionRect[] = [];
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      for (const line of fragment.lines) {
        const overlap = lineOverlap(layout, line, ordered.from, ordered.to);
        if (!overlap) continue;
        const startX = xWithinLine(line, overlap.start);
        const endX = xWithinLine(line, overlap.end);
        rects.push({
          pageIndex: page.index,
          x: Math.min(startX, endX),
          y: line.box.y,
          width: Math.abs(endX - startX),
          height: line.box.height,
        });
      }
    }
  }
  return rects;
}

/** A model range to highlight, and the key the caller knows it by. */
export interface KeyedRange {
  readonly key: string;
  readonly from: SemanticPosition;
  readonly to: SemanticPosition;
}

/**
 * Rectangles for MANY ranges in ONE pass over the lines.
 *
 * Not `selectionRects` in a loop. That walks every page, fragment and line per range, and a
 * contract with two hundred comments would re-walk the whole document two hundred times on
 * every layout — the highlight would cost more than the layout it decorates. One pass tests
 * each line against every range instead, which is the same work a single selection does.
 */
export function keyedRangeRects(
  layout: SemanticLayout,
  ranges: readonly KeyedRange[],
  /**
   * Pages to measure, or every page when absent.
   *
   * A band that is not on screen is not painted, so measuring it is pure cost — and it is
   * cost paid per keystroke, because an edit republishes the layout. Bounding this to the
   * materialized pages is what keeps typing in a heavily reviewed document as fast as
   * typing in a clean one.
   */
  pages?: ReadonlySet<number>
): Map<string, SelectionRect[]> {
  const found = new Map<string, SelectionRect[]>();
  if (ranges.length === 0) return found;
  for (const page of layout.pages) {
    if (pages && !pages.has(page.index)) continue;
    for (const fragment of paragraphFragmentsOf(page)) {
      for (const line of fragment.lines) {
        for (const range of ranges) {
          const overlap = lineOverlap(layout, line, range.from, range.to);
          if (!overlap) continue;
          const startX = xWithinLine(line, overlap.start);
          const endX = xWithinLine(line, overlap.end);
          const rects = found.get(range.key) ?? [];
          rects.push({
            pageIndex: page.index,
            x: Math.min(startX, endX),
            y: line.box.y,
            width: Math.abs(endX - startX),
            height: line.box.height,
          });
          found.set(range.key, rects);
        }
      }
    }
  }
  return found;
}

/** The part of `line` covered by a selection, in the line's own offsets. */
function lineOverlap(
  layout: SemanticLayout,
  line: LineRecord,
  from: SemanticPosition,
  to: SemanticPosition
): { start: number; end: number } | null {
  const index = documentOrderIndex(layout);
  const lineParagraph = index.get(line.range.paragraphId) ?? -1;
  const fromParagraph = index.get(from.paragraphId) ?? -1;
  const toParagraph = index.get(to.paragraphId) ?? -1;
  if (lineParagraph < fromParagraph || lineParagraph > toParagraph) return null;

  const start =
    lineParagraph === fromParagraph ? Math.max(line.range.start, from.offset) : line.range.start;
  const end = lineParagraph === toParagraph ? Math.min(line.range.end, to.offset) : line.range.end;
  return end > start ? { start, end } : null;
}

// Memoized PER LAYOUT, which is sound because a published layout is immutable: a new
// revision is a new object. Without this every selection walk recomputed the order — and
// `lineOverlap` runs once per line, so `spansInSelection` on a large document recomputed a
// full-document scan thousands of times per keystroke. The toolbar reading formatting on
// every commit is what turned that into seconds.
const documentOrderCache = new WeakMap<SemanticLayout, string[]>();
const documentOrderIndexCache = new WeakMap<SemanticLayout, Map<string, number>>();

/** Paragraph ids in document order, deduplicated across fragments. */
export function documentOrder(layout: SemanticLayout): string[] {
  const cached = documentOrderCache.get(layout);
  if (cached) return cached;
  const seen = new Set<string>();
  const order: string[] = [];
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      if (!seen.has(fragment.paragraphId)) {
        seen.add(fragment.paragraphId);
        order.push(fragment.paragraphId);
      }
    }
  }
  documentOrderCache.set(layout, order);
  return order;
}

/** Document-order position by paragraph id, for O(1) ordering checks. */
function documentOrderIndex(layout: SemanticLayout): Map<string, number> {
  const cached = documentOrderIndexCache.get(layout);
  if (cached) return cached;
  const index = new Map<string, number>();
  for (const [position, id] of documentOrder(layout).entries()) index.set(id, position);
  documentOrderIndexCache.set(layout, index);
  return index;
}

/** A selection's endpoints in document order. */
function orderPositions(
  layout: SemanticLayout,
  selection: SemanticSelection
): { from: SemanticPosition; to: SemanticPosition } | null {
  // Same paragraph needs no document-wide order — furniture stories are absent from
  // body `documentOrder` but still format within one paragraph.
  if (selection.anchor.paragraphId === selection.head.paragraphId) {
    return selection.anchor.offset <= selection.head.offset
      ? { from: selection.anchor, to: selection.head }
      : { from: selection.head, to: selection.anchor };
  }
  const order = documentOrder(layout);
  const anchorIndex = order.indexOf(selection.anchor.paragraphId);
  const headIndex = order.indexOf(selection.head.paragraphId);
  if (anchorIndex === -1 || headIndex === -1) return null;
  if (
    anchorIndex < headIndex ||
    (anchorIndex === headIndex && selection.anchor.offset <= selection.head.offset)
  ) {
    return { from: selection.anchor, to: selection.head };
  }
  return { from: selection.head, to: selection.anchor };
}

export type NavigationCommand =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'wordLeft'
  | 'wordRight'
  | 'lineStart'
  | 'lineEnd'
  | 'documentStart'
  | 'documentEnd'
  | 'pageUp'
  | 'pageDown';

/**
 * The text of one paragraph, read back from the layout records.
 *
 * Word boundaries need characters, and the records carry them: every span holds the text it
 * was laid out from, keyed by the source range it covers. Reading them back keeps word
 * motion in the interaction lane instead of making it a second consumer of the model.
 */
export function paragraphTextFromLayout(layout: SemanticLayout, paragraphId: string): string {
  const pieces: { start: number; text: string }[] = [];
  const seen = new Set<string>();
  for (const { line } of paragraphLinesIndex(layout).get(paragraphId) ?? []) {
    for (const span of line.spans) {
      // A ZERO-WIDTH span stands for something the model does not spell — a `w:ptab`, an
      // empty field projection. It contributes no characters, and a span whose painted text
      // is longer than its model range would make this reconstruction longer than the
      // paragraph actually is. That matters far beyond a stray character: this IS the
      // surface's `paragraphTextOf`, so the deletion range, the clamp and the word walk are
      // all computed from it, and a phantom tab put every one of them past the model's end.
      if (span.range.end === span.range.start) continue;
      // A paragraph that crosses a page produces fragments over the SAME source ranges, so
      // spans can repeat; keyed by range, they contribute once.
      const key = `${span.range.start}:${span.range.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pieces.push({ start: span.range.start, text: span.text });
    }
  }
  pieces.sort((a, b) => a.start - b.start);
  let text = '';
  for (const piece of pieces) {
    // Gaps mean content layout does not render as text (an unknown inline); pad so offsets
    // stay aligned with the model rather than silently shifting every later word.
    if (piece.start > text.length) text += ' '.repeat(piece.start - text.length);
    text = text.slice(0, piece.start) + piece.text;
  }
  return text;
}

/** Word characters for motion purposes: letters, digits and the marks that join them. */
const WORD_CHARACTER = /[\p{L}\p{N}_'\u2019]/u;

/**
 * The next word boundary from `offset`, in `direction`.
 *
 * Word-LEFT skips any whitespace immediately behind the caret and then the word behind that,
 * which is what every editor does and what makes repeated presses walk words rather than
 * alternate between a word and the space before it. Word-RIGHT stops at the END of the
 * current word, then skips the following whitespace on the next press.
 */
export function wordBoundary(text: string, offset: number, direction: -1 | 1): number {
  const isWord = (index: number): boolean => {
    const character = text[index];
    return character !== undefined && WORD_CHARACTER.test(character);
  };
  let index = Math.max(0, Math.min(offset, text.length));
  if (direction === -1) {
    while (index > 0 && !isWord(index - 1)) index -= 1;
    while (index > 0 && isWord(index - 1)) index -= 1;
    return index;
  }
  while (index < text.length && !isWord(index)) index += 1;
  while (index < text.length && isWord(index)) index += 1;
  return index;
}

export interface MoveCaretOptions {
  /**
   * Precomputed stops for the active story. Open header/footer navigation MUST pass
   * story-scoped stops from {@link caretStopsForBlocks}; body keeps the default.
   */
  readonly stops?: readonly CaretGeometry[];
  readonly measurer?: TextMeasurer;
}

/**
 * Move a caret.
 *
 * Vertical movement keeps a DESIRED X so a caret travelling through short lines returns to
 * its original column rather than collapsing to the end of the shortest one. The caller
 * threads that value; passing null starts a fresh vertical run from the current position.
 */
export function moveCaret(
  layout: SemanticLayout,
  position: SemanticPosition,
  command: NavigationCommand,
  desiredX: number | null = null,
  options: MoveCaretOptions = {}
): { position: SemanticPosition; desiredX: number | null } | null {
  const stops = options.stops ? [...options.stops] : caretStops(layout, options.measurer);
  if (stops.length === 0) return null;
  const index = stops.findIndex(
    (stop) =>
      stop.position.paragraphId === position.paragraphId && stop.position.offset === position.offset
  );
  if (index === -1) return null;
  const current = stops[index]!;

  switch (command) {
    case 'left': {
      const next = stops[Math.max(0, index - 1)]!;
      return { position: next.position, desiredX: null };
    }
    case 'right': {
      const next = stops[Math.min(stops.length - 1, index + 1)]!;
      return { position: next.position, desiredX: null };
    }
    case 'lineStart': {
      const line = stops.filter((stop) => stop.lineId === current.lineId);
      return { position: line[0]!.position, desiredX: null };
    }
    case 'lineEnd': {
      const line = stops.filter((stop) => stop.lineId === current.lineId);
      return { position: line[line.length - 1]!.position, desiredX: null };
    }
    case 'wordLeft':
    case 'wordRight': {
      const text = paragraphTextFromLayout(layout, position.paragraphId);
      const direction = command === 'wordLeft' ? -1 : 1;
      const target = wordBoundary(text, position.offset, direction);
      // Already at the paragraph edge: step into the neighbouring paragraph the way a plain
      // arrow would, so the key is never a dead press at a boundary.
      if (target === position.offset) {
        const next =
          stops[direction === -1 ? Math.max(0, index - 1) : Math.min(stops.length - 1, index + 1)]!;
        return { position: next.position, desiredX: null };
      }
      return { position: { paragraphId: position.paragraphId, offset: target }, desiredX: null };
    }
    case 'documentStart':
      return { position: stops[0]!.position, desiredX: null };
    case 'documentEnd':
      return { position: stops[stops.length - 1]!.position, desiredX: null };
    case 'pageUp':
    case 'pageDown': {
      // A page IS a unit here — the layout knows which sheet every caret stop is on — so
      // this moves one sheet rather than guessing a line count. Word keeps the column
      // position across the jump, like an arrow key does.
      const targetX = desiredX ?? current.x;
      const targetPage = current.pageIndex + (command === 'pageUp' ? -1 : 1);
      const onTarget = stops.filter((stop) => stop.pageIndex === targetPage);
      if (onTarget.length === 0) {
        // Off the first or last sheet: the document edge, which is what every editor does
        // rather than refusing the key.
        const edge = command === 'pageUp' ? stops[0]! : stops[stops.length - 1]!;
        return { position: edge.position, desiredX: targetX };
      }
      // The stop nearest the SAME point on the target sheet, both axes: the caret should
      // land where the eye expects it, not at the top of the page.
      let best = onTarget[0]!;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const stop of onTarget) {
        const distance = Math.abs(stop.y - current.y) * 1000 + Math.abs(stop.x - targetX);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = stop;
        }
      }
      return { position: best.position, desiredX: targetX };
    }
    case 'up':
    case 'down': {
      const targetX = desiredX ?? current.x;
      const lineIds: string[] = [];
      for (const stop of stops) {
        if (!lineIds.includes(stop.lineId)) lineIds.push(stop.lineId);
      }
      const lineIndex = lineIds.indexOf(current.lineId);
      const nextLineIndex = command === 'up' ? lineIndex - 1 : lineIndex + 1;
      if (nextLineIndex < 0 || nextLineIndex >= lineIds.length) {
        // Already at the first or last line: go to its start or end, which is what every
        // editor does rather than refusing the key.
        const edge = command === 'up' ? stops[0]! : stops[stops.length - 1]!;
        return { position: edge.position, desiredX: targetX };
      }
      const target = stops.filter((stop) => stop.lineId === lineIds[nextLineIndex]);
      let best = target[0]!;
      for (const stop of target) {
        if (Math.abs(stop.x - targetX) < Math.abs(best.x - targetX)) best = stop;
      }
      return { position: best.position, desiredX: targetX };
    }
    default:
      return null;
  }
}

/**
 * The anchor an IME composition is attached to.
 *
 * Composition needs a position that survives the intermediate transactions it produces, so
 * it is expressed in model coordinates and re-resolved against each new layout rather than
 * cached as geometry.
 */
export function compositionAnchor(
  layout: SemanticLayout,
  position: SemanticPosition
): CaretGeometry | null {
  return caretAt(layout, position);
}

/** The style spans a selection touches, for reporting active formatting. */
export function spansInSelection(
  layout: SemanticLayout,
  selection: SemanticSelection
): StyleSpanRecord[] {
  const ordered = orderPositions(layout, selection);
  if (!ordered) return [];
  if (
    ordered.from.paragraphId === ordered.to.paragraphId &&
    ordered.from.offset === ordered.to.offset
  ) {
    return caretSpan(layout, ordered.from);
  }
  const spans: StyleSpanRecord[] = [];
  // Only the paragraphs the selection touches; iterating every line of the document made
  // the toolbar's formatting read scale with document length instead of selection length.
  if (ordered.from.paragraphId === ordered.to.paragraphId) {
    for (const { line } of paragraphLinesIndex(layout).get(ordered.from.paragraphId) ?? []) {
      const overlap = lineOverlap(layout, line, ordered.from, ordered.to);
      if (!overlap) continue;
      for (const span of line.spans) {
        if (span.range.end > overlap.start && span.range.start < overlap.end) spans.push(span);
      }
    }
    return spans;
  }
  const order = documentOrder(layout);
  const index = documentOrderIndex(layout);
  const lines = paragraphLinesIndex(layout);
  const first = index.get(ordered.from.paragraphId) ?? -1;
  const last = index.get(ordered.to.paragraphId) ?? -1;
  if (first === -1 || last === -1) return [];
  for (let at = first; at <= last; at += 1) {
    for (const { line } of lines.get(order[at]!) ?? []) {
      const overlap = lineOverlap(layout, line, ordered.from, ordered.to);
      if (!overlap) continue;
      for (const span of line.spans) {
        if (span.range.end > overlap.start && span.range.start < overlap.end) spans.push(span);
      }
    }
  }
  return spans;
}

/**
 * The span a collapsed caret reports formatting from: the character to its LEFT (Word's
 * rule — typing continues what came before), falling back to the character to its right
 * at a paragraph start.
 */
function caretSpan(layout: SemanticLayout, position: SemanticPosition): StyleSpanRecord[] {
  let rightward: StyleSpanRecord | null = null;
  for (const { line } of paragraphLinesIndex(layout).get(position.paragraphId) ?? []) {
    for (const span of line.spans) {
      if (span.range.start < position.offset && position.offset <= span.range.end) return [span];
      if (rightward === null && span.range.start === position.offset) rightward = span;
    }
  }
  return rightward ? [rightward] : [];
}
