// Table row and cell layout over the canonical tree.
//
// Row, cell, and nested-table flow operate on typed tree nodes with the injected
// TextMeasurer and emit semantic records:
//
//   - a row is laid out in TWO PASSES — every cell flows into a buffer while the tallest
//     bottom is tracked, then every cell box is emitted at the final row height;
//   - a vMerge continuation emits its box but no content, so text is never duplicated;
//   - after all rows of a fragment are placed, vertical merges expand the restart box,
//     vAlign shifts content, and collapsed borders resolve onto layout-owned edges;
//   - top-level table rows paginate with a real-height preflight: an unsplit row that does
//     not fit moves to the next page; a row taller than a fresh page fragments at
//     paragraph/line boundaries when splittable, or fails closed under w:cantSplit /
//     unsupported nested cuts;
//   - a NESTED table lays out with its own geometry inside the cell box, no pagination.
//
// All coordinates are points, relative to the page content box — exactly the space body
// paragraph fragments already live in. Cell paragraph breaks go through the shared
// `breakParagraph`, so they hit the same cache with keys at the cell's content width.
/* eslint-disable max-lines -- bounded row-split pagination stays with cell flow and finalize */

import type { OoxmlElement } from '@docx-editor.dev/core-contract/store';
import type { FieldPageContext } from './field-projection.ts';
import { paragraphLayoutKey, type ParagraphLayoutCache } from './layout-cache.ts';
import { alignSpans, breakParagraph, type PendingLine } from './paragraph-flow.ts';
import { collapsedSpaceBefore } from './paragraph-style.ts';
import { DEFAULT_RUN_STYLE } from './run-style.ts';
import {
  resolveParagraphLayoutInputs,
  cascadeRunProperties,
  type StyleCascadeTable,
} from './style-cascade.ts';
import { paragraphShadingBox } from './ooxml-shading.ts';
import {
  CELL_PAD,
  MAX_TABLE_NESTING,
  readTableStructure,
  type CellMarginsPt,
  type SemanticTableCell,
  type SemanticTableRow,
  type SemanticTableStructure,
} from './semantic-table.ts';
import type {
  BlockFragmentRecord,
  LineRecord,
  ParagraphBottomBorderRecord,
  ParagraphFragmentRecord,
  TableCellFragmentRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
  TextMeasurer,
} from './semantic-records.ts';
import type { ResolvedListItem } from './list-resolve.ts';
import { publishListMarker } from './list-marker.ts';
import {
  borderExtentPt,
  resolveTableCellBorderGrid,
  type BorderGridCell,
  type BorderGridGeometry,
  type CellBorderBox,
  type TableBorderBox,
  type TableBorderOwnershipBudget,
} from './table-borders.ts';
import {
  resolveVMergeSpans,
  type TableVMergeResolveBudget,
  type TableVMergeResolveWork,
} from './table-vmerge.ts';

export {
  createTableBorderOwnershipBudget,
  MAX_BORDER_OWNERSHIP_INTERVALS,
} from './table-borders.ts';

export {
  createTableVMergeResolveBudget,
  MAX_VMERGE_RESOLVE_CELLS,
  resolveVMergeSpans,
  type TableVMergeResolveBudget,
  type TableVMergeResolveWork,
} from './table-vmerge.ts';

/** Soft ceiling on fragments emitted for one authored row (hostile / runaway splits). */
export const MAX_TABLE_ROW_FRAGMENTS = 4096;

export type TablePaginationErrorCode =
  | 'table-row-overheight'
  | 'table-row-split-unsupported'
  | 'table-row-fragment-limit';

/**
 * Bounded table pagination failure. Prefer this over emitting a fragment that overflows
 * the page content box.
 */
export class TablePaginationError extends Error {
  readonly code: TablePaginationErrorCode;
  constructor(code: TablePaginationErrorCode, message: string) {
    super(message);
    this.name = 'TablePaginationError';
    this.code = code;
  }
}

export interface TableFlowDeps {
  readonly measurer: TextMeasurer;
  readonly cache?: ParagraphLayoutCache<readonly PendingLine[]> | undefined;
  readonly producer: string;
  /** Line ids continue the document-wide counter, so records stay deterministic. */
  readonly nextLineId: () => string;
  readonly styleCascade?: StyleCascadeTable;
  /** When set (header/footer page projection), PAGE/NUMPAGES resolve against this context. */
  readonly pageContext?: FieldPageContext;
  /**
   * Precomputed body-story list items (including cell paragraphs). Absent for header/footer
   * stories that do not share the body counter stream.
   */
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
  /**
   * Shared sparse ownership-interval budget for border finalize across nested tables in
   * one layout pass. Created once per flow; omit only in isolated unit tests.
   */
  readonly borderOwnershipBudget?: TableBorderOwnershipBudget;
  /**
   * Shared cell-visit budget for vMerge span resolve across nested tables in one layout
   * pass. Exhaustion fails soft (remaining restarts keep rowSpan 1).
   */
  readonly vMergeResolveBudget?: TableVMergeResolveBudget;
}

/**
 * Per-cell progress through a row that may span pages. Indices are into the authored
 * cell.blocks list and the paragraph's broken lines — never DOM geometry.
 */
export interface CellPlaceCursor {
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly previousSpaceAfter: number;
  readonly paragraphFragmentIndex: number;
}

export function initialCellCursors(row: SemanticTableRow): CellPlaceCursor[] {
  return row.cells.map(() => ({
    blockIndex: 0,
    lineIndex: 0,
    previousSpaceAfter: 0,
    paragraphFragmentIndex: 0,
  }));
}

function sumCols(cols: readonly number[], from: number, to: number): number {
  let sum = 0;
  for (let index = from; index < to && index < cols.length; index += 1) sum += cols[index]!;
  return sum;
}

function shiftBlocks(blocks: readonly BlockFragmentRecord[], dy: number): BlockFragmentRecord[] {
  if (dy === 0) return [...blocks];
  return blocks.map((block) => {
    if (block.kind === 'table') {
      return {
        ...block,
        box: { ...block.box, y: block.box.y + dy },
        rows: block.rows.map((row) => ({
          ...row,
          box: { ...row.box, y: row.box.y + dy },
          cells: row.cells.map((cell) => ({
            ...cell,
            box: { ...cell.box, y: cell.box.y + dy },
            blocks: shiftBlocks(cell.blocks, dy),
          })),
        })),
      };
    }
    return {
      ...block,
      box: { ...block.box, y: block.box.y + dy },
      ...(block.shadingBox
        ? { shadingBox: { ...block.shadingBox, y: block.shadingBox.y + dy } }
        : {}),
      ...(block.bottomBorder
        ? {
            bottomBorder: {
              ...block.bottomBorder,
              box: { ...block.bottomBorder.box, y: block.bottomBorder.box.y + dy },
            },
          }
        : {}),
      ...(block.marker
        ? {
            marker: {
              ...block.marker,
              box: { ...block.marker.box, y: block.marker.box.y + dy },
            },
          }
        : {}),
      lines: block.lines.map((line) => ({
        ...line,
        box: { ...line.box, y: line.box.y + dy },
        spans: line.spans.map((span) => ({
          ...span,
          box: { ...span.box, y: span.box.y + dy },
        })),
      })),
    };
  });
}

/**
 * Place one paragraph's broken lines sequentially from `top`, producing a single fragment.
 *
 * The pending spans carry x offsets relative to the PARAGRAPH origin (that is what makes
 * the break cacheable across positions); placement shifts them by `originX` and stamps y,
 * exactly as body placement stamps `cursorY`.
 *
 * When `lineStart`/`maxBottom` are set, only lines that fit below `maxBottom` are placed and
 * the remainder line index is returned so a later page can continue the same paragraph.
 */
function placeCellParagraph(
  paragraph: OoxmlElement,
  originX: number,
  cellContentWidth: number,
  top: number,
  deps: TableFlowDeps,
  previousSpaceAfter: number,
  options?: {
    readonly lineStart?: number;
    readonly fragmentIndex?: number;
    readonly maxBottom?: number;
    /** When false, omit trailing paragraph spacing (more content follows on a later page). */
    readonly includeAfter?: boolean;
    /** When false, omit the bottom border (paragraph continues). */
    readonly includeBottomBorder?: boolean;
  }
): {
  readonly fragment: ParagraphFragmentRecord | null;
  readonly bottom: number;
  readonly spaceAfter: number;
  readonly nextLineIndex: number;
  readonly complete: boolean;
  readonly fitted: boolean;
} {
  const paragraphId = paragraph.id;
  const listItem = deps.listItems?.get(paragraphId);
  const {
    props,
    indent,
    available,
    alignment,
    spacing,
    lineSpacing,
    bottomBorder,
    shading,
    inheritedRunProperties,
    tabStops,
    tabStopsCacheToken,
  } = resolveParagraphLayoutInputs(paragraph, cellContentWidth, deps.styleCascade, listItem);
  // A cell paragraph breaks like a body paragraph: same line spacing, same first-line
  // offset. Contextual spacing is a body-flow question (it compares document neighbours),
  // so it is not applied per cell.
  const firstLineOffset = indent.hanging > 0 ? -indent.hanging : indent.firstLine;
  const key = paragraphLayoutKey({
    paragraph,
    properties: [
      ...props,
      ...inheritedRunProperties,
      { localName: 'tabStops', attributes: { token: tabStopsCacheToken } },
      ...(listItem ? [{ localName: 'list', attributes: { token: listItem.cacheToken } }] : []),
    ],
    width: available,
    producer: deps.producer,
  });
  const lines = breakParagraph(
    paragraph,
    paragraphId,
    indent.left,
    available,
    deps.measurer,
    deps.cache,
    deps.cache ? key : null,
    inheritedRunProperties,
    tabStops,
    deps.pageContext,
    deps.styleCascade
      ? (inherited, direct) => cascadeRunProperties(inherited, direct, deps.styleCascade)
      : undefined,
    { lineSpacing, firstLineOffset }
  );

  const lineStart = options?.lineStart ?? 0;
  const fragmentIndex = options?.fragmentIndex ?? 0;
  const maxBottom = options?.maxBottom ?? Number.POSITIVE_INFINITY;
  const includeAfter = options?.includeAfter ?? true;
  const includeBottomBorder = options?.includeBottomBorder ?? true;

  const appliedBefore =
    lineStart === 0 ? collapsedSpaceBefore(spacing.before, previousSpaceAfter) : 0;
  const records: LineRecord[] = [];
  let y = top + appliedBefore;
  let nextLineIndex = lineStart;
  let fitted = false;

  for (let lineIndex = lineStart; lineIndex < lines.length; lineIndex += 1) {
    const pendingLine = lines[lineIndex]!;
    const isLastLine = lineIndex === lines.length - 1;
    const borderExtra =
      isLastLine && includeBottomBorder && bottomBorder
        ? bottomBorder.spacePt + bottomBorder.widthPt
        : 0;
    const afterExtra = isLastLine && includeAfter ? spacing.after : 0;
    const lineBottom = y + pendingLine.height + borderExtra + afterExtra;
    if (lineBottom > maxBottom + 0.001) {
      break;
    }
    records.push({
      id: deps.nextLineId(),
      range: { paragraphId, start: pendingLine.start, end: pendingLine.end },
      spans: alignSpans(
        pendingLine.spans.map((span) => ({
          ...span,
          range: { ...span.range, paragraphId },
          box: { ...span.box, x: span.box.x + originX, y },
        })),
        deps.measurer,
        originX + indent.left + (lineIndex === 0 ? firstLineOffset : 0),
        Math.max(1, available - (lineIndex === 0 ? firstLineOffset : 0)),
        alignment,
        isLastLine
      ),
      box: {
        x: originX + indent.left,
        y,
        width: available,
        height: pendingLine.height,
      },
      baseline: pendingLine.baseline,
    });
    y += pendingLine.height;
    nextLineIndex = lineIndex + 1;
    fitted = true;
  }

  if (!fitted) {
    return {
      fragment: null,
      bottom: top,
      spaceAfter: previousSpaceAfter,
      nextLineIndex: lineStart,
      complete: false,
      fitted: false,
    };
  }

  const complete = nextLineIndex >= lines.length;
  const linesBottom = y;
  let bottomBorderRecord: ParagraphBottomBorderRecord | undefined;
  let contentBottom = linesBottom;
  if (complete && includeBottomBorder && bottomBorder) {
    const ruleY = linesBottom + bottomBorder.spacePt;
    bottomBorderRecord = {
      edge: bottomBorder,
      box: {
        x: originX + indent.left,
        y: ruleY,
        width: available,
        height: bottomBorder.widthPt,
      },
    };
    contentBottom = ruleY + bottomBorder.widthPt;
  }
  const appliedAfter = complete && includeAfter ? spacing.after : 0;
  const bottom = contentBottom + appliedAfter;
  const fragmentX = originX + indent.left;
  const shadingBox =
    shading === undefined ? undefined : paragraphShadingBox(records, fragmentX, available);
  const marker =
    lineStart === 0
      ? publishListMarker(
          listItem,
          deps.measurer,
          records[0] ? { y: records[0].box.y, height: records[0].box.height } : undefined,
          originX
        )
      : undefined;

  return {
    fragment: {
      kind: 'paragraph',
      id: `${paragraphId}#f${fragmentIndex}`,
      paragraphId,
      fragmentIndex,
      range: {
        paragraphId,
        start: records[0]!.range.start,
        end: records[records.length - 1]!.range.end,
      },
      props,
      spacing: { before: appliedBefore, after: appliedAfter },
      ...(bottomBorderRecord ? { bottomBorder: bottomBorderRecord } : {}),
      ...(shading === undefined ? {} : { shading }),
      ...(shadingBox === undefined ? {} : { shadingBox }),
      ...(marker ? { marker } : {}),
      lines: records,
      box: {
        x: fragmentX,
        y: top,
        width: available,
        height: bottom - top,
      },
    },
    bottom,
    spaceAfter: appliedAfter,
    nextLineIndex,
    complete,
    fitted: true,
  };
}

/**
 * Flow blocks within [left, right] from `top`; returns the fragments and the bottom y.
 * No pagination — blocks stack. Used for table cells and for header/footer stories,
 * which is exactly what makes a header break like a cell: same breaker, same records.
 */
export function flowBlocksInBox(
  blocks: readonly OoxmlElement[],
  left: number,
  right: number,
  top: number,
  depth: number,
  deps: TableFlowDeps
): { readonly blocks: BlockFragmentRecord[]; readonly bottom: number } {
  const bounded = flowBlocksInBoxBounded(
    blocks,
    left,
    right,
    top,
    Number.POSITIVE_INFINITY,
    depth,
    deps,
    {
      blockIndex: 0,
      lineIndex: 0,
      previousSpaceAfter: 0,
      paragraphFragmentIndex: 0,
    }
  );
  return { blocks: bounded.blocks, bottom: bounded.bottom };
}

function flowBlocksInBoxBounded(
  blocks: readonly OoxmlElement[],
  left: number,
  right: number,
  top: number,
  maxBottom: number,
  depth: number,
  deps: TableFlowDeps,
  cursor: CellPlaceCursor
): {
  readonly blocks: BlockFragmentRecord[];
  readonly bottom: number;
  readonly cursor: CellPlaceCursor;
  readonly complete: boolean;
  readonly fitted: boolean;
  readonly nestedSplitBlocked: boolean;
} {
  const fragments: BlockFragmentRecord[] = [];
  let y = top;
  let previousSpaceAfter = cursor.previousSpaceAfter;
  let blockIndex = cursor.blockIndex;
  let lineIndex = cursor.lineIndex;
  let paragraphFragmentIndex = cursor.paragraphFragmentIndex;
  let fitted = false;
  let nestedSplitBlocked = false;

  while (blockIndex < blocks.length) {
    const block = blocks[blockIndex]!;
    if (block.kind === 'table') {
      if (lineIndex !== 0) {
        // Should not happen — tables are whole blocks.
        lineIndex = 0;
      }
      previousSpaceAfter = 0;
      // Nested tables are atomic across row splits: place wholly or stop before them.
      const nested = emitNestedTable(block, left, right, y, depth + 1, deps);
      if (!nested) {
        blockIndex += 1;
        continue;
      }
      if (nested.bottom > maxBottom + 0.001) {
        // Stop before the nested table. If nothing fitted yet on a fresh band, the caller
        // treats this as an unsplittable overheight once page moves are exhausted.
        nestedSplitBlocked = !fitted;
        break;
      }
      fragments.push(nested.fragment);
      y = nested.bottom;
      fitted = true;
      blockIndex += 1;
      lineIndex = 0;
      continue;
    }
    if (block.kind !== 'paragraph') {
      blockIndex += 1;
      lineIndex = 0;
      continue;
    }

    const placed = placeCellParagraph(
      block,
      left,
      Math.max(1, right - left),
      y,
      deps,
      previousSpaceAfter,
      {
        lineStart: lineIndex,
        fragmentIndex: paragraphFragmentIndex,
        maxBottom,
        includeAfter: true,
        includeBottomBorder: true,
      }
    );
    if (!placed.fitted || !placed.fragment) {
      break;
    }
    fragments.push(placed.fragment);
    y = placed.bottom;
    fitted = true;
    if (placed.complete) {
      previousSpaceAfter = placed.spaceAfter;
      blockIndex += 1;
      lineIndex = 0;
      paragraphFragmentIndex = 0;
    } else {
      // Paragraph continues on the next page.
      return {
        blocks: fragments,
        bottom: y,
        cursor: {
          blockIndex,
          lineIndex: placed.nextLineIndex,
          previousSpaceAfter: 0,
          paragraphFragmentIndex: paragraphFragmentIndex + 1,
        },
        complete: false,
        fitted: true,
        nestedSplitBlocked: false,
      };
    }
  }

  return {
    blocks: fragments,
    bottom: y,
    cursor: {
      blockIndex,
      lineIndex,
      previousSpaceAfter,
      paragraphFragmentIndex,
    },
    complete: blockIndex >= blocks.length,
    fitted,
    nestedSplitBlocked,
  };
}

function contentInsets(
  margins: CellMarginsPt,
  borders: SemanticTableCell['borders']
): {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
} {
  // Border extents shrink the content box (border-box model) so thick rules do not cover text.
  return {
    top: margins.top + borderExtentPt(borders.top),
    right: margins.right + borderExtentPt(borders.right),
    bottom: margins.bottom + borderExtentPt(borders.bottom),
    left: margins.left + borderExtentPt(borders.left),
  };
}

function suppressSplitBorders(
  borders: CellBorderBox,
  omitTop: boolean,
  omitBottom: boolean
): CellBorderBox {
  return {
    top: omitTop ? { state: 'none' } : borders.top,
    left: borders.left,
    bottom: omitBottom ? { state: 'none' } : borders.bottom,
    right: borders.right,
  };
}

/** Clone a structure row with top/bottom borders suppressed for mid-row page cuts. */
export function rowWithSplitBorders(
  row: SemanticTableRow,
  omitTop: boolean,
  omitBottom: boolean
): SemanticTableRow {
  if (!omitTop && !omitBottom) return row;
  return {
    ...row,
    cells: row.cells.map((cell) => ({
      ...cell,
      borders: suppressSplitBorders(cell.borders, omitTop, omitBottom),
    })),
  };
}

/**
 * Lay out one row at `rowTop`: flow every cell, size the row to its tallest cell, emit
 * every cell box at that height. `left` is the table's left edge (page-content-relative),
 * threaded through directly so nested content never needs shifting after the fact.
 * Returns the record and the row's bottom y.
 */
export function layoutRowFragment(
  row: SemanticTableRow,
  cols: readonly number[],
  left: number,
  rowTop: number,
  isHeaderRepeat: boolean,
  depth: number,
  deps: TableFlowDeps
): { readonly record: TableRowFragmentRecord; readonly bottom: number } {
  const placed = layoutRowFragmentBounded(
    row,
    cols,
    left,
    rowTop,
    Number.POSITIVE_INFINITY,
    isHeaderRepeat,
    false,
    depth,
    deps,
    initialCellCursors(row)
  );
  return { record: placed.record, bottom: placed.bottom };
}

export interface LayoutRowBoundedResult {
  readonly record: TableRowFragmentRecord;
  readonly bottom: number;
  /** Remaining cell cursors when the row did not finish; null when complete. */
  readonly remainder: CellPlaceCursor[] | null;
  /** True when at least one cell placed a line or nested block in this fragment. */
  readonly fitted: boolean;
  /**
   * True when a nested table blocked a safe split (would need to cut through nested
   * geometry). Callers must fail closed rather than overflow.
   */
  readonly nestedSplitBlocked: boolean;
}

/**
 * Height-budgeted row layout for pagination. Content stays at or above `rowTop` and at or
 * below `maxBottom`. Cells that cannot place anything leave empty boxes; callers decide
 * whether to move the row, continue splitting, or fail closed.
 */
export function layoutRowFragmentBounded(
  row: SemanticTableRow,
  cols: readonly number[],
  left: number,
  rowTop: number,
  maxBottom: number,
  isHeaderRepeat: boolean,
  isContinuation: boolean,
  depth: number,
  deps: TableFlowDeps,
  cursors: readonly CellPlaceCursor[]
): LayoutRowBoundedResult {
  const total = sumCols(cols, 0, cols.length);
  const defaultLineHeight = deps.measurer.lineMetrics(DEFAULT_RUN_STYLE).height;

  interface FlowedCell {
    readonly cell: SemanticTableCell;
    readonly x: number;
    readonly width: number;
    readonly gridColumn: number;
    readonly blocks: readonly BlockFragmentRecord[];
    readonly contentTop: number;
    readonly contentBottom: number;
    readonly insets: { top: number; right: number; bottom: number; left: number };
    readonly nextCursor: CellPlaceCursor;
    readonly complete: boolean;
    readonly fitted: boolean;
    readonly nestedSplitBlocked: boolean;
  }
  const flowed: FlowedCell[] = [];
  let colCursor = 0;
  let anyFitted = false;
  let anyNestedBlocked = false;
  // Minimum row band even for empty/vMerge-continue cells.
  let rowBottom = Math.min(maxBottom, rowTop + defaultLineHeight + 2 * CELL_PAD);

  for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
    const cell = row.cells[cellIndex]!;
    const cursor = cursors[cellIndex] ?? {
      blockIndex: 0,
      lineIndex: 0,
      previousSpaceAfter: 0,
      paragraphFragmentIndex: 0,
    };
    const span = cell.gridSpan;
    const cellX = left + sumCols(cols, 0, colCursor);
    const cellW = sumCols(cols, colCursor, Math.min(colCursor + span, cols.length)) || total;
    const gridColumn = colCursor;
    colCursor += span;
    const insets = contentInsets(cell.margins, cell.borders);
    const topInset = isContinuation ? borderExtentPt(cell.borders.top) : insets.top;
    const contentTop = rowTop + topInset;
    // Always reserve bottom inset so the fragment never paints into the margin/border band.
    const contentMaxBottom = maxBottom - insets.bottom;

    let blocks: readonly BlockFragmentRecord[] = [];
    let contentBottom = contentTop;
    let nextCursor = cursor;
    let complete = true;
    let fitted = false;
    let nestedSplitBlocked = false;

    if (!cell.vMergeContinue) {
      if (contentMaxBottom < contentTop + 0.001) {
        complete = cursor.blockIndex >= cell.blocks.length;
      } else {
        const flow = flowBlocksInBoxBounded(
          cell.blocks,
          cellX + insets.left,
          cellX + cellW - insets.right,
          contentTop,
          contentMaxBottom,
          depth,
          deps,
          cursor
        );
        blocks = flow.blocks;
        contentBottom = flow.bottom;
        nextCursor = flow.cursor;
        complete = flow.complete;
        fitted = flow.fitted;
        nestedSplitBlocked = flow.nestedSplitBlocked;
        if (fitted) anyFitted = true;
        if (nestedSplitBlocked) anyNestedBlocked = true;
      }
    }

    const cellBottom = Math.min(
      maxBottom,
      Math.max(contentBottom + insets.bottom, rowTop + topInset + defaultLineHeight + insets.bottom)
    );
    if (cellBottom > rowBottom) rowBottom = cellBottom;

    flowed.push({
      cell,
      x: cellX,
      width: cellW,
      gridColumn,
      blocks,
      contentTop,
      contentBottom,
      insets: { ...insets, top: topInset },
      nextCursor,
      complete: cell.vMergeContinue ? true : complete,
      fitted,
      nestedSplitBlocked,
    });
  }

  // Coordinate fragment height: tallest placed content, never past maxBottom.
  rowBottom = Math.min(maxBottom, Math.max(rowBottom, rowTop));
  for (const entry of flowed) {
    const needed = entry.fitted
      ? entry.contentBottom + entry.insets.bottom
      : rowTop + entry.insets.top + defaultLineHeight + entry.insets.bottom;
    if (needed > rowBottom && needed <= maxBottom + 0.001) {
      rowBottom = needed;
    }
  }
  rowBottom = Math.min(maxBottom, rowBottom);
  const rowHeight = Math.max(0, rowBottom - rowTop);

  const cells: TableCellFragmentRecord[] = flowed.map((entry) => {
    let blocks = entry.blocks;
    // vAlign only when the cell finished on this fragment (no more continuation).
    if (
      !entry.cell.vMergeContinue &&
      entry.complete &&
      entry.cell.vAlign !== 'top' &&
      blocks.length > 0
    ) {
      const contentHeight = entry.contentBottom - entry.contentTop;
      const available = rowHeight - entry.insets.top - entry.insets.bottom - contentHeight;
      if (available > 0) {
        const dy = entry.cell.vAlign === 'center' ? available / 2 : available;
        blocks = shiftBlocks(blocks, dy);
      }
    }
    return {
      id: entry.cell.id,
      gridColumn: entry.gridColumn,
      gridSpan: entry.cell.gridSpan,
      vMergeContinue: entry.cell.vMergeContinue,
      ...(entry.cell.vMergeContinue ? { paintInert: true as const } : {}),
      rowSpan: 1,
      ...(entry.cell.shading === undefined ? {} : { shading: entry.cell.shading }),
      blocks,
      box: { x: entry.x, y: rowTop, width: entry.width, height: rowHeight },
    };
  });

  const remainderCursors = flowed.map((entry) => entry.nextCursor);
  const complete = flowed.every((entry) => entry.complete);

  return {
    record: {
      id: row.id,
      isHeaderRepeat,
      ...(isContinuation ? { isContinuation: true as const } : {}),
      cells,
      box: { x: left, y: rowTop, width: total, height: rowHeight },
    },
    bottom: rowBottom,
    remainder: complete ? null : remainderCursors,
    fitted: anyFitted || row.cells.every((cell) => cell.vMergeContinue),
    nestedSplitBlocked: anyNestedBlocked,
  };
}

/**
 * Measure the natural height of a full (unsplit) row without allocating line ids.
 * Used for whole-row preflight before committing placement.
 */
export function measureRowHeight(
  row: SemanticTableRow,
  cols: readonly number[],
  left: number,
  depth: number,
  deps: TableFlowDeps
): number {
  let lineCounter = 0;
  const probeDeps: TableFlowDeps = {
    ...deps,
    nextLineId: () => `probe-${lineCounter++}`,
  };
  const placed = layoutRowFragment(row, cols, left, 0, false, depth, probeDeps);
  return placed.record.box.height;
}

/**
 * After all rows of a table fragment are placed: expand vMerge restart boxes, re-apply
 * vAlign over the full span, and publish collapsed border edges.
 */
export function finalizeTableRows(
  rows: readonly TableRowFragmentRecord[],
  structure: SemanticTableStructure,
  sourceRows: readonly SemanticTableRow[],
  ownershipBudget?: TableBorderOwnershipBudget,
  vMergeBudget?: TableVMergeResolveBudget,
  vMergeWork?: TableVMergeResolveWork
): TableRowFragmentRecord[] {
  if (rows.length === 0) return [];

  // Map laid-out cells back to authored structure cells (same order within each row).
  const authoredById = new Map<string, SemanticTableCell>();
  for (const row of sourceRows) {
    for (const cell of row.cells) authoredById.set(cell.id, cell);
  }

  // One-pass column-keyed merge spans — O(cells), not O(rows × columns²).
  const mergeSpanById = resolveVMergeSpans(rows, vMergeWork, vMergeBudget);

  // Expand restart heights and shift content for vAlign over the full span.
  const expanded: TableRowFragmentRecord[] = rows.map((row, rowIndex) => ({
    ...row,
    cells: row.cells.map((cell) => {
      if (cell.vMergeContinue) {
        return { ...cell, paintInert: true, rowSpan: 1, borders: {}, blocks: [] };
      }
      const span = mergeSpanById.get(cell.id) ?? 1;
      let height = cell.box.height;
      if (span > 1) {
        const last = rows[rowIndex + span - 1]!;
        height = last.box.y + last.box.height - cell.box.y;
      }
      const authored = authoredById.get(cell.id);
      let blocks = cell.blocks;
      if (authored && authored.vAlign !== 'top' && blocks.length > 0) {
        const insets = contentInsets(authored.margins, authored.borders);
        // Content was placed relative to the first row; measure current content band.
        let contentTop = Number.POSITIVE_INFINITY;
        let contentBottom = Number.NEGATIVE_INFINITY;
        for (const block of blocks) {
          contentTop = Math.min(contentTop, block.box.y);
          contentBottom = Math.max(contentBottom, block.box.y + block.box.height);
        }
        if (Number.isFinite(contentTop) && Number.isFinite(contentBottom)) {
          const available = height - insets.top - insets.bottom - (contentBottom - contentTop);
          // Reset any per-row shift by measuring from cell top + inset.
          const desiredTop =
            cell.box.y +
            insets.top +
            (available > 0 ? (authored.vAlign === 'center' ? available / 2 : available) : 0);
          const dy = desiredTop - contentTop;
          if (Math.abs(dy) > 0.001) blocks = shiftBlocks(blocks, dy);
        }
      }
      return {
        ...cell,
        rowSpan: span,
        blocks,
        box: { ...cell.box, height },
      };
    }),
  }));

  // Border grid from authored structure (same row/cell order as laid-out fragment rows).
  // Header repeats use the same authored header row; match by cell id.
  const gridRows: BorderGridCell[][] = expanded.map((row) =>
    row.cells.map((cell) => {
      const authored = authoredById.get(cell.id);
      return {
        gridColumn: cell.gridColumn,
        gridSpan: cell.gridSpan,
        vMergeContinue: cell.vMergeContinue,
        borders: authored?.borders ?? {
          top: { state: 'omitted' as const },
          left: { state: 'omitted' as const },
          bottom: { state: 'omitted' as const },
          right: { state: 'omitted' as const },
        },
        mergeRowSpan: cell.rowSpan ?? 1,
      };
    })
  );

  const columnCount = structure.columnWidthsPt.length;
  const tableBorders: TableBorderBox = structure.tableBorders;
  const geometry: BorderGridGeometry = {
    columnWidthsPt: structure.columnWidthsPt,
    rowBands: expanded.map((row) => ({ y: row.box.y, height: row.box.height })),
    cellBoxes: expanded.map((row) =>
      row.cells.map((cell) => ({ width: cell.box.width, height: cell.box.height }))
    ),
  };
  const resolved = resolveTableCellBorderGrid(
    gridRows,
    tableBorders,
    columnCount,
    geometry,
    undefined,
    ownershipBudget
  );

  return expanded.map((row, rowIndex) => ({
    ...row,
    cells: row.cells.map((cell, cellIndex) => {
      const borders = resolved[rowIndex]![cellIndex]!;
      if (cell.paintInert || cell.vMergeContinue) {
        return { ...cell, borders: {}, paintInert: true };
      }
      return { ...cell, borders };
    }),
  }));
}

/**
 * A nested table inside a cell: laid out with its own geometry, no pagination, one
 * fragment. Returns null past the nesting ceiling — the cell renders empty rather than
 * recursing without bound.
 */
function emitNestedTable(
  table: OoxmlElement,
  left: number,
  right: number,
  top: number,
  depth: number,
  deps: TableFlowDeps
): { readonly fragment: TableFragmentRecord; readonly bottom: number } | null {
  if (depth >= MAX_TABLE_NESTING) return null;
  const structure = readTableStructure(table, Math.max(1, right - left), depth, deps.styleCascade);
  if (!structure || structure.rows.length === 0) return null;
  const rawRows: TableRowFragmentRecord[] = [];
  let y = top;
  for (const row of structure.rows) {
    const placed = layoutRowFragment(row, structure.columnWidthsPt, left, y, false, depth, deps);
    rawRows.push(placed.record);
    y = placed.bottom;
  }
  const rows = finalizeTableRows(
    rawRows,
    structure,
    structure.rows,
    deps.borderOwnershipBudget,
    deps.vMergeResolveBudget
  );
  const width = sumCols(structure.columnWidthsPt, 0, structure.columnWidthsPt.length);
  // Bottom tracks flow cursor (row stack), not overflow from expanded vMerge boxes —
  // restart overflow is painted within the same vertical band already reserved by continue rows.
  return {
    fragment: {
      kind: 'table',
      id: `${table.id}#f0`,
      tableId: table.id,
      fragmentIndex: 0,
      rows,
      box: { x: left, y: top, width, height: y - top },
    },
    bottom: y,
  };
}

/** Lay out every row of a structure (no pagination) and finalize merges/borders. */
export function layoutTableFragment(
  structure: SemanticTableStructure,
  left: number,
  top: number,
  fragmentIndex: number,
  tableId: string,
  depth: number,
  deps: TableFlowDeps,
  isHeaderRepeat: (row: SemanticTableRow) => boolean = () => false
): { readonly fragment: TableFragmentRecord; readonly bottom: number } {
  const rawRows: TableRowFragmentRecord[] = [];
  let y = top;
  for (const row of structure.rows) {
    const placed = layoutRowFragment(
      row,
      structure.columnWidthsPt,
      left,
      y,
      isHeaderRepeat(row),
      depth,
      deps
    );
    rawRows.push(placed.record);
    y = placed.bottom;
  }
  const rows = finalizeTableRows(
    rawRows,
    structure,
    structure.rows,
    deps.borderOwnershipBudget,
    deps.vMergeResolveBudget
  );
  const width = sumCols(structure.columnWidthsPt, 0, structure.columnWidthsPt.length);
  return {
    fragment: {
      kind: 'table',
      id: `${tableId}#f${fragmentIndex}`,
      tableId,
      fragmentIndex,
      rows,
      box: { x: left, y: top, width, height: y - top },
    },
    bottom: y,
  };
}
