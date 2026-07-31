// Table row and cell layout over the canonical tree.
//
// Row, cell, and nested-table flow operate on typed tree nodes with the injected
// TextMeasurer and emit semantic records:
//
//   - a row is laid out in TWO PASSES — every cell flows into a buffer while the tallest
//     bottom is tracked, then every cell box is emitted at the final row height;
//   - a vMerge continuation emits its box but no content, so text is never duplicated;
//   - a cell does not paginate (v1 parity): its blocks stack, and the enclosing row either
//     fits the page or moves to the next one whole;
//   - a NESTED table lays out with its own geometry inside the cell box, no pagination.
//
// All coordinates are points, relative to the page content box — exactly the space body
// paragraph fragments already live in. Cell paragraph breaks go through the shared
// `breakParagraph`, so they hit the same cache with keys at the cell's content width.

import type { OoxmlElement } from '@docx-editor.dev/core-contract/store';
import { paragraphLayoutKey, type ParagraphLayoutCache } from './layout-cache.ts';
import {
  alignSpans,
  breakParagraph,
  paragraphAlignment,
  paragraphIndent,
  propertiesOf,
  type PendingLine,
} from './paragraph-flow.ts';
import { DEFAULT_RUN_STYLE } from './run-style.ts';
import {
  CELL_PAD,
  MAX_TABLE_NESTING,
  readTableStructure,
  type SemanticTableCell,
  type SemanticTableRow,
} from './semantic-table.ts';
import type {
  BlockFragmentRecord,
  LineRecord,
  ParagraphFragmentRecord,
  TableCellFragmentRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
  TextMeasurer,
} from './semantic-records.ts';

export interface TableFlowDeps {
  readonly measurer: TextMeasurer;
  readonly cache?: ParagraphLayoutCache<readonly PendingLine[]> | undefined;
  readonly producer: string;
  /** Line ids continue the document-wide counter, so records stay deterministic. */
  readonly nextLineId: () => string;
}

function sumCols(cols: readonly number[], from: number, to: number): number {
  let sum = 0;
  for (let index = from; index < to && index < cols.length; index += 1) sum += cols[index]!;
  return sum;
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
  deps: TableFlowDeps
): { readonly fragment: ParagraphFragmentRecord; readonly bottom: number } {
  const paragraphId = paragraph.id;
  const props = propertiesOf(
    paragraph.children.find((child) => child.kind === 'paragraphProperties')
  );
  const indent = paragraphIndent(props);
  const available = Math.max(1, cellContentWidth - indent.left - indent.right);
  const alignment = paragraphAlignment(props);
  const key = paragraphLayoutKey({
    paragraph,
    properties: props,
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
    deps.cache ? key : null
  );

  const records: LineRecord[] = [];
  let y = top;
  for (const [lineIndex, pendingLine] of lines.entries()) {
    records.push({
      id: deps.nextLineId(),
      range: { paragraphId, start: pendingLine.start, end: pendingLine.end },
      spans: alignSpans(
        // Paragraph id and position are stamped at placement, exactly as body placement
        // does: a cached break is keyed by content, so its spans may carry another
        // paragraph's id and origin.
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
      lines: records,
      box: { x: originX + indent.left, y: top, width: available, height: y - top },
    },
    bottom: y,
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
  for (const block of blocks) {
    if (block.kind === 'table') {
      const nested = emitNestedTable(block, left, right, y, depth + 1, deps);
      if (nested) {
        fragments.push(nested.fragment);
        y = nested.bottom;
      }
      continue;
    }
    if (block.kind !== 'paragraph') continue;
    const placed = placeCellParagraph(block, left, Math.max(1, right - left), y, deps);
    fragments.push(placed.fragment);
    y = placed.bottom;
  }
  return { blocks: fragments, bottom: y };
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
  let rowBottom = rowTop + defaultLineHeight + 2 * CELL_PAD;

  interface FlowedCell {
    readonly cell: SemanticTableCell;
    readonly x: number;
    readonly width: number;
    readonly gridColumn: number;
    readonly blocks: readonly BlockFragmentRecord[];
  }
  const flowed: FlowedCell[] = [];
  let colCursor = 0;
  for (const cell of row.cells) {
    const span = cell.gridSpan; // clamped at read time
    const cellX = left + sumCols(cols, 0, colCursor);
    const cellW = sumCols(cols, colCursor, Math.min(colCursor + span, cols.length)) || total;
    const gridColumn = colCursor;
    colCursor += span;
    let blocks: readonly BlockFragmentRecord[] = [];
    // A vMerge continuation emits NO content, so text is never duplicated; the box is
    // still drawn. Full vertical-span rect height remains a separate refinement.
    if (!cell.vMergeContinue) {
      const flow = flowBlocksInBox(
        cell.blocks,
        cellX + CELL_PAD,
        cellX + cellW - CELL_PAD,
        rowTop + CELL_PAD,
        depth,
        deps
      );
      blocks = flow.blocks;
      if (flow.bottom + CELL_PAD > rowBottom) rowBottom = flow.bottom + CELL_PAD;
    }
    flowed.push({ cell, x: cellX, width: cellW, gridColumn, blocks });
  }

  const rowHeight = rowBottom - rowTop;
  const cells: TableCellFragmentRecord[] = flowed.map((entry) => ({
    id: entry.cell.id,
    gridColumn: entry.gridColumn,
    gridSpan: entry.cell.gridSpan,
    vMergeContinue: entry.cell.vMergeContinue,
    ...(entry.cell.shading === undefined ? {} : { shading: entry.cell.shading }),
    blocks: entry.blocks,
    box: { x: entry.x, y: rowTop, width: entry.width, height: rowHeight },
  }));

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
  const rows: TableRowFragmentRecord[] = [];
  let y = top;
  for (const row of structure.rows) {
    const placed = layoutRowFragment(row, structure.columnWidthsPt, left, y, false, depth, deps);
    rows.push(placed.record);
    y = placed.bottom;
  }
  const width = sumCols(structure.columnWidthsPt, 0, structure.columnWidthsPt.length);
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
