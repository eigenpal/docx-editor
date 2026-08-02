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

import { graphemeBoundaryEpoch, segmentGraphemes } from './grapheme.ts';
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
  /**
   * The cell a vertical-merge continuation continues, for every continuation in the layout.
   *
   * Built across ALL pages, because a merged run routinely starts on one page and continues
   * on the next: a fragment-local walk finds nothing there and the click resolves into
   * whatever cell happens to be nearest — a different column.
   */
  readonly mergeOriginOf: ReadonlyMap<TableCellFragmentRecord, MergedCellOrigin>;
}

interface MergedCellOrigin {
  readonly row: TableRowFragmentRecord;
  readonly cell: TableCellFragmentRecord;
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
  const mergeOriginOf = new Map<TableCellFragmentRecord, MergedCellOrigin>();
  /** The most recent non-continuation cell per table column, in document order. */
  const openMerge = new Map<string, MergedCellOrigin>();

  const visitBlocks = (blocks: readonly BlockFragmentRecord[], inHeaderRepeat: boolean): void => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        // A repeated header row re-emits the SAME paragraph ids with DIFFERENT line ids, so
        // letting it write here leaves every earlier page's copy looking like it soft-wrapped
        // — and the end of that line becomes unreachable.
        if (!inHeaderRepeat) {
          for (const line of block.lines) {
            lastLineIdOfParagraph.set(line.range.paragraphId, line.id);
          }
        }
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
        for (const cell of row.cells) {
          // Repeats are copies, so they neither open a merge nor continue one.
          if (!row.isHeaderRepeat && !inHeaderRepeat) {
            const column = `${block.tableId}|${cell.gridColumn}`;
            // Keyed on what matters — this cell paints nothing — rather than on any one of
            // the flags layout uses to say so. A merge re-opened on a continuation page
            // reports `vMergeContinue: false` and still holds no blocks, so testing the flag
            // alone left exactly the cells that need an origin without one.
            if (cell.blocks.length === 0) {
              const origin = openMerge.get(column);
              if (origin) mergeOriginOf.set(cell, origin);
            } else {
              openMerge.set(column, { row, cell });
            }
          }
          visitBlocks(cell.blocks, inHeaderRepeat || row.isHeaderRepeat);
        }
      }
    }
  };

  for (const page of layout.pages) {
    pageTops.push(page.box.y);
    visitBlocks(page.fragments, false);
  }

  const index: LayoutHitIndex = {
    pageTops,
    rowIndexById,
    lastLineIdOfParagraph,
    mergeOriginOf,
  };
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
  const hit = resolveBlocks(page.fragments, point, context, null);
  if (hit) return hit;

  // This page paints no reachable text — a run of vertical-merge continuations whose origin
  // is pages back, or a table fragment carrying nothing at all. A press still has to land
  // somewhere, so walk outward to the nearest page that does hold text. Only ever reached on
  // a page that would otherwise be a dead click.
  for (let distance = 1; distance < layout.pages.length; distance += 1) {
    for (const index of [pageIndex - distance, pageIndex + distance]) {
      const neighbour = layout.pages[index];
      if (!neighbour) continue;
      const found = resolveBlocks(
        neighbour.fragments,
        point,
        { ...context, pageIndex: neighbour.index },
        null
      );
      if (found) return found;
    }
  }
  return null;
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
  if (blocks.length === 0) return null;

  // Containment first, and HALF-OPEN, so a point exactly on the edge two stacked blocks share
  // belongs to the lower one — the same rule the line bands use, decided by construction
  // rather than by a tolerance. Distance alone cannot express it: the shared edge is zero
  // away from both boxes, and first-wins would silently hand it to the block above.
  let contained: BlockFragmentRecord | null = null;
  for (const block of blocks) {
    if (!contains(block.box, point)) continue;
    contained = block;
    const hit = resolveOneBlock(block, point, context, cell);
    if (hit) return hit;
    break;
  }

  // Nearest-first, and it keeps going. A block CAN fail to answer — a table fragment that
  // paints nothing but vertical-merge continuations holds no text at all — and stopping at
  // the first refusal is what turned those pages into dead clicks, which is never the right
  // answer for a press.
  const ranked = blocks
    .filter((block) => block !== contained)
    .map((block) => ({ block, score: weightedDistance(block.box, point, context.verticalWeight) }))
    .sort((left, right) => left.score - right.score);
  for (const { block } of ranked) {
    const hit = resolveOneBlock(block, point, context, cell);
    if (hit) return hit;
  }
  return null;
}

function resolveOneBlock(
  block: BlockFragmentRecord,
  point: HitPoint,
  context: HitContext,
  cell: TableCellAddress | null
): SemanticHit | null {
  return block.kind === 'paragraph'
    ? resolveParagraph(block, point, context, cell, contains(block.box, point))
    : resolveTable(block, point, context, cell);
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
  const box = caretBoxOnLine(line, resolved.offset, context.measurer);
  return {
    position,
    caret: {
      position,
      x: resolved.x,
      y: box.y,
      height: box.height,
      lineId: line.id,
      pageIndex: context.pageIndex,
    },
    pageIndex: context.pageIndex,
    lineId: line.id,
    cell,
    // The LINE's band, not the block's: a paragraph with trailing space is taller than its
    // text, and a point in that space is not on a glyph however far inside the block it is.
    onGlyphs:
      insideBox &&
      resolved.withinSpan &&
      point.y >= line.box.y &&
      point.y < line.box.y + line.box.height,
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
  // The end moved back over trailing space, so the caret's x moves back with it — into
  // whichever span now CONTAINS that offset. Assuming the last span holds it paints the caret
  // at the far right edge whenever two runs each contributed one trailing space, which is
  // ordinary in text a producer split on revision ids.
  for (let index = line.spans.length - 1; index >= 0; index -= 1) {
    const span = line.spans[index]!;
    if (offset < span.range.start) continue;
    const within = offset - span.range.start;
    const width = context.measurer
      ? prefixWidth(span, within, context.measurer)
      : span.box.width *
        (span.range.end > span.range.start ? within / (span.range.end - span.range.start) : 0);
    return { offset, x: span.box.x + width, withinSpan: false };
  }
  return { offset, x: rightEdge, withinSpan: false };
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

const boundaryCache = new WeakMap<
  StyleSpanRecord,
  { epoch: number; boundaries: readonly number[] }
>();
/**
 * Keyed on the MEASURER first.
 *
 * Widths depend on who measured, so a cache keyed on the span alone serves the first
 * measurer's numbers to every later one — and two ports over one layout is exactly what a
 * second surface, or a headless probe, does.
 */
const prefixCache = new WeakMap<TextMeasurer, WeakMap<StyleSpanRecord, Map<number, number>>>();

/** Grapheme boundaries of a span's text, as UTF-16 offsets within it. */
function boundariesOf(span: StyleSpanRecord): readonly number[] {
  // Segmentation is replaceable, and `grapheme.ts` states the rule: a cache whose value
  // depends on it must carry the epoch in its key rather than trust anyone to clear it.
  const epoch = graphemeBoundaryEpoch();
  const cached = boundaryCache.get(span);
  if (cached && cached.epoch === epoch) return cached.boundaries;
  const boundaries: number[] = [0];
  for (const segment of segmentGraphemes(span.text)) boundaries.push(segment.utf16To);
  if (boundaries[boundaries.length - 1] !== span.text.length) boundaries.push(span.text.length);
  boundaryCache.set(span, { epoch, boundaries });
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
  let perSpan = prefixCache.get(measurer);
  if (!perSpan) {
    perSpan = new WeakMap<StyleSpanRecord, Map<number, number>>();
    prefixCache.set(measurer, perSpan);
  }
  let widths = perSpan.get(span);
  if (!widths) {
    widths = new Map<number, number>();
    perSpan.set(span, widths);
  }
  const cached = widths.get(utf16);
  if (cached !== undefined) return cached;
  const width = utf16 <= 0 ? 0 : measurer.measure(span.text.slice(0, utf16), span.style);
  widths.set(utf16, width);
  return width;
}

/**
 * The x of a model offset inside a span — the inverse of {@link offsetWithinSpan}.
 *
 * Shares the measurement, and the cache, with the hit test. Interpolating across the span's
 * advance instead is exact only for a uniform one: in a proportional face the caret for
 * offset 4 of an 8-character span is drawn at half its width, which lands in the middle of a
 * glyph rather than between two.
 */
export function spanOffsetX(
  span: StyleSpanRecord,
  offset: number,
  measurer: TextMeasurer | undefined
): number {
  const length = span.range.end - span.range.start;
  if (length <= 0) return span.box.x;
  const within = Math.max(0, Math.min(offset - span.range.start, length));
  if (!measurer || span.text.length !== length) {
    return span.box.x + span.box.width * (within / length);
  }
  return span.box.x + prefixWidth(span, within, measurer);
}

/**
 * Where a caret sits on a line: its x, and the box it should be drawn at.
 *
 * The height comes from the RUN at the insertion point, not from the line. A line is as tall
 * as its largest run, so a caret in 11pt text on a line that also carries 36pt text was drawn
 * three times the height of the text it sits in. Word sizes the insertion point to the run it
 * would type into, which is also how the painter already draws the selection band: every run
 * is its own inline box, and the band steps with the text.
 *
 * At a boundary the run BEFORE the offset wins — that is the run a keystroke would continue —
 * except at the start of the line, where there is nothing before it.
 */
export function caretBoxOnLine(
  line: LineRecord,
  offset: number,
  measurer: TextMeasurer | undefined
): { x: number; y: number; height: number } {
  const spans = line.spans;
  if (spans.length === 0) {
    return { x: line.box.x, y: line.box.y, height: line.box.height };
  }
  let chosen = spans[0]!;
  for (const span of spans) {
    if (offset > span.range.start && offset >= span.range.end) chosen = span;
    else if (offset > span.range.start && offset < span.range.end) {
      chosen = span;
      break;
    }
  }
  return {
    x: spanOffsetX(chosen, offset, measurer),
    // A zero-height span would leave no caret at all; the line is the honest floor.
    y: chosen.box.height > 0 ? chosen.box.y : line.box.y,
    height: chosen.box.height > 0 ? chosen.box.height : line.box.height,
  };
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

function resolveTable(
  table: TableFragmentRecord,
  point: HitPoint,
  context: HitContext,
  outerCell: TableCellAddress | null
): SemanticHit | null {
  void outerCell;
  // A repeated header row is a COPY. Its paragraphs already have caret stops on the page the
  // original sits on, and resolving into one returns a position whose caret and selection
  // paint there instead of where the click was — so interaction ignores repeats, exactly as
  // the records say it should. A fragment that is nothing BUT repeats still has to answer.
  const authored = table.rows.filter((row) => !row.isHeaderRepeat);
  const rows = authored.length > 0 ? authored : table.rows;

  const candidates: MergedCellOrigin[] = [];
  const row = bandSelect(
    rows,
    point.y,
    (item) => item.box.y,
    (item) => item.box.height
  );
  if (row) {
    const hitCell = bandSelect(
      row.cells,
      point.x,
      (item) => item.box.x,
      (item) => item.box.width
    );
    // A continuation paints its box but holds no blocks, so resolving into it directly would
    // find no paragraph. Its origin may be on an EARLIER PAGE, which is why the index tracks
    // merges across the whole layout rather than within this fragment.
    if (hitCell) candidates.push(originOf(context, row, hitCell));
  }

  // Then every other cell that actually holds something, nearest first — an empty cell, or a
  // merge whose origin this layout does not carry, must still put the caret somewhere.
  const rest: { entry: MergedCellOrigin; score: number }[] = [];
  for (const candidateRow of rows) {
    for (const cell of candidateRow.cells) {
      if (cell.blocks.length === 0) continue;
      if (candidates.some((entry) => entry.cell === cell)) continue;
      rest.push({
        entry: { row: candidateRow, cell },
        score: weightedDistance(cell.box, point, context.verticalWeight),
      });
    }
  }
  rest.sort((left, right) => left.score - right.score);

  for (const { row: cellRow, cell } of [...candidates, ...rest.map((item) => item.entry)]) {
    const address = addressOf(context.layout, table, cellRow, cell);
    // Recursing with the SAME point is what makes cell padding work with no rule of its own:
    // the padding is outside every block box, so the nearest-block rule picks the block beside
    // it and the line clamp finishes the job — bottom padding lands at the end of the last
    // block.
    const hit = resolveBlocks(cell.blocks, point, context, address);
    if (hit) return hit;
  }
  // This fragment paints no text at all. The caller keeps looking.
  return null;
}

/** The cell whose text is drawn in a cell's box: itself, or the merge it continues. */
function originOf(
  context: HitContext,
  row: TableRowFragmentRecord,
  cell: TableCellFragmentRecord
): MergedCellOrigin {
  if (cell.blocks.length > 0) return { row, cell };
  return hitIndex(context.layout).mergeOriginOf.get(cell) ?? { row, cell };
}
