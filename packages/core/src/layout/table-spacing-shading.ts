// Table-level shading: `w:tblPr/w:shd` (17.4.32) and a row's `w:tblPrEx/w:shd` exception.
//
// The table's fill is the background behind its cells, and it shows only where no cell
// covers it: in the `w:tblCellSpacing` gaps between cells and between the cells and the table
// edge. A cell without a fill of its own does not take it, so with no cell spacing the table
// fill shows nowhere. Reference renderings agree on each of these in compatibility modes 14
// and 15, and in a file that states no compatibility mode: an unshaded cell paints white over a shaded table, with or without spacing; the
// gaps of a spaced table take the fill; a cell's own fill paints over it; and a row's
// `w:tblPrEx` fill replaces the table's around that row's cells.
//
// The cascade follows `w:shd` everywhere else: the style chain's `w:tblPr`, base first, then
// the table's own `w:tblPr`, then the row exception. A stated `auto` fill clears the layers
// below it; `nil` leaves them showing.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { wmlChildNamed } from '../store/store/tree-op-table-shared.ts';
import { cascadedShadingFill } from './table-cell-shading.ts';
import { cellSpacingGapPt, closingCellSpacingPt } from './table-cell-spacing.ts';
import type { SemanticTableRow } from './semantic-table.ts';
import type {
  LayoutBox,
  TableFragmentRecord,
  TableRowFragmentRecord,
  TableSpacingShading,
} from './semantic-records.ts';

/** One filled band of a table fragment: `box` minus the cell boxes in `holes`. */
export interface TableSpacingShadingRegion {
  /** Validated `RRGGBB` fill. */
  readonly fill: string;
  /** The row band in page points, extended by the closing gap below the table's last row. */
  readonly box: LayoutBox;
  /** Cell boxes inside `box`, clipped to it, that the fill leaves out. They never overlap. */
  readonly holes: readonly LayoutBox[];
}

/**
 * `rows` with the gap fill each one shows, or `rows` itself when the table has no cell
 * spacing: then no gap shows the fill. `rowNodes` are the authored `w:tr` elements of `rows`,
 * in order; the closing gap goes to the last of them.
 */
export function withRowSpacingShading(
  rows: readonly SemanticTableRow[],
  input: {
    readonly stylePropertyNodes: readonly OoxmlElement[];
    readonly tableProperties: OoxmlElement | undefined;
    readonly rowNodes: readonly OoxmlElement[];
    readonly cellSpacingPt: number;
  }
): readonly SemanticTableRow[] {
  const { cellSpacingPt } = input;
  if (!(cellSpacingPt > 0)) return rows;
  const layers = [...input.stylePropertyNodes, input.tableProperties];
  const tableFill = cascadedShadingFill(layers);
  const gapPt = cellSpacingGapPt(cellSpacingPt);
  const closingPt = closingCellSpacingPt({ cellSpacingPt, rows });
  const fills = new Map<string, string>();
  for (const node of input.rowNodes) {
    const exception = wmlChildNamed(node, 'tblPrEx');
    const fill = exception ? cascadedShadingFill([...layers, exception]) : tableFill;
    if (fill !== undefined) fills.set(node.id, fill);
  }
  if (fills.size === 0) return rows;
  const lastId = input.rowNodes.at(-1)?.id;
  return rows.map((row) => {
    const fill = fills.get(row.id);
    if (fill === undefined) return row;
    const closing = row.id === lastId && closingPt > 0 ? { closingPt } : {};
    return { ...row, spacingShading: { fill, gapPt, ...closing } };
  });
}

function clip(box: LayoutBox, to: LayoutBox): LayoutBox | null {
  const x = Math.max(box.x, to.x);
  const y = Math.max(box.y, to.y);
  const right = Math.min(box.x + box.width, to.x + to.width);
  const bottom = Math.min(box.y + box.height, to.y + to.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/**
 * The bands a table fragment fills, one per shaded row, less every cell box that reaches into
 * it. A band runs from the row's first cell to its last, with the gap on each side, so cells
 * skipped by `w:gridBefore` or `w:gridAfter` take no fill. Below the table's last row it adds
 * the closing gap. A cell merged down from an earlier row stays a hole in each row it
 * crosses. Each cell is tested only against the rows it can reach.
 */
export function tableSpacingShadingRegions(
  fragment: Pick<TableFragmentRecord, 'rows'>
): readonly TableSpacingShadingRegion[] {
  const regions: TableSpacingShadingRegion[] = [];
  if (!fragment.rows.some((row) => row.spacingShading)) return regions;
  let open: LayoutBox[] = [];
  for (const row of fragment.rows) {
    const cells: LayoutBox[] = [];
    for (const cell of row.cells) if (!cell.paintInert) cells.push(cell.box);
    const shading = row.spacingShading;
    const band = shading && rowBand(row, shading);
    if (shading && band) {
      const holes: LayoutBox[] = [];
      for (const cell of open) addHole(holes, clip(cell, band));
      for (const cell of cells) addHole(holes, clip(cell, band));
      regions.push({ fill: shading.fill, box: band, holes });
    }
    // Only a cell that reaches below its row can cover a later one.
    const rowBottom = row.box.y + row.box.height;
    open = open.filter((cell) => cell.y + cell.height > rowBottom + 0.001);
    for (const cell of cells) if (cell.y + cell.height > rowBottom + 0.001) open.push(cell);
  }
  return regions;
}

function rowBand(row: TableRowFragmentRecord, shading: TableSpacingShading): LayoutBox | null {
  if (row.cells.length === 0) return null;
  let left = Infinity;
  let right = -Infinity;
  for (const { box } of row.cells) {
    left = Math.min(left, box.x);
    right = Math.max(right, box.x + box.width);
  }
  const closing = row.hasContinuation ? 0 : (shading.closingPt ?? 0);
  const height = row.box.height + Math.max(0, closing);
  return clip(
    { x: left - shading.gapPt, y: row.box.y, width: right - left + 2 * shading.gapPt, height },
    { ...row.box, height }
  );
}

/**
 * Even-odd filling needs holes that never overlap. Cells do not overlap, so a hole that does
 * is a layout defect: the part already cut stays cut, and the overlapping hole is dropped
 * rather than turned back into fill.
 */
function addHole(holes: LayoutBox[], hole: LayoutBox | null): void {
  if (!hole) return;
  for (const other of holes) if (clip(hole, other)) return;
  holes.push(hole);
}

/**
 * `rows` with the last row's closing gap cut to what fits above `bottom`: layout closes the
 * table there, so the band never paints into the margin below a page or past a nested
 * table's cell. Returns `rows` itself when nothing changes.
 */
export function withPlacedClosingGap<Row extends TableRowFragmentRecord>(
  rows: Row[],
  bottom: number
): Row[] {
  const last = rows.at(-1);
  const closing = last?.spacingShading?.closingPt;
  if (!last || closing === undefined || last.hasContinuation) return rows;
  const room = Math.max(0, bottom - (last.box.y + last.box.height));
  if (closing <= room + 0.001) return rows;
  const { closingPt: _dropped, ...shading } = last.spacingShading!;
  const placed = room > 0.001 ? { ...shading, closingPt: room } : shading;
  return [...rows.slice(0, -1), { ...last, spacingShading: placed }];
}
