// Table-level shading: `w:tblPr/w:shd` (17.4.32) and a row's `w:tblPrEx/w:shd` exception.
//
// The table's fill is the background behind its cells, and it shows only where no cell
// covers it: in the `w:tblCellSpacing` gaps between cells and between the cells and the table
// edge. A cell without a fill of its own does not take it, so with no cell spacing the table
// fill shows nowhere. Reference renderings agree on each of these in compatibility modes 14
// and 15, and in a file that states no compatibility mode: an unshaded cell of a shaded table
// shows what lies behind the table (the page, or an outer cell's fill), with or without
// spacing; the gaps of a spaced table take the fill, the gap below the last row included, in
// flow and positioned; a cell's own fill paints over it; a row's `w:tblPrEx` fill replaces the
// table's around that row's cells; and a column a row skips by `w:gridBefore` takes none.
//
// The cascade follows `w:shd` everywhere else: the style chain's `w:tblPr`, base first, then
// the table's own `w:tblPr`, then the row exception. A stated `auto` fill clears the layers
// below it; `nil` leaves them showing.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { wmlChildNamed } from '../store/store/tree-op-table-shared.ts';
import { cascadedShadingFill } from './table-cell-shading.ts';
import { cellSpacingGapPt } from './table-cell-spacing.ts';
import { clipParagraphBox } from './paragraph-frame-clip.ts';
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
  /** The row band in page points; the last row's runs on to the bottom of the fragment. */
  readonly box: LayoutBox;
  /** Cell boxes inside `box`, clipped to it, that the fill leaves out. They never overlap. */
  readonly holes: readonly LayoutBox[];
}

/**
 * `rows` with the gap fill each one shows, or `rows` itself when the table has no cell
 * spacing: then no gap shows the fill. `rowNodes[i]` is the authored `w:tr` of `rows[i]`.
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
  let shaded = false;
  const result = rows.map((row, index) => {
    const exception = input.rowNodes[index] && wmlChildNamed(input.rowNodes[index], 'tblPrEx');
    const fill = exception ? cascadedShadingFill([...layers, exception]) : tableFill;
    if (fill === undefined) return row;
    shaded = true;
    return { ...row, spacingShading: { fill, gapPt } };
  });
  return shaded ? result : rows;
}

/** `box` cut to `to`, or null when nothing is left. */
const clip = (box: LayoutBox, to: LayoutBox): LayoutBox | null => clipParagraphBox(box, to);

/**
 * The bands a table fragment fills, one per shaded row, less every cell box that reaches into
 * it. A band runs from the row's first cell to its last, with the gap on each side, so cells
 * skipped by `w:gridBefore` or `w:gridAfter` take no fill. The last row's band runs on to the
 * bottom of the fragment box, which holds the gap the table closes below its last row. A cell
 * merged down from an earlier row stays a hole in each row it crosses. Each cell is tested
 * only against the rows it can reach.
 */
export function tableSpacingShadingRegions(
  fragment: Pick<TableFragmentRecord, 'rows' | 'box'>
): readonly TableSpacingShadingRegion[] {
  const regions: TableSpacingShadingRegion[] = [];
  if (!fragment.rows.some((row) => row.spacingShading)) return regions;
  let open: LayoutBox[] = [];
  const lastRow = fragment.rows.at(-1);
  // Below the last row the fragment box holds the gap the table closes there, if any.
  const fragmentBottom = fragment.box.y + fragment.box.height;
  for (const row of fragment.rows) {
    const cells: LayoutBox[] = [];
    for (const cell of row.cells) if (!cell.paintInert) cells.push(cell.box);
    const shading = row.spacingShading;
    const bottom = row === lastRow ? fragmentBottom : row.box.y + row.box.height;
    const band = shading && rowBand(row, shading, bottom);
    if (shading && band) {
      const holes: LayoutBox[] = [];
      // Cells merged down from different rows sit in different columns, as do a row's own
      // cells: only a row's cell against a merged one can overlap.
      for (const cell of open) addHole(holes, clip(cell, band), 0);
      const merged = holes.length;
      for (const cell of cells) addHole(holes, clip(cell, band), merged);
      regions.push({ fill: shading.fill, box: band, holes });
    }
    // Only a cell that reaches below its row can cover a later one.
    const rowBottom = row.box.y + row.box.height;
    open = open.filter((cell) => cell.y + cell.height > rowBottom + 0.001);
    for (const cell of cells) if (cell.y + cell.height > rowBottom + 0.001) open.push(cell);
  }
  return regions;
}

function rowBand(
  row: TableRowFragmentRecord,
  shading: TableSpacingShading,
  bottom: number
): LayoutBox | null {
  if (row.cells.length === 0) return null;
  let left = Infinity;
  let right = -Infinity;
  for (const { box } of row.cells) {
    left = Math.min(left, box.x);
    right = Math.max(right, box.x + box.width);
  }
  const height = Math.max(row.box.height, bottom - row.box.y);
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
function addHole(holes: LayoutBox[], hole: LayoutBox | null, checked: number): void {
  if (!hole) return;
  for (let index = 0; index < checked; index += 1) if (clip(hole, holes[index]!)) return;
  holes.push(hole);
}
