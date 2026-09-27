// Where a splittable row with an authored minimum height may start.
//
// A row with a `w:trHeight` `atLeast` minimum (§17.4.81) starts below content already in the
// column only when that minimum, padded by the row's margins as the row box pads it, fits the
// room left there. Otherwise the row moves to the next column or page, even when its first
// lines would fit, and even when its content is taller than a page. When the minimum fits, the
// row starts and splits as any other row. A continuation fragment has no minimum. A
// `w:keepNext` paragraph before the table prices the same height, so it moves with the row.
//
// Limit: a minimum taller than a fresh column below the repeated header rows is left to the
// ordinary row rules, which split the row where it stands.

import type { SemanticTableRow } from './semantic-table.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';
import { cellContentInsets } from './table-cell-geometry.ts';
import { authoredRowMinimumFloorPt } from './table-row-minimum-insets.ts';

/**
 * Height the first fragment of `row` needs where it starts: the padded `atLeast` minimum, or
 * undefined when the row has none. `freshRoomPt` is the room a fresh column offers the row;
 * a larger minimum also gives undefined.
 */
export function rowMinimumOpeningPt(
  row: SemanticTableRow,
  deps: TableFlowDeps,
  cellSpacingPt: number,
  freshRoomPt: number
): number | undefined {
  if (row.height.rule !== 'atLeast' || !(row.height.valuePt > 0)) return undefined;
  const cells = row.cells.map((cell) => ({
    cell,
    insets: deps.cellContentInsets?.get(cell.id) ?? cellContentInsets(cell, cellSpacingPt === 0),
  }));
  const minimum = authoredRowMinimumFloorPt(
    row.height.valuePt,
    cells,
    deps.cellMinimumContentInsets
  );
  return minimum <= freshRoomPt + 0.001 ? minimum : undefined;
}

/** Where a row would start in the column being filled, in page content coordinates. */
export interface RowMinimumPlace {
  readonly top: number;
  readonly columnTop: number;
  /** Bottom of the band on this page. */
  readonly bottom: number;
  /** Bottom of the full band a fresh page offers, note reserve ignored. */
  readonly band: number;
  /** Height of the header rows a fresh page repeats above the row. */
  readonly repeat: number;
}

/**
 * Whether the first fragment of `row` moves to the next column or page: content already sits
 * above `at.top` in the column, the minimum does not fit below it, and a fresh column holds it.
 */
export function rowMinimumMoves(
  row: SemanticTableRow,
  deps: TableFlowDeps,
  cellSpacingPt: number,
  at: RowMinimumPlace
): boolean {
  if (at.top <= at.columnTop + 0.001) return false;
  const fresh = at.band - at.columnTop - at.repeat;
  const minimum = rowMinimumOpeningPt(row, deps, cellSpacingPt, fresh);
  return minimum !== undefined && minimum > at.bottom - at.top + 0.001;
}
