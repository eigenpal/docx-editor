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
//   - a cell does not paginate (v1 parity): its blocks stack, and the enclosing row either
//     fits the page or moves to the next one whole;
//   - a NESTED table lays out with its own geometry inside the cell box, no pagination.
//
// All coordinates are points, relative to the page content box — exactly the space body
// paragraph fragments already live in. Cell paragraph breaks go through the shared
// `breakParagraph`, so they hit the same cache with keys at the cell's content width.

import type { OoxmlElement } from '@docx-editor.dev/core-contract/store';
import type { FieldPageContext } from './field-projection.ts';
import { paragraphLayoutKey, type ParagraphLayoutCache } from './layout-cache.ts';
import {
  alignSpans,
  breakParagraph,
  type PendingLine,
} from './paragraph-flow.ts';
import { collapsedSpaceBefore } from './paragraph-style.ts';
import { DEFAULT_RUN_STYLE } from './run-style.ts';
import {
  resolveParagraphLayoutInputs,
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
  type TableBorderBox,
} from './table-borders.ts';

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
 */
function placeCellParagraph(
  paragraph: OoxmlElement,
  originX: number,
  cellContentWidth: number,
  top: number,
  deps: TableFlowDeps,
  previousSpaceAfter: number
): {
  readonly fragment: ParagraphFragmentRecord;
  readonly bottom: number;
  readonly spaceAfter: number;
} {
  const paragraphId = paragraph.id;
  const listItem = deps.listItems?.get(paragraphId);
  const {
    props,
    indent,
    available,
    alignment,
    spacing,
    bottomBorder,
    shading,
    inheritedRunProperties,
    tabStops,
    tabStopsCacheToken,
  } = resolveParagraphLayoutInputs(
    paragraph,
    cellContentWidth,
    deps.styleCascade,
    listItem
  );
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
    deps.pageContext
  );

  const appliedBefore = collapsedSpaceBefore(spacing.before, previousSpaceAfter);
  const records: LineRecord[] = [];
  let y = top + appliedBefore;
  for (const [lineIndex, pendingLine] of lines.entries()) {
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
        originX + indent.left,
        available,
        alignment,
        lineIndex === lines.length - 1
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
  }

  const linesBottom = y;
  let bottomBorderRecord: ParagraphBottomBorderRecord | undefined;
  let contentBottom = linesBottom;
  if (bottomBorder) {
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
  const bottom = contentBottom + spacing.after;
  const fragmentX = originX + indent.left;
  const shadingBox =
    shading === undefined ? undefined : paragraphShadingBox(records, fragmentX, available);
  const marker = publishListMarker(
    listItem,
    deps.measurer,
    records[0] ? { y: records[0].box.y, height: records[0].box.height } : undefined,
    originX
  );

  return {
    fragment: {
      kind: 'paragraph',
      id: `${paragraphId}#f0`,
      paragraphId,
      fragmentIndex: 0,
      range: {
        paragraphId,
        start: lines[0]?.start ?? 0,
        end: lines[lines.length - 1]?.end ?? 0,
      },
      props,
      spacing: { before: appliedBefore, after: spacing.after },
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
    spaceAfter: spacing.after,
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
  const fragments: BlockFragmentRecord[] = [];
  let y = top;
  let previousSpaceAfter = 0;
  for (const block of blocks) {
    if (block.kind === 'table') {
      previousSpaceAfter = 0;
      const nested = emitNestedTable(block, left, right, y, depth + 1, deps);
      if (nested) {
        fragments.push(nested.fragment);
        y = nested.bottom;
      }
      continue;
    }
    if (block.kind !== 'paragraph') continue;
    const placed = placeCellParagraph(
      block,
      left,
      Math.max(1, right - left),
      y,
      deps,
      previousSpaceAfter
    );
    fragments.push(placed.fragment);
    y = placed.bottom;
    previousSpaceAfter = placed.spaceAfter;
  }
  return { blocks: fragments, bottom: y };
}

function contentInsets(margins: CellMarginsPt, borders: SemanticTableCell['borders']): {
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
  }
  const flowed: FlowedCell[] = [];
  let colCursor = 0;
  let rowBottom = rowTop + defaultLineHeight + 2 * CELL_PAD;

  for (const cell of row.cells) {
    const span = cell.gridSpan;
    const cellX = left + sumCols(cols, 0, colCursor);
    const cellW = sumCols(cols, colCursor, Math.min(colCursor + span, cols.length)) || total;
    const gridColumn = colCursor;
    colCursor += span;
    const insets = contentInsets(cell.margins, cell.borders);
    const minBottom = rowTop + insets.top + defaultLineHeight + insets.bottom;
    if (minBottom > rowBottom) rowBottom = minBottom;

    let blocks: readonly BlockFragmentRecord[] = [];
    const contentTop = rowTop + insets.top;
    let contentBottom = contentTop;
    if (!cell.vMergeContinue) {
      const flow = flowBlocksInBox(
        cell.blocks,
        cellX + insets.left,
        cellX + cellW - insets.right,
        contentTop,
        depth,
        deps
      );
      blocks = flow.blocks;
      contentBottom = flow.bottom;
      if (flow.bottom + insets.bottom > rowBottom) rowBottom = flow.bottom + insets.bottom;
    }
    flowed.push({
      cell,
      x: cellX,
      width: cellW,
      gridColumn,
      blocks,
      contentTop,
      contentBottom,
      insets,
    });
  }

  const rowHeight = rowBottom - rowTop;
  const cells: TableCellFragmentRecord[] = flowed.map((entry) => {
    // Per-row vAlign (before merge expansion). Merge post-pass re-applies over the full span.
    let blocks = entry.blocks;
    if (!entry.cell.vMergeContinue && entry.cell.vAlign !== 'top' && blocks.length > 0) {
      const contentHeight = entry.contentBottom - entry.contentTop;
      const available =
        rowHeight - entry.insets.top - entry.insets.bottom - contentHeight;
      if (available > 0) {
        const dy =
          entry.cell.vAlign === 'center' ? available / 2 : available; // bottom
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

  return {
    record: {
      id: row.id,
      isHeaderRepeat,
      cells,
      box: { x: left, y: rowTop, width: total, height: rowHeight },
    },
    bottom: rowBottom,
  };
}

/**
 * After all rows of a table fragment are placed: expand vMerge restart boxes, re-apply
 * vAlign over the full span, and publish collapsed border edges.
 */
export function finalizeTableRows(
  rows: readonly TableRowFragmentRecord[],
  structure: SemanticTableStructure,
  sourceRows: readonly SemanticTableRow[]
): TableRowFragmentRecord[] {
  if (rows.length === 0) return [];

  // Map laid-out cells back to authored structure cells (same order within each row).
  const authoredById = new Map<string, SemanticTableCell>();
  for (const row of sourceRows) {
    for (const cell of row.cells) authoredById.set(cell.id, cell);
  }

  // First pass: compute merge row spans per restart.
  const mergeSpanById = new Map<string, number>();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]!;
    for (const cell of row.cells) {
      if (cell.vMergeContinue) continue;
      let span = 1;
      for (let r = rowIndex + 1; r < rows.length; r += 1) {
        const below = rows[r]!.cells.find(
          (candidate) => candidate.gridColumn === cell.gridColumn && candidate.vMergeContinue
        );
        if (!below) break;
        span += 1;
      }
      mergeSpanById.set(cell.id, span);
    }
  }

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
          const available =
            height - insets.top - insets.bottom - (contentBottom - contentTop);
          // Reset any per-row shift by measuring from cell top + inset.
          const desiredTop =
            cell.box.y +
            insets.top +
            (available > 0
              ? authored.vAlign === 'center'
                ? available / 2
                : available
              : 0);
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
  const resolved = resolveTableCellBorderGrid(gridRows, tableBorders, columnCount);

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
  const structure = readTableStructure(table, Math.max(1, right - left), depth);
  if (!structure || structure.rows.length === 0) return null;
  const rawRows: TableRowFragmentRecord[] = [];
  let y = top;
  for (const row of structure.rows) {
    const placed = layoutRowFragment(row, structure.columnWidthsPt, left, y, false, depth, deps);
    rawRows.push(placed.record);
    y = placed.bottom;
  }
  const rows = finalizeTableRows(rawRows, structure, structure.rows);
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
  const rows = finalizeTableRows(rawRows, structure, structure.rows);
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
