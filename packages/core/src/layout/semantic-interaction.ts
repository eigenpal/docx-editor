// Semantic caret stops, hit regions, selection and keyboard navigation (task 7.4).
//
// Everything here is derived from the layout records and nothing else. No DOM ranges, no
// element rectangles, no remeasurement — which is what makes interaction answerable
// headlessly and identical between adapters.
//
// A position is always (paragraph node id, UTF-16 offset). The same address the tree ops
// take, so a click, a caret and an edit all speak one coordinate system: a hit test can be
// handed straight to `insertText` without a translation step that could disagree.

import { caretBoxOnLine, hitTestPage, spanOffsetX } from './semantic-hit-test.ts';
import type {
  LineRecord,
  SemanticLayout,
  StyleSpanRecord,
  TextMeasurer,
} from './semantic-records.ts';
import { paragraphFragmentsOf } from './semantic-records.ts';

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
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      for (const line of fragment.lines) {
        const entry = index.get(line.range.paragraphId);
        const placed = { line, pageIndex: page.index };
        if (entry) entry.push(placed);
        else index.set(line.range.paragraphId, [placed]);
      }
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
 * Every caret stop in the document, in reading order.
 *
 * One per character boundary on every line, plus the line end. Derived rather than stored,
 * so a stop can never survive the content it described.
 */
export function caretStops(layout: SemanticLayout): CaretGeometry[] {
  const stops: CaretGeometry[] = [];
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      for (const line of fragment.lines) {
        for (let offset = line.range.start; offset <= line.range.end; offset += 1) {
          // A continuation line's first stop is the same model position as the previous
          // line's last, so it is emitted once — by the line that starts there.
          if (offset === line.range.start && offset > fragment.range.start && stops.length > 0) {
            const previous = stops[stops.length - 1]!;
            if (
              previous.position.paragraphId === line.range.paragraphId &&
              previous.position.offset === offset
            ) {
              continue;
            }
          }
          stops.push({
            position: { paragraphId: line.range.paragraphId, offset },
            x: xWithinLine(line, offset),
            y: line.box.y,
            height: line.box.height,
            lineId: line.id,
            pageIndex: page.index,
          });
        }
      }
    }
  }
  return stops;
}

/** Geometry for one model position, or null when it is not laid out. */
export function caretAt(
  layout: SemanticLayout,
  position: SemanticPosition,
  measurer?: TextMeasurer
): CaretGeometry | null {
  for (const { line, pageIndex } of paragraphLinesIndex(layout).get(position.paragraphId) ?? []) {
    if (position.offset < line.range.start || position.offset > line.range.end) continue;
    const box = caretBoxOnLine(line, position.offset, measurer);
    return {
      position,
      x: box.x,
      y: box.y,
      height: box.height,
      lineId: line.id,
      pageIndex,
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
  desiredX: number | null = null
): { position: SemanticPosition; desiredX: number | null } | null {
  const stops = caretStops(layout);
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
