// Read-only memo of a cell's content insets for the width lane.
//
// `cellContentInsets` is a pure function of an immutable structure cell and whether borders
// collapse. A width change re-reads it for every cell of the table, so moving rows and
// finalizing their fragment read it through here instead. Callers must not mutate the result.

import {
  borderContentInset,
  cellContentInsets,
  type CellContentInsets,
} from './table-cell-geometry.ts';
import { effectiveBorderSide } from './table-border-cascade.ts';
import type { TableBorderSide } from './table-borders.ts';
import type { SemanticTableCell } from './semantic-table.ts';

const collapsed = new WeakMap<SemanticTableCell, CellContentInsets>();
const separated = new WeakMap<SemanticTableCell, CellContentInsets>();

const bottomFloors = new WeakMap<
  SemanticTableCell,
  { readonly tableBottom: TableBorderSide; readonly value: number }
>();

/**
 * The bottom inset a cell needs to clear its whole outer bottom rule: `borderContentInset`
 * of its bottom margin and effective bottom edge under the table's bottom rule.
 */
export function outerBottomInsetFloor(cell: SemanticTableCell, tableBottom: TableBorderSide) {
  const known = bottomFloors.get(cell);
  if (known?.tableBottom === tableBottom) return known.value;
  const value = borderContentInset(
    cell.margins.bottom,
    effectiveBorderSide(cell.borders.bottom, tableBottom)
  );
  bottomFloors.set(cell, { tableBottom, value });
  return value;
}

/** `cellContentInsets(cell, collapsedBorders)`, shared per cell. */
export function sharedCellContentInsets(
  cell: SemanticTableCell,
  collapsedBorders: boolean
): CellContentInsets {
  const memo = collapsedBorders ? collapsed : separated;
  let known = memo.get(cell);
  if (!known) memo.set(cell, (known = cellContentInsets(cell, collapsedBorders)));
  return known;
}
