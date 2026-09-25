import { paragraphFragmentsOfBlocks } from './semantic-records.ts';
import type {
  BlockFragmentRecord,
  LayoutBox,
  SemanticLayout,
  TableCellFragmentRecord,
} from './semantic-records.ts';
import type { CaretGeometry } from './semantic-interaction.ts';
import type { CellPlaceCursor } from './semantic-table-layout.ts';
import type { CellContentInsets } from './table-cell-geometry.ts';
import type { RowVMergeLayoutOptions } from './table-vmerge-heights.ts';
import { authoredRowMinimumFloorPt, type RowMinimumInsetMap } from './table-row-minimum-insets.ts';
import type { SemanticTableCell, SemanticTableRow } from './semantic-table.ts';
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';

/**
 * Whether a `btLr` cell lays out its text only after its row has a final height.
 *
 * `btLr` text runs along the row, so its line length is the row height less the cell's top
 * and bottom margins. The text never sizes the row: horizontal cells, `w:trHeight` and merge
 * spans do, and a row that nothing else sizes takes its end-of-cell paragraphs. Text that
 * the cell width cannot hold is clipped and never continues on another fragment. An exact
 * row and a detached merge head already know their height, so their cells lay out in place.
 */
export function waitsForRowHeight(cell: SemanticTableCell, heightKnown: boolean): boolean {
  return cell.textDirection === 'btLr' && !cell.vMergeContinue && !heightKnown;
}

/** A cell's line span (`flowLeft`..`flowRight`) and block span (`contentTop`..). */
interface CellFlowBox {
  readonly flowLeft: number;
  readonly flowRight: number;
  readonly contentTop: number;
  readonly contentMaxBottom: number;
}

/**
 * Where a cell's content flows. `btLr` lines run along the row from its bottom inset, and
 * lines stack across the cell width. `maxBottom` bounds the row, so it sets the line length.
 */
export function cellFlowBox(
  vertical: boolean,
  x: number,
  width: number,
  rowTop: number,
  maxBottom: number,
  insets: CellContentInsets
): CellFlowBox {
  return vertical
    ? {
        flowLeft: x + insets.bottom,
        flowRight: x + Math.max(0, maxBottom - rowTop) - insets.top,
        contentTop: rowTop + insets.left,
        contentMaxBottom: rowTop + width - insets.right,
      }
    : {
        flowLeft: x + insets.left,
        flowRight: x + width - insets.right,
        contentTop: rowTop + insets.top,
        contentMaxBottom: maxBottom - insets.bottom,
      };
}

interface WaitingCellFlow {
  readonly blocks: readonly BlockFragmentRecord[];
  readonly bottom: number;
  readonly fitted: boolean;
}

/** One row entry as the row layout keeps it; `flowTo` is set while its `btLr` text waits. */
interface WaitingCellEntry {
  readonly cell: SemanticTableCell;
  readonly x: number;
  readonly insets: { readonly top: number };
  readonly blocks: readonly BlockFragmentRecord[];
  readonly contentBottom: number;
  readonly fitted: boolean;
  readonly nextCursor: CellPlaceCursor;
  readonly flowTo?: (right: number) => WaitingCellFlow;
}

/**
 * Lay out every waiting `btLr` cell along the finished row height, in place. Each cell's
 * cursor then moves past its last block: text that the cell width cannot hold is clipped
 * and never continues on the next fragment. Returns whether any cell placed a line.
 */
export function layOutWaitingBottomToTopCells<T extends WaitingCellEntry>(
  entries: T[],
  rowHeight: number,
  /** Merges this row heads: a head lays its text along the merge when that is taller. */
  vMerge: RowVMergeLayoutOptions | undefined,
  /** Room from the row top to the page bottom; a merge never lays text past it. */
  pageRoomPt: number
): boolean {
  let fitted = false;
  for (const [index, entry] of entries.entries()) {
    if (!entry.flowTo) continue;
    const id = entry.cell.id;
    const merge =
      vMerge?.detachedSpanHeightPtByCellId?.get(id) ??
      vMerge?.bottomToTopSpanHeightPtByCellId?.get(id);
    const span = Math.min(merge ?? 0, pageRoomPt);
    const room = Number.isFinite(span) ? Math.max(rowHeight, span) : rowHeight;
    const flow = entry.flowTo(entry.x + room - entry.insets.top);
    fitted ||= flow.fitted;
    entries[index] = {
      ...entry,
      blocks: flow.blocks,
      contentBottom: flow.bottom,
      fitted: flow.fitted,
      nextCursor: finishedCellCursor(entry.cell),
      flowTo: undefined,
    };
  }
  return fitted;
}

/** A cursor past the last block, so a waiting `btLr` cell adds nothing to later fragments. */
function finishedCellCursor(cell: SemanticTableCell): CellPlaceCursor {
  return {
    blockIndex: cell.blocks.length,
    lineIndex: 0,
    previousSpaceAfter: 0,
    paragraphFragmentIndex: 0,
    precededByEmittedTable: false,
  };
}

/**
 * Whether `btLr` text keeps its row whole when a fresh page can hold the row.
 *
 * A split at a page end gives the text only that page's share of the row as its line
 * length and clips the rest. A row that only end marks size moves whole. A row with an
 * authored minimum moves whole when that minimum, padded by the row's margins, does not fit
 * `roomPt`; when it fits, the row splits like any other. A row no page can hold still splits.
 */
export function bottomToTopTextKeepsRowWhole(
  row: SemanticTableRow,
  roomPt: number,
  insetsOf: (cell: SemanticTableCell) => CellContentInsets,
  minimumInsets?: RowMinimumInsetMap
): boolean {
  if (row.height.rule === 'exact') return false;
  if (!row.cells.some((cell) => waitsForRowHeight(cell, false))) return false;
  if (row.cells.every((cell) => cell.vMergeContinue || cell.textDirection === 'btLr')) return true;
  if (row.height.rule !== 'atLeast') return false;
  const cells = row.cells.map((cell) => ({ cell, insets: insetsOf(cell) }));
  return authoredRowMinimumFloorPt(row.height.valuePt, cells, minimumInsets) > roomPt + 0.001;
}

/** Supported `w:textDirection` value, with horizontal layout as the safe default. */
export function readCellTextDirection(
  cellProperties: OoxmlElement | undefined
): 'horizontal' | 'btLr' {
  const node = cellProperties?.children.find(
    (child) => child.kind !== 'textValue' && child.localName === 'textDirection'
  );
  if (!node || node.kind === 'textValue') return 'horizontal';
  const value = node?.attributes.find((attribute) => attribute.localName === 'val')?.value;
  return value === 'btLr' ? 'btLr' : 'horizontal';
}

/** Furthest laid inline edge, excluding the unused width of paragraph line bands. */
export function blockInlineRight(blocks: readonly BlockFragmentRecord[], fallback: number): number {
  let right = fallback;
  for (const block of blocks) {
    if (block.kind === 'table') {
      right = Math.max(right, block.box.x + block.box.width);
      continue;
    }
    for (const line of block.lines) {
      if (line.box.height === 0 && line.spans.length === 0 && !line.drawings?.length) continue;
      right = Math.max(right, line.contentX);
      for (const span of line.spans) right = Math.max(right, span.box.x + span.box.width);
      for (const drawing of line.drawings ?? []) right = Math.max(right, drawing.advanceEnd);
    }
  }
  return right;
}

/** Map a sheet point into the horizontal local plane used to lay out `btLr` content. */
export function pointInBottomToTopCell(point: LayoutBoxPoint, cell: LayoutBox): LayoutBoxPoint {
  return {
    x: cell.x + cell.height - (point.y - cell.y),
    y: cell.y + (point.x - cell.x),
  };
}

interface BottomToTopCellLocation {
  readonly pageIndex: number;
  readonly cell: TableCellFragmentRecord;
}

const locationsByLayout = new WeakMap<
  SemanticLayout,
  ReadonlyMap<string, readonly BottomToTopCellLocation[]>
>();
const bottomToTopCarets = new WeakSet<CaretGeometry>();

function bottomToTopLocations(
  layout: SemanticLayout
): ReadonlyMap<string, readonly BottomToTopCellLocation[]> {
  const cached = locationsByLayout.get(layout);
  if (cached) return cached;
  const found = new Map<string, BottomToTopCellLocation[]>();
  const visit = (blocks: readonly BlockFragmentRecord[], pageIndex: number): void => {
    for (const block of blocks) {
      if (block.kind !== 'table') continue;
      for (const row of block.rows) {
        for (const cell of row.cells) {
          if (cell.textDirection === 'btLr') {
            for (const paragraph of paragraphFragmentsOfBlocks(cell.blocks)) {
              const locations = found.get(paragraph.paragraphId) ?? [];
              locations.push({ pageIndex, cell });
              found.set(paragraph.paragraphId, locations);
            }
          } else {
            visit(cell.blocks, pageIndex);
          }
        }
      }
    }
  };
  for (const page of layout.pages) {
    visit(page.fragments, page.index);
    if (page.header) visit(page.header.fragments, page.index);
    if (page.footer) visit(page.footer.fragments, page.index);
    for (const area of [page.footnotes, page.endnotes]) {
      if (!area) continue;
      if (area.separator) visit(area.separator.fragments, page.index);
      for (const note of area.notes) visit(note.fragments, page.index);
    }
  }
  locationsByLayout.set(layout, found);
  return found;
}

function locationFor(
  layout: SemanticLayout,
  pageIndex: number,
  paragraphId: string
): BottomToTopCellLocation | undefined {
  const locations = bottomToTopLocations(layout).get(paragraphId) ?? [];
  return locations.find((location) => location.pageIndex === pageIndex) ?? locations[0];
}

/** Rotate virtual horizontal caret geometry into its painted table-cell plane. */
export function bottomToTopCaretInLayout(
  layout: SemanticLayout,
  caret: CaretGeometry
): CaretGeometry {
  const location = locationFor(layout, caret.pageIndex, caret.position.paragraphId);
  if (!location) return caret;
  const point = pointFromBottomToTopCell(caret, location.cell.box);
  const transformed = { ...caret, ...point };
  bottomToTopCarets.add(transformed);
  return transformed;
}

/** Whether caret paint must follow the `btLr` plane used for its geometry. */
export function isBottomToTopCaret(caret: CaretGeometry): boolean {
  return bottomToTopCarets.has(caret);
}

/** Rotate one virtual selection band into page-content coordinates. */
export function bottomToTopRectInLayout<T extends LayoutBox & { readonly pageIndex: number }>(
  layout: SemanticLayout,
  paragraphId: string,
  rect: T
): T {
  const location = locationFor(layout, rect.pageIndex, paragraphId);
  if (!location) return rect;
  const cell = location.cell.box;
  return {
    ...rect,
    x: cell.x + (rect.y - cell.y),
    y: cell.y + cell.height - (rect.x - cell.x) - rect.width,
    width: rect.height,
    height: rect.width,
  };
}

function pointFromBottomToTopCell(point: LayoutBoxPoint, cell: LayoutBox): LayoutBoxPoint {
  return {
    x: cell.x + (point.y - cell.y),
    y: cell.y + cell.height - (point.x - cell.x),
  };
}

export interface LayoutBoxPoint {
  readonly x: number;
  readonly y: number;
}
