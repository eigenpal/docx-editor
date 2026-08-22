// Semantic caret stops, hit regions, selection and keyboard navigation (task 7.4).
//
// Everything here is derived from the layout records and nothing else. No DOM ranges, no
// element rectangles, no remeasurement — which is what makes interaction answerable
// headlessly and identical between adapters.
//
// A position is always (paragraph node id, UTF-16 offset). The same address the tree ops
// take, so a click, a caret and an edit all speak one coordinate system: a hit test can be
// handed straight to `insertText` without a translation step that could disagree.

import { caretBoxOnLine, contentControlAtPoint, hitTestPage } from './semantic-hit-test.ts';
import { documentOrder, documentOrderIndex } from './document-order.ts';
export { documentOrder, everyStoryOrder } from './document-order.ts';
export { selectionRects, keyedRangeRects, type KeyedRange } from './selection-rects.ts';
import { xWithinLine } from './line-geometry.ts';
import { lineSegmentFor, lineSegments, segmentOverlap, type LineSegment } from './line-segments.ts';
import type {
  BlockFragmentRecord,
  ContentControlBoundaryRecord,
  LineRecord,
  SemanticLayout,
  StyleSpanRecord,
  TextMeasurer,
} from './semantic-records.ts';
import { contentControlsOfLayout, paragraphFragmentsOf } from './semantic-records.ts';
import {
  indexCaretStops,
  ParagraphCaretStopCache,
  type IndexedCaretStops,
} from './semantic-caret-stop-index.ts';
import {
  moveHorizontalCaret as moveIndexedHorizontalCaret,
  moveToDocumentEdge,
  moveToLineEdge,
  moveVerticalCaret,
  nearestStop,
  stopInDirection,
} from './semantic-caret-navigation.ts';
import {
  insideDeletedContent,
  paragraphDeletedRanges,
  paragraphLinesIndex,
} from './paragraph-lines.ts';
import { wordBoundary } from './semantic-word-navigation.ts';
import { PAGE_BREAK_CHAR } from '../store/package/hard-break.ts';

export { wordBoundary } from './semantic-word-navigation.ts';
export { positionPastDeletion } from './paragraph-lines.ts';

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

/**
 * A selection as two semantic positions — never as DOM nodes.
 *
 * `anchor` is where the selection started and `head` is where it currently ends, so `head` before
 * `anchor` is an ordinary backwards selection rather than an error. Collapsed when the two are
 * equal, which is what a caret is.
 */
export interface SemanticSelection {
  readonly anchor: SemanticPosition;
  readonly head: SemanticPosition;
}

/** One painted selection rectangle, in page-relative layout points. */
export interface SelectionRect {
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
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

/** The continuation line when a soft wrap opens on an inline drawing atom. */
function laterLineWithDrawingAt(
  layout: SemanticLayout,
  paragraphId: string,
  offset: number
): LineRecord | null {
  for (const { line } of paragraphLinesIndex(layout).get(paragraphId) ?? []) {
    if (line.range.start !== offset) continue;
    if (line.drawings?.some((drawing) => drawing.start === offset)) return line;
  }
  return null;
}

/**
 * True when `offset` sits strictly inside a span that is not a 1:1 model↔paint mapping
 * (projected PAGE digits, leaders) — those interiors are not navigable caret stops.
 * Tabs keep a 1:1 `\t` range; their wide box is still only two stops (before/after).
 */
function isNonNavigableInterior(line: LineRecord, offset: number, segment?: LineSegment): boolean {
  for (const span of segment ? segment.spans : line.spans) {
    if (offset <= span.range.start || offset >= span.range.end) continue;
    if (span.projected) return true;
    if (span.text.length !== span.range.end - span.range.start) return true;
  }
  return false;
}

/**
 * Whether an authored break is what ended this line.
 *
 * The break OCCUPIES a model offset and is published as a zero-width span, so a line that a
 * Shift+Enter terminated carries it as its last span. That is the one case where a position
 * shared by two lines is not ambiguous — see `caretAt`.
 *
 * A PAGE break counts for exactly the same reason, and leaving it out was worse than the
 * hard-break case rather than milder: the line it opens is on the NEXT PAGE, so reporting
 * the end of the line the break closed put the caret on a different page from the text that
 * would be typed at it. Click below the last line, type, and the letters appear a page
 * later. A column break already arrives here as `\n` — only `w:type="page"` projects its
 * own character.
 */
function endsWithLineBreak(line: {
  readonly spans: readonly { readonly text: string }[];
}): boolean {
  const last = line.spans[line.spans.length - 1]?.text;
  return last === '\n' || last === PAGE_BREAK_CHAR;
}

function pushLineCaretStops(
  stops: CaretGeometry[],
  layout: SemanticLayout,
  line: LineRecord,
  pageIndex: number,
  fragmentStart: number,
  measurer?: TextMeasurer,
  only?: string
): void {
  for (const segment of lineSegments(line)) {
    if (only !== undefined && segment.paragraphId !== only) continue;
    pushSegmentCaretStops(stops, layout, line, segment, pageIndex, fragmentStart, measurer);
  }
}

function pushSegmentCaretStops(
  stops: CaretGeometry[],
  layout: SemanticLayout,
  line: LineRecord,
  segment: LineSegment,
  pageIndex: number,
  fragmentStart: number,
  measurer?: TextMeasurer
): void {
  const mixed = lineSegments(line).length > 1;
  // Paragraph-wide, not this line's own slices: a deletion that wraps is clipped per line,
  // and its wrap boundaries must not read as region edges (see paragraphDeletedRanges).
  const deleted = paragraphDeletedRanges(layout, segment.paragraphId);
  /** Whether some painted span covers this offset — the glyphs the caret would sit between. */
  const painted = (offset: number): boolean =>
    segment.spans.some((span) => span.range.start <= offset && offset <= span.range.end);
  for (let offset = segment.start; offset <= segment.end; offset += 1) {
    // A line ENDED BY A HARD BREAK does not own the position after it — the line the
    // break opened does, and `caretAt` places the caret there. Emitting it here too
    // would put the stop this lane navigates to on a different line from the caret
    // the user can see: Home would jump to the row above, Down would skip the new
    // line entirely, and the empty line a trailing Shift+Enter opens would be
    // unreachable because the dedup below discarded its only stop as a duplicate.
    if (
      offset === segment.end &&
      offset > segment.start &&
      !mixed &&
      endsWithLineBreak(line) &&
      laterLineOwns(layout, line, offset)
    ) {
      continue;
    }
    // A continuation line's first stop is the same model position as the previous
    // line's last, so it is emitted once — by the line that starts there.
    if (offset === segment.start && offset > fragmentStart && stops.length > 0) {
      const previous = stops[stops.length - 1]!;
      if (
        previous.position.paragraphId === segment.paragraphId &&
        previous.position.offset === offset
      ) {
        continue;
      }
    }
    if (isNonNavigableInterior(line, offset, segment)) continue;
    // VISIBLE deleted content is fully navigable — Word lets the caret rest between struck
    // characters, and the tracked lane already accepts inserts there (`tree-op-tracked.ts`).
    // What is skipped is a deleted offset the display mode resolved AWAY: in the proposed
    // result those characters paint no span at all, and an offset-by-offset walk would stop
    // at invisible positions. Derived from the spans rather than from the mode, so the rule
    // holds in any mode that suppresses them.
    if (insideDeletedContent(deleted, offset) && !painted(offset)) continue;
    stops.push({
      position: { paragraphId: segment.paragraphId, offset },
      x: xWithinLine(line, offset, measurer, segment),
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
const paragraphCaretStopCache = new ParagraphCaretStopCache<CaretGeometry>();

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
 * Caret stops for every paragraph on the caret's line, or null when the line holds one.
 *
 * Built only for a merged line, so an ordinary document keeps the per-paragraph index it
 * always used — that index is memoized per paragraph and this is not.
 */
function mergedLineCaretStops(
  layout: SemanticLayout,
  position: SemanticPosition,
  measurer?: TextMeasurer
): IndexedCaretStops<CaretGeometry> | null {
  const placed = paragraphLinesIndex(layout).get(position.paragraphId) ?? [];
  const found = placed.find(({ line }) => {
    const segment = lineSegmentFor(line, position.paragraphId);
    return segment !== null && position.offset >= segment.start && position.offset <= segment.end;
  });
  if (!found || lineSegments(found.line).length < 2) return null;
  const stops: CaretGeometry[] = [];
  pushLineCaretStops(stops, layout, found.line, found.pageIndex, 0, measurer);
  return indexCaretStops(stops);
}

function paragraphCaretStops(
  layout: SemanticLayout,
  paragraphId: string,
  measurer?: TextMeasurer
): IndexedCaretStops<CaretGeometry> {
  return paragraphCaretStopCache.get(layout, paragraphId, measurer, () => {
    const stops: CaretGeometry[] = [];
    for (const { line, pageIndex } of paragraphLinesIndex(layout).get(paragraphId) ?? []) {
      pushLineCaretStops(stops, layout, line, pageIndex, 0, measurer, paragraphId);
    }
    return indexCaretStops(stops);
  });
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

/**
 * How caret geometry is resolved.
 *
 * `preferPage` disambiguates a paragraph that paints on SEVERAL pages — a shared header appears
 * once per page, and without a preference the caret could be placed on any of its copies.
 */
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
    // The part of the line this paragraph owns. On a merged line that is half of it, and the
    // other half counts its offsets in a different paragraph entirely.
    const segment = lineSegmentFor(line, position.paragraphId);
    if (!segment) continue;
    if (position.offset < segment.start || position.offset > segment.end) continue;
    if (
      position.offset === segment.end &&
      position.offset > segment.start &&
      lineSegments(line).length === 1 &&
      endsWithLineBreak(line)
    ) {
      // Remember it, but keep looking for the line that STARTS here. Falling back to it
      // keeps a caret placed rather than lost if no such line was laid out.
      afterBreak ??= { line, pageIndex };
      continue;
    }
    if (
      position.offset === segment.end &&
      position.offset > segment.start &&
      laterLineWithDrawingAt(layout, position.paragraphId, position.offset)
    ) {
      continue;
    }
    const box = caretBoxOnLine(line, position.offset, options.measurer, segment);
    return { position, x: box.x, y: box.y, height: box.height, lineId: line.id, pageIndex };
  }
  if (afterBreak) {
    const box = caretBoxOnLine(
      afterBreak.line,
      position.offset,
      options.measurer,
      lineSegmentFor(afterBreak.line, position.paragraphId)
    );
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

/**
 * Position lookup for one reading order, memoized on the array.
 *
 * The BODY's order is an identity-stable memoized array, so the map survives as long as it
 * does. That is where the cost was: scanning it with `indexOf` meant two O(n) walks per
 * formatting read, on a path that fires on every selection change — measured at 0.12 ms for a
 * selection near the end of a 240-page document, and growing with it.
 *
 * A furniture or note order is rebuilt per call, so the map never hits there and this is a
 * little more work than the scan it replaced. A header's order is a handful of entries, which
 * is why that trade is worth making for the body's twelve thousand.
 */
const orderIndexes = new WeakMap<readonly string[], Map<string, number>>();

function positionIn(order: readonly string[], paragraphId: string): number {
  let index = orderIndexes.get(order);
  if (!index) {
    index = new Map();
    order.forEach((id, at) => {
      if (!index!.has(id)) index!.set(id, at);
    });
    orderIndexes.set(order, index);
  }
  return index.get(paragraphId) ?? -1;
}

/**
 * Order a selection's endpoints, against the order of the story they live in.
 *
 * `order` is REQUIRED on this internal seam, and deliberately so. It used to default to the
 * body's `documentOrder`,
 * which meant every new call site was body-blind unless its author remembered — and a
 * two-paragraph selection in a header ranked both endpoints at -1, gave up, and returned null.
 * The reads built on this then answered for the head paragraph alone. Making the caller state
 * the order turns that from a silent wrong answer into a compile error.
 */
export function orderPositions(
  selection: SemanticSelection,
  order: readonly string[]
): { from: SemanticPosition; to: SemanticPosition } | null {
  // NOTE: still required here. This is the internal seam every selection read goes through,
  // and the compiler finding a call site that forgot the story's order is the whole reason it
  // is required. The PUBLIC entry points below default it instead, because a consumer holding
  // only a layout and a selection has nothing else to pass.
  // Same paragraph needs no document-wide order at all.
  if (selection.anchor.paragraphId === selection.head.paragraphId) {
    return selection.anchor.offset <= selection.head.offset
      ? { from: selection.anchor, to: selection.head }
      : { from: selection.head, to: selection.anchor };
  }
  const anchorIndex = positionIn(order, selection.anchor.paragraphId);
  const headIndex = positionIn(order, selection.head.paragraphId);
  if (anchorIndex === -1 || headIndex === -1) return null;
  if (
    anchorIndex < headIndex ||
    (anchorIndex === headIndex && selection.anchor.offset <= selection.head.offset)
  ) {
    return { from: selection.anchor, to: selection.head };
  }
  return { from: selection.head, to: selection.anchor };
}

/**
 * One caret movement, in Word's own vocabulary.
 *
 * Visual rather than logical where the two differ: `left` means left on screen, which in
 * right-to-left text is forward through the string.
 */
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
    // ONLY this paragraph's part of the line. A resolved display mode lays merged paragraphs
    // out together, and both members count their offsets from zero, so reading the line whole
    // reconstructed one paragraph's text from the other's spans — and this IS the surface's
    // `paragraphTextOf`, so the deletion range, the clamp and the word walk all followed it.
    const segment = lineSegmentFor(line, paragraphId);
    if (!segment) continue;
    for (const span of segment.spans) {
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
      // A PROJECTED atom can paint more glyphs than its model range is wide — a document-property
      // field spells "Sample Title" over one model unit. The raw text would make this longer than
      // the model paragraph, and since this IS the surface's `paragraphTextOf` the overshoot lands
      // in Select All, the deletion range and the word walk. Clamp each span to its model width.
      const width = span.range.end - span.range.start;
      const text =
        span.text.length === width ? span.text : span.text.slice(0, width).padEnd(width, ' ');
      pieces.push({ start: span.range.start, text });
    }
    // Inline drawings occupy one UTF-16 unit each; they live on `line.drawings`, not in span
    // text, but selection clamp, Select All, and surface ops read length from here.
    for (const drawing of segment.drawings) {
      const start = drawing.start;
      const end = start + 1;
      const key = `${start}:${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pieces.push({ start, text: '\uFFFC' });
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

/** Story-scoped stops are required when navigating inside an open header or footer. */
export interface MoveCaretOptions {
  /** Precomputed active-story stops; body navigation keeps the indexed default. */
  readonly stops?: readonly CaretGeometry[];
  readonly measurer?: TextMeasurer;
}

function moveHorizontalCaret(
  layout: SemanticLayout,
  position: SemanticPosition,
  direction: -1 | 1,
  measurer?: TextMeasurer
): { position: SemanticPosition; desiredX: null } | null {
  const order = documentOrder(layout);
  const paragraphIndex = documentOrderIndex(layout).get(position.paragraphId);
  if (paragraphIndex === undefined) return null;
  return moveIndexedHorizontalCaret(position, direction, order, paragraphIndex, (paragraphId) =>
    paragraphCaretStops(layout, paragraphId, measurer)
  );
}

/** Move a caret; vertical movement carries a desired X through shorter lines. */
export function moveCaret(
  layout: SemanticLayout,
  position: SemanticPosition,
  command: NavigationCommand,
  desiredX: number | null = null,
  options: MoveCaretOptions = {}
): { position: SemanticPosition; desiredX: number | null } | null {
  if (!options.stops && (command === 'left' || command === 'right')) {
    return moveHorizontalCaret(layout, position, command === 'left' ? -1 : 1, options.measurer);
  }
  if (!options.stops && (command === 'wordLeft' || command === 'wordRight')) {
    const direction = command === 'wordLeft' ? -1 : 1;
    const target = wordBoundary(
      paragraphTextFromLayout(layout, position.paragraphId),
      position.offset,
      direction
    );
    return target === position.offset
      ? moveHorizontalCaret(layout, position, direction, options.measurer)
      : { position: { paragraphId: position.paragraphId, offset: target }, desiredX: null };
  }
  if (!options.stops && (command === 'lineStart' || command === 'lineEnd')) {
    // Home and End mean the ends of the LINE a reader sees. One paragraph's stops describe
    // that line only while the line holds one paragraph: on a line a resolved view merged,
    // they stopped at the member boundary, in the middle of the text on screen.
    const target = moveToLineEdge(
      position,
      command === 'lineStart' ? -1 : 1,
      mergedLineCaretStops(layout, position, options.measurer) ??
        paragraphCaretStops(layout, position.paragraphId, options.measurer)
    );
    return target ? { position: target, desiredX: null } : null;
  }
  if (!options.stops && (command === 'documentStart' || command === 'documentEnd')) {
    const target = moveToDocumentEdge(
      command === 'documentStart' ? -1 : 1,
      documentOrder(layout),
      (paragraphId) => paragraphCaretStops(layout, paragraphId, options.measurer)
    );
    return target ? { position: target, desiredX: null } : null;
  }
  if (!options.stops && (command === 'up' || command === 'down')) {
    const paragraphIndex = documentOrderIndex(layout).get(position.paragraphId);
    if (paragraphIndex === undefined) return null;
    return moveVerticalCaret(
      position,
      command === 'up' ? -1 : 1,
      desiredX,
      documentOrder(layout),
      paragraphIndex,
      (paragraphId) => paragraphCaretStops(layout, paragraphId, options.measurer)
    );
  }
  const stops = options.stops ? [...options.stops] : caretStops(layout, options.measurer);
  if (stops.length === 0) return null;
  let index = stops.findIndex(
    (stop) =>
      stop.position.paragraphId === position.paragraphId && stop.position.offset === position.offset
  );
  if (index === -1) {
    // NO stop owns this position — a gesture endpoint left inside deleted content, whose
    // interior is deliberately not navigable. Refusing made every key from there a dead
    // press. For horizontal motion the nearest stop in the direction of travel IS the move;
    // everything else proceeds from the nearest stop of the same paragraph.
    if (command === 'left' || command === 'right') {
      const resolved =
        stopInDirection(stops, position, command === 'left' ? -1 : 1) ??
        nearestStop(stops, position);
      return resolved ? { position: resolved.position, desiredX: null } : null;
    }
    const resolved = nearestStop(stops, position);
    if (!resolved) return null;
    index = stops.indexOf(resolved);
  }
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
      const seenLineIds = new Set<string>();
      for (const stop of stops) {
        if (seenLineIds.has(stop.lineId)) continue;
        seenLineIds.add(stop.lineId);
        lineIds.push(stop.lineId);
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
  selection: SemanticSelection,
  /**
   * Reading order of the ACTIVE story. See {@link orderPositions}.
   *
   * REQUIRED. A default here can only be one story's order, and whichever one it is will be
   * wrong for every caret in another — which is exactly how this read came to answer about the
   * body while the caret sat in a header. Requiring it is what makes the compiler find a call
   * site that forgot, and it already found one.
   *
   * A caller with no story in hand passes {@link everyStoryOrder}, which covers all of them: a
   * selection cannot span two stories, so only the order WITHIN one is ever compared.
   */
  order: readonly string[]
): StyleSpanRecord[] {
  const ordered = orderPositions(selection, order);
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
      const segment = lineSegmentFor(line, ordered.from.paragraphId);
      if (!segment) continue;
      const overlap = segmentOverlap(layout, segment, ordered.from, ordered.to);
      if (!overlap) continue;
      for (const span of segment.spans) {
        if (span.range.end > overlap.start && span.range.start < overlap.end) spans.push(span);
      }
    }
    return spans;
  }
  const lines = paragraphLinesIndex(layout);
  // Positions WITHIN the given order, not the body index: the two agree for the body and
  // nowhere else, and `paragraphLinesIndex` already covers every story.
  const first = positionIn(order, ordered.from.paragraphId);
  const last = positionIn(order, ordered.to.paragraphId);
  if (first === -1 || last === -1) return [];
  for (let at = first; at <= last; at += 1) {
    for (const { line } of lines.get(order[at]!) ?? []) {
      const segment = lineSegmentFor(line, order[at]!);
      if (!segment) continue;
      const overlap = segmentOverlap(layout, segment, ordered.from, ordered.to);
      if (!overlap) continue;
      for (const span of segment.spans) {
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
    // This paragraph's spans only: on a merged line the other member's runs sit beside these
    // and would report their formatting for a caret that is not in them.
    for (const span of lineSegmentFor(line, position.paragraphId)?.spans ?? []) {
      if (span.range.start < position.offset && position.offset <= span.range.end) return [span];
      if (rightward === null && span.range.start === position.offset) rightward = span;
    }
  }
  return rightward ? [rightward] : [];
}
