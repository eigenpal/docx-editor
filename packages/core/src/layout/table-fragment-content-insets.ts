// A new fragment has no preceding cell. Do not carry a shared border from the previous page.
import { effectiveBorderSide } from './table-border-cascade.ts';
import { borderContentInset, cellContentInsets } from './table-cell-geometry.ts';
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';

export function firstRowContentDeps(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  deps: TableFlowDeps
): TableFlowDeps {
  if (structure.cellSpacingPt > 0) return deps;
  const insets = new Map(deps.cellContentInsets);
  const minimumInsets = new Map(deps.cellMinimumContentInsets);
  for (const cell of row.cells) {
    const top = borderContentInset(
      cell.margins.top,
      effectiveBorderSide(cell.borders.top, structure.tableBorders.top)
    );
    insets.set(cell.id, {
      ...(insets.get(cell.id) ?? cellContentInsets(cell, true)),
      // There is no cell above a fragment's first row to share this stroke.
      top,
    });
    const minimum = minimumInsets.get(cell.id) ?? cell.minimumContentInsets;
    if (minimum) minimumInsets.set(cell.id, { ...minimum, top });
  }
  return {
    ...deps,
    cellContentInsets: insets,
    ...(minimumInsets.size ? { cellMinimumContentInsets: minimumInsets } : {}),
  };
}

/** The last row uses its own outer edge, without the next page's neighbor. */
export function lastRowContentDeps(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  deps: TableFlowDeps
): TableFlowDeps {
  if (structure.cellSpacingPt > 0) return deps;
  const insets = new Map(deps.cellContentInsets);
  const minimumInsets = new Map(deps.cellMinimumContentInsets);
  let changed = false;
  for (const cell of row.cells) {
    const before = insets.get(cell.id) ?? cellContentInsets(cell, true);
    const bottom = borderContentInset(
      cell.margins.bottom,
      effectiveBorderSide(cell.borders.bottom, structure.tableBorders.bottom)
    );
    if (before.bottom !== bottom) changed = true;
    insets.set(cell.id, { ...before, bottom });
    const minimum = minimumInsets.get(cell.id) ?? cell.minimumContentInsets;
    if (minimum) {
      if (minimum.bottom !== bottom) changed = true;
      minimumInsets.set(cell.id, { ...minimum, bottom });
    }
  }
  return changed
    ? {
        ...deps,
        cellContentInsets: insets,
        ...(minimumInsets.size ? { cellMinimumContentInsets: minimumInsets } : {}),
      }
    : deps;
}
