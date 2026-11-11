// Table-level shading: `w:tblPr/w:shd` (17.4.32) and a row's `w:tblPrEx/w:shd` exception.
//
// The table's fill is the background behind its cells, and it shows only where no cell
// covers it: in the `w:tblCellSpacing` gaps between cells and between the cells and the table
// edge. A cell without a fill of its own does not take it, so with no cell spacing the table
// fill shows nowhere. Reference renderings agree on each of these in compatibility modes 14
// and 15: an unshaded cell paints white over a shaded table, with or without spacing; the
// gaps of a spaced table take the fill; a cell's own fill paints over it; and a row's
// `w:tblPrEx` fill replaces the table's around that row's cells.
//
// The cascade follows `w:shd` everywhere else: the style chain's `w:tblPr`, base first, then
// the table's own `w:tblPr`, then the row exception. A stated `auto` fill clears the layers
// below it; `nil` leaves them showing.

import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import { statedShadingFill } from './ooxml-shading.ts';
import type { LayoutBox, TableFragmentRecord, TableSpacingShading } from './semantic-records.ts';

/** One filled band of a table fragment: `box` minus the cell boxes in `holes`. */
export interface TableSpacingShadingRegion {
  /** Validated `RRGGBB` fill. */
  readonly fill: string;
  /** The row band in page points, extended by the closing gap below the table's last row. */
  readonly box: LayoutBox;
  /** Cell boxes inside `box`, clipped to it, that the fill leaves out. They never overlap. */
  readonly holes: readonly LayoutBox[];
}

function shd(node: OoxmlElement | undefined): OoxmlElement | undefined {
  if (!node) return undefined;
  for (const child of node.children) {
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'shd'
    )
      return child;
  }
  return undefined;
}

function tblPrEx(row: OoxmlElement): OoxmlElement | undefined {
  for (const child of row.children) {
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'tblPrEx'
    )
      return child;
  }
  return undefined;
}

/** Each layer's stated fill over the ones before it, or undefined when none paints a colour. */
function cascade(layers: readonly (OoxmlElement | undefined)[]): string | undefined {
  let fill: string | null | undefined;
  for (const layer of layers) {
    const stated = statedShadingFill(shd(layer));
    if (stated !== undefined) fill = stated;
  }
  return fill ?? undefined;
}

/**
 * The spacing fill of each row, keyed by row id. Empty when the table has no cell spacing,
 * because then no gap shows the fill. `rowNodes` are the authored `w:tr` elements; the
 * closing gap goes to the last of `rowIds`, the rows the table lays out.
 */
export function rowSpacingShading(input: {
  readonly stylePropertyNodes: readonly OoxmlElement[];
  readonly tableProperties: OoxmlElement | undefined;
  readonly rowNodes: readonly OoxmlElement[];
  readonly rowIds: readonly string[];
  readonly cellSpacingPt: number;
  readonly closingPt: number;
}): ReadonlyMap<string, TableSpacingShading> {
  const shading = new Map<string, TableSpacingShading>();
  if (!(input.cellSpacingPt > 0) || input.rowIds.length === 0) return shading;
  const layers = [...input.stylePropertyNodes, input.tableProperties];
  const tableFill = cascade(layers);
  const lastId = input.rowIds.at(-1);
  for (const node of input.rowNodes) {
    const exception = tblPrEx(node);
    const fill = exception ? cascade([...layers, exception]) : tableFill;
    if (fill === undefined) continue;
    shading.set(
      node.id,
      node.id === lastId && input.closingPt > 0 ? { fill, closingPt: input.closingPt } : { fill }
    );
  }
  return shading;
}

function clip(box: LayoutBox, to: LayoutBox): LayoutBox | null {
  const x = Math.max(box.x, to.x);
  const y = Math.max(box.y, to.y);
  const right = Math.min(box.x + box.width, to.x + to.width);
  const bottom = Math.min(box.y + box.height, to.y + to.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/**
 * The bands a table fragment fills, one per shaded row: the row box, extended by the closing
 * gap below the table's last row, less every cell box that reaches into it. A cell merged
 * down from an earlier row stays a hole in each row it crosses. Bounded by the fragment's
 * cells: each cell is tested only against the rows it can reach.
 */
export function tableSpacingShadingRegions(
  fragment: Pick<TableFragmentRecord, 'rows'>
): readonly TableSpacingShadingRegion[] {
  const regions: TableSpacingShadingRegion[] = [];
  let open: LayoutBox[] = [];
  for (const row of fragment.rows) {
    const cells: LayoutBox[] = [];
    for (const cell of row.cells) if (!cell.paintInert) cells.push(cell.box);
    const shading = row.spacingShading;
    if (shading) {
      const closing = row.hasContinuation ? 0 : (shading.closingPt ?? 0);
      const box = { ...row.box, height: row.box.height + closing };
      const holes: LayoutBox[] = [];
      for (const cell of open) {
        const hole = clip(cell, box);
        if (hole) holes.push(hole);
      }
      for (const cell of cells) {
        const hole = clip(cell, box);
        if (hole) holes.push(hole);
      }
      regions.push({ fill: shading.fill, box, holes });
    }
    // Only a cell that reaches below its row can cover a later one.
    const rowBottom = row.box.y + row.box.height;
    open = open.filter((cell) => cell.y + cell.height > rowBottom + 0.001);
    for (const cell of cells) if (cell.y + cell.height > rowBottom + 0.001) open.push(cell);
  }
  return regions;
}
