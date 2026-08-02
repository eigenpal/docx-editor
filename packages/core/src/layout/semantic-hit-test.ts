// Pointer hit testing in MODEL space, over semantic layout records.
//
// A pointer lands somewhere on a sheet; this answers which text position the person meant.
// The answer comes from the records alone — line boxes, span boxes, cell boxes — with no DOM
// range, no element rectangle and no remeasurement of painted output. That is what makes the
// behaviour identical between adapters and provable headlessly.
//
// The rules it encodes are the ones a word processor is expected to follow, and every one of
// them is about a point that is NOT on a glyph:
//
//   - left of a line's first glyph (an indent, a margin, a cell's left padding) is the START
//     of that line, not "nothing";
//   - right of its last glyph is the END of that line;
//   - above the first line or below the last line of a block clamps into that block;
//   - a click in a margin belongs to the block it is LEVEL with, not the one it is nearest in
//     a straight line — vertical distance is weighted so that "beside a short line" beats
//     "below a long one";
//   - the gutter between two sheets belongs to the sheet above it, whose last line is the
//     nearest text.
//
// Refusing to answer is never right: a click has to put the caret somewhere, and returning
// null makes it do nothing at all.

import { segmentGraphemes } from './grapheme.ts';
import type { CaretGeometry, SemanticPosition } from './semantic-interaction.ts';
import type {
  BlockFragmentRecord,
  LayoutBox,
  LineRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  StyleSpanRecord,
  TableCellFragmentRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
  TextMeasurer,
} from './semantic-records.ts';

/** A point in the coordinate space named by the function taking it. */
export interface HitPoint {
  readonly x: number;
  readonly y: number;
}

/** The innermost table cell a point resolved through. */
export interface TableCellAddress {
  /** Canonical node id of the `w:tbl`. */
  readonly tableId: string;
  /** Canonical node id of the `w:tr`. */
  readonly rowId: string;
  /** Canonical node id of the `w:tc`. */
  readonly cellId: string;
  /** Ordinal in the WHOLE table, stable across fragments and header repeats. */
  readonly rowIndex: number;
  readonly gridColumn: number;
  readonly gridSpan: number;
}

export interface SemanticHit {
  readonly position: SemanticPosition;
  readonly caret: CaretGeometry;
  readonly pageIndex: number;
  readonly lineId: string;
  /** Null outside a table; the innermost cell when tables nest. */
  readonly cell: TableCellAddress | null;
  /**
   * True when the point was inside the resolved line's box AND inside one of its spans.
   *
   * A caller distinguishing a click ON text from a click BESIDE it — to decide whether to
   * claim the gesture at all — needs this, and cannot recover it from the position.
   */
  readonly onGlyphs: boolean;
}

export interface HitTestOptions {
  /**
   * Exact resolution of the character within a run.
   *
   * Absent, the offset is interpolated across the span's own advance, which is exact only for
   * a uniform advance. Pass the measurer layout was produced with, or the answer can disagree
   * with what was painted.
   */
  readonly measurer?: TextMeasurer;
  /** Vertical weight for the nearest-block rule. */
  readonly verticalWeight?: number;
}

/**
 * How much more a point of vertical distance counts than a point of horizontal distance.
 *
 * Without it, clicking far out in the right margin beside a two-word line picks whichever
 * block happens to be directly below, because that block is horizontally nearer. Weighting
 * the vertical axis makes "the line I am level with" win, which is what the pointer meant.
 */
export const DEFAULT_VERTICAL_WEIGHT = 8;

interface HitContext {
  readonly layout: SemanticLayout;
  readonly pageIndex: number;
  readonly verticalWeight: number;
  readonly measurer: TextMeasurer | undefined;
}

// ---------------------------------------------------------------------------------------
// Per-layout index
// ---------------------------------------------------------------------------------------

interface LayoutHitIndex {
  /** Sheet-space top of each page, ascending — binary searched by `pageAtY`. */
  readonly pageTops: readonly number[];
  /** Row ordinal within its own table, by `w:tr` node id. */
  readonly rowIndexById: ReadonlyMap<string, number>;
  /** The id of the LAST line each paragraph occupies, for the soft-wrap end rule. */
  readonly lastLineIdOfParagraph: ReadonlyMap<string, string>;
}

/**
 * Built once per layout, not once per hit test.
 *
 * A published layout is immutable — a new revision is a new object — so a `WeakMap` keyed on
 * it is sound and collects with it. This matters because hit testing runs on every pointer
 * move of a drag: anything O(document) per call would make dragging through a long document
 * quadratic in its length.
 */
const hitIndexCache = new WeakMap<SemanticLayout, LayoutHitIndex>();

function hitIndex(layout: SemanticLayout): LayoutHitIndex {
  const cached = hitIndexCache.get(layout);
  if (cached) return cached;

  const pageTops: number[] = [];
  const rowIndexById = new Map<string, number>();
  const lastLineIdOfParagraph = new Map<string, string>();
  const rowsSeenPerTable = new Map<string, number>();

  const visitBlocks = (blocks: readonly BlockFragmentRecord[]): void => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        for (const line of block.lines) lastLineIdOfParagraph.set(line.range.paragraphId, line.id);
        continue;
      }
      for (const row of block.rows) {
        // A header row re-emitted on a continuation page is the SAME row: it must not consume
        // an ordinal, or every row below it would be numbered one too high.
        if (!row.isHeaderRepeat && !rowIndexById.has(row.id)) {
          const next = rowsSeenPerTable.get(block.tableId) ?? 0;
          rowIndexById.set(row.id, next);
          rowsSeenPerTable.set(block.tableId, next + 1);
        }
        for (const cell of row.cells) visitBlocks(cell.blocks);
      }
    }
  };

  for (const page of layout.pages) {
    pageTops.push(page.box.y);
    visitBlocks(page.fragments);
  }

  const index: LayoutHitIndex = { pageTops, rowIndexById, lastLineIdOfParagraph };
  hitIndexCache.set(layout, index);
  return index;
}

// ---------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------

/**
 * The page a sheet-space y belongs to.
 *
 * The gutter between page *i* and page *i+1* resolves to page *i*, because the nearest text
 * to a point in that gap is the last line of the page above it. That falls out of searching
 * for the last page whose top is at or above the point, with no special case: the gutter is
 * inside `[top(i), top(i+1))` by construction. A point above the first page clamps to it, and
 * a point past the last page clamps to that.
 */
export function pageAtY(layout: SemanticLayout, sheetY: number): number {
  const tops = hitIndex(layout).pageTops;
  if (tops.length === 0) return -1;
  let low = 0;
  let high = tops.length - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (tops[mid]! <= sheetY) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** True when a sheet-space point falls inside a page's header or footer box. */
export function isFurniturePoint(layout: SemanticLayout, point: HitPoint): boolean {
  const page = layout.pages[pageAtY(layout, point.y)];
  if (!page) return false;
  for (const story of [page.header, page.footer]) {
    if (story && contains(story.box, point)) return true;
  }
  return false;
}

/** Hit test a point given in PAGE-CONTENT coordinates, the space the fragment boxes use. */
export function hitTestPage(
  layout: SemanticLayout,
  pageIndex: number,
  point: HitPoint,
  options: HitTestOptions = {}
): SemanticHit | null {
  const page = layout.pages[pageIndex];
  if (!page) return null;
  const context: HitContext = {
    layout,
    pageIndex: page.index,
    verticalWeight: options.verticalWeight ?? DEFAULT_VERTICAL_WEIGHT,
    measurer: options.measurer,
  };
  return resolveBlocks(page.fragments, point, context, null);
}

/**
 * Hit test a point given in SHEET coordinates — the space `page.box` lives in, and the space
 * a surface's own pixel offsets convert into.
 */
export function hitTestSheet(
  layout: SemanticLayout,
  point: HitPoint,
  options: HitTestOptions = {}
): SemanticHit | null {
  const page = layout.pages[pageAtY(layout, point.y)];
  if (!page) return null;
  return hitTestPage(
    layout,
    page.index,
    { x: point.x - page.contentBox.x, y: point.y - page.contentBox.y },
    options
  );
}

// ---------------------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------------------

function contains(box: LayoutBox, point: HitPoint): boolean {
  return (
    point.x >= box.x &&
    point.x < box.x + box.width &&
    point.y >= box.y &&
    point.y < box.y + box.height
  );
}

/** Distance from a point to a box, with the vertical axis weighted. Zero means inside. */
function weightedDistance(box: LayoutBox, point: HitPoint, verticalWeight: number): number {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.width));
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.height));
  return dx + dy * verticalWeight;
}

/**
 * The block a point means, then the position within it.
 *
 * A paragraph's box starts at its left INDENT, so the indent strip — the most common place to
 * click when aiming at the start of a line — is outside every box on the page. Nearest-box
 * with a weighted vertical axis is what recovers the intended paragraph there.
 */
function resolveBlocks(
  blocks: readonly BlockFragmentRecord[],
  point: HitPoint,
  context: HitContext,
  cell: TableCellAddress | null
): SemanticHit | null {
  // Containment first, and HALF-OPEN, so a point exactly on the edge two stacked blocks share
  // belongs to the lower one — the same rule the line bands use, decided by construction
  // rather than by a tolerance. Distance alone cannot express it: the shared edge is zero
  // away from both boxes, and first-wins would silently hand it to the block above.
  for (const block of blocks) {
    if (!contains(block.box, point)) continue;
    return block.kind === 'paragraph'
      ? resolveParagraph(block, point, context, cell, true)
      : resolveTable(block, point, context, cell);
  }

  let best: BlockFragmentRecord | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const block of blocks) {
    const score = weightedDistance(block.box, point, context.verticalWeight);
    if (score < bestScore) {
      bestScore = score;
      best = block;
    }
  }
  if (!best) return null;
  return best.kind === 'paragraph'
    ? resolveParagraph(best, point, context, cell, false)
    : resolveTable(best, point, context, cell);
}

function resolveParagraph(
  fragment: ParagraphFragmentRecord,
  point: HitPoint,
  context: HitContext,
  cell: TableCellAddress | null,
  insideBox: boolean
): SemanticHit | null {
  const line = lineAtY(fragment.lines, point.y);
  if (!line) return null;
  const resolved = offsetOnLine(line, point.x, context);
  const position: SemanticPosition = {
    paragraphId: line.range.paragraphId,
    offset: resolved.offset,
  };
  return {
    position,
    caret: {
      position,
      x: resolved.x,
      y: line.box.y,
      height: line.box.height,
      lineId: line.id,
      pageIndex: context.pageIndex,
    },
    pageIndex: context.pageIndex,
    lineId: line.id,
    cell,
    onGlyphs: insideBox && resolved.withinSpan,
  };
}

/**
 * The line a y belongs to, clamped into the fragment.
 *
 * Banding here is purely vertical and never weighted: lines within one paragraph are stacked,
 * so letting horizontal distance participate would let a long line two rows down outvote the
 * short one the pointer is actually level with. Bands are half-open, so a point exactly on a
 * shared edge belongs to the lower line with no epsilon anywhere.
 */
function lineAtY(lines: readonly LineRecord[], y: number): LineRecord | null {
  if (lines.length === 0) return null;
  for (const line of lines) {
    if (y >= line.box.y && y < line.box.y + line.box.height) return line;
  }
  // Between lines, above the first, or below the last: the nearest band, earliest on a tie.
  // This is the clamp that makes a click in the whitespace under a paragraph land at its end
  // rather than doing nothing.
  let best = lines[0]!;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    const gap = y < line.box.y ? line.box.y - y : y - (line.box.y + line.box.height);
    if (gap < bestGap) {
      bestGap = gap;
      best = line;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------
// Within a line
// ---------------------------------------------------------------------------------------

interface LineOffset {
  readonly offset: number;
  readonly x: number;
  /** False when the point was outside every span — a margin, an indent, a justification gap. */
  readonly withinSpan: boolean;
}

/**
 * Where on a line an x means.
 *
 * SPAN boxes are the authority, never `line.box.x`: alignment is baked into the span boxes, so
 * a centred or right-aligned line starts well right of its line box and using the line box
 * would report every such click as "left of the line".
 */
function offsetOnLine(line: LineRecord, x: number, context: HitContext): LineOffset {
  const spans = line.spans;
  if (spans.length === 0) {
    // An empty paragraph still has a position to click into.
    return { offset: line.range.start, x: line.box.x, withinSpan: false };
  }

  const first = spans[0]!;
  if (x <= first.box.x) return { offset: line.range.start, x: first.box.x, withinSpan: false };

  const last = spans[spans.length - 1]!;
  const rightEdge = last.box.x + last.box.width;
  if (x >= rightEdge) return endOfLine(line, rightEdge, context);

  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index]!;
    if (x < span.box.x) {
      // Justified text carries its slack in the gaps BETWEEN spans, so a point can be inside
      // the line and inside no span. Take the nearer edge rather than inventing a position.
      const previous = spans[index - 1]!;
      const previousRight = previous.box.x + previous.box.width;
      return x - previousRight <= span.box.x - x
        ? { offset: previous.range.end, x: previousRight, withinSpan: false }
        : { offset: span.range.start, x: span.box.x, withinSpan: false };
    }
    if (x < span.box.x + span.box.width) return offsetWithinSpan(span, x, context);
  }
  return endOfLine(line, rightEdge, context);
}

function endOfLine(line: LineRecord, rightEdge: number, context: HitContext): LineOffset {
  const offset = lineEndOffset(context.layout, line);
  if (offset === line.range.end) return { offset, x: rightEdge, withinSpan: false };
  // The end moved back over a trailing space, so the caret's x has to move back with it.
  const last = line.spans[line.spans.length - 1];
  if (!last || offset < last.range.start) return { offset, x: rightEdge, withinSpan: false };
  const width = context.measurer
    ? prefixWidth(last, offset - last.range.start, context.measurer)
    : last.box.width *
      (last.range.end > last.range.start
        ? (offset - last.range.start) / (last.range.end - last.range.start)
        : 0);
  return { offset, x: last.box.x + width, withinSpan: false };
}

/**
 * The end position of a line, as Word places it.
 *
 * On a SOFT-WRAPPED line the space that caused the break is painted at the end of the line
 * but the caret belongs before it — otherwise clicking in the right margin puts the caret
 * visually at the start of the NEXT line, which reads as the click having missed. The last
 * line of a paragraph has no such space to discount.
 */
export function lineEndOffset(layout: SemanticLayout, line: LineRecord): number {
  if (hitIndex(layout).lastLineIdOfParagraph.get(line.range.paragraphId) === line.id) {
    return line.range.end;
  }
  let offset = line.range.end;
  while (offset > line.range.start && characterAt(line, offset - 1) === ' ') offset -= 1;
  return offset;
}

/** The character at a model offset, or null when the span's text is not a 1:1 projection. */
function characterAt(line: LineRecord, offset: number): string | null {
  for (const span of line.spans) {
    if (offset < span.range.start || offset >= span.range.end) continue;
    // A span whose painted text is a substitution (a tab, a field result) does not map offset
    // to index, and guessing would trim a character that is not a space at all.
    if (span.text.length !== span.range.end - span.range.start) return null;
    return span.text[offset - span.range.start] ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Within a span
// ---------------------------------------------------------------------------------------

const boundaryCache = new WeakMap<StyleSpanRecord, readonly number[]>();
const prefixCache = new WeakMap<StyleSpanRecord, Map<number, number>>();

/** Grapheme boundaries of a span's text, as UTF-16 offsets within it. */
function boundariesOf(span: StyleSpanRecord): readonly number[] {
  const cached = boundaryCache.get(span);
  if (cached) return cached;
  const boundaries: number[] = [0];
  for (const segment of segmentGraphemes(span.text)) boundaries.push(segment.utf16To);
  if (boundaries[boundaries.length - 1] !== span.text.length) boundaries.push(span.text.length);
  boundaryCache.set(span, boundaries);
  return boundaries;
}

/**
 * Advance width of a span's first `utf16` code units.
 *
 * Memoized per span record as well as inside the measurer, because a drag re-crosses the same
 * span dozens of times and the binary search asks for the same handful of boundaries each
 * time. The record is immutable and retained by the layout, so the entry lives exactly as long
 * as the geometry it describes.
 */
function prefixWidth(span: StyleSpanRecord, utf16: number, measurer: TextMeasurer): number {
  let widths = prefixCache.get(span);
  if (!widths) {
    widths = new Map<number, number>();
    prefixCache.set(span, widths);
  }
  const cached = widths.get(utf16);
  if (cached !== undefined) return cached;
  const width = utf16 <= 0 ? 0 : measurer.measure(span.text.slice(0, utf16), span.style);
  widths.set(utf16, width);
  return width;
}

function offsetWithinSpan(span: StyleSpanRecord, x: number, context: HitContext): LineOffset {
  const target = x - span.box.x;
  const length = span.range.end - span.range.start;

  // A span whose painted text is not a 1:1 projection of its model range is an ATOM — a tab, a
  // field result. The caret goes before it or after it, never inside, so the midpoint decides.
  if (length <= 0 || span.text.length !== length) {
    const after = target > span.box.width / 2;
    return {
      offset: after ? span.range.end : span.range.start,
      x: after ? span.box.x + span.box.width : span.box.x,
      withinSpan: true,
    };
  }

  if (!context.measurer) {
    // No measurer: interpolate across the span's own advance. Exact for a uniform advance and
    // honestly approximate otherwise, rather than pretending to per-glyph precision.
    const fraction = Math.max(0, Math.min(1, target / Math.max(span.box.width, Number.EPSILON)));
    const raw = Math.round(fraction * length);
    const boundaries = boundariesOf(span);
    let snapped = boundaries[0]!;
    let snappedGap = Number.POSITIVE_INFINITY;
    for (const boundary of boundaries) {
      const gap = Math.abs(boundary - raw);
      if (gap < snappedGap) {
        snappedGap = gap;
        snapped = boundary;
      }
    }
    return {
      offset: span.range.start + snapped,
      x: span.box.x + span.box.width * (snapped / length),
      withinSpan: true,
    };
  }

  const boundaries = boundariesOf(span);
  // Smallest boundary whose prefix width reaches the target, then the nearer of it and the one
  // before. Ties go to the EARLIER boundary so the answer is stable rather than decided by
  // float noise, and a grapheme cluster is never split.
  let low = 1;
  let high = boundaries.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (prefixWidth(span, boundaries[mid]!, context.measurer) < target) low = mid + 1;
    else high = mid;
  }
  const right = boundaries[low]!;
  const left = boundaries[low - 1]!;
  const rightWidth = prefixWidth(span, right, context.measurer);
  const leftWidth = prefixWidth(span, left, context.measurer);
  const takeLeft = target - leftWidth <= rightWidth - target;
  return {
    offset: span.range.start + (takeLeft ? left : right),
    x: span.box.x + (takeLeft ? leftWidth : rightWidth),
    withinSpan: true,
  };
}

// ---------------------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------------------

/**
 * The item whose half-open band contains `coordinate`, else the nearest, earliest on a tie.
 *
 * Used for both rows and columns, which need the same clamp for the same reason: a point in
 * the gap between two rows, or past the last column, still names one of them.
 */
function bandSelect<T>(
  items: readonly T[],
  coordinate: number,
  start: (item: T) => number,
  size: (item: T) => number
): T | null {
  if (items.length === 0) return null;
  for (const item of items) {
    const from = start(item);
    if (coordinate >= from && coordinate < from + size(item)) return item;
  }
  let best: T = items[0] as T;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const from = start(item);
    const gap = coordinate < from ? from - coordinate : coordinate - (from + size(item));
    if (gap < bestGap) {
      bestGap = gap;
      best = item;
    }
  }
  return best;
}

function addressOf(
  layout: SemanticLayout,
  table: TableFragmentRecord,
  row: TableRowFragmentRecord,
  cell: TableCellFragmentRecord
): TableCellAddress {
  return {
    tableId: table.tableId,
    rowId: row.id,
    cellId: cell.id,
    rowIndex: hitIndex(layout).rowIndexById.get(row.id) ?? 0,
    gridColumn: cell.gridColumn,
    gridSpan: cell.gridSpan,
  };
}

/**
 * The cell a vertical-merge continuation is a continuation OF.
 *
 * A continuation paints its box but holds no blocks, so resolving into it directly would find
 * no paragraph and fall through to "somewhere else on the page". Walking up to the origin puts
 * the caret in the text that is actually drawn in that visual cell. When the origin began on a
 * previous page there is nothing above to find, and the continuation stands.
 */
function mergeOrigin(
  table: TableFragmentRecord,
  row: TableRowFragmentRecord,
  cell: TableCellFragmentRecord
): { row: TableRowFragmentRecord; cell: TableCellFragmentRecord } {
  const rowAt = table.rows.indexOf(row);
  for (let index = rowAt - 1; index >= 0; index -= 1) {
    const above = table.rows[index]!;
    if (above.isHeaderRepeat) continue;
    for (const candidate of above.cells) {
      if (candidate.gridColumn !== cell.gridColumn) continue;
      if (!candidate.vMergeContinue) return { row: above, cell: candidate };
      break;
    }
  }
  return { row, cell };
}

function resolveTable(
  table: TableFragmentRecord,
  point: HitPoint,
  context: HitContext,
  outerCell: TableCellAddress | null
): SemanticHit | null {
  const row = bandSelect(
    table.rows,
    point.y,
    (item) => item.box.y,
    (item) => item.box.height
  );
  if (!row) return resolveBlocks([], point, context, outerCell);
  const hitCell = bandSelect(
    row.cells,
    point.x,
    (item) => item.box.x,
    (item) => item.box.width
  );
  if (!hitCell) return null;

  const origin = hitCell.vMergeContinue ? mergeOrigin(table, row, hitCell) : { row, cell: hitCell };
  const address = addressOf(context.layout, table, origin.row, origin.cell);
  // Recursing with the SAME point is what makes cell padding work with no rule of its own: the
  // padding is outside every block box, so the nearest-block rule picks the block beside it and
  // the line clamp finishes the job — bottom padding lands at the end of the last block.
  const inside = resolveBlocks(origin.cell.blocks, point, context, address);
  if (inside) return inside;

  // An empty cell, or a merge whose origin is on an earlier page: fall back to the nearest cell
  // in this fragment that actually holds text, so the click still puts the caret somewhere.
  return resolveNearestFilledCell(table, point, context);
}

function resolveNearestFilledCell(
  table: TableFragmentRecord,
  point: HitPoint,
  context: HitContext
): SemanticHit | null {
  let bestRow: TableRowFragmentRecord | null = null;
  let bestCell: TableCellFragmentRecord | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const row of table.rows) {
    for (const cell of row.cells) {
      if (cell.blocks.length === 0) continue;
      const score = weightedDistance(cell.box, point, context.verticalWeight);
      if (score < bestScore) {
        bestScore = score;
        bestRow = row;
        bestCell = cell;
      }
    }
  }
  if (!bestRow || !bestCell) return null;
  return resolveBlocks(
    bestCell.blocks,
    point,
    context,
    addressOf(context.layout, table, bestRow, bestCell)
  );
}
