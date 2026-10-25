// A new fragment has no preceding cell. Do not carry a shared border from the previous page.
import { effectiveBorderSide } from './table-border-cascade.ts';
import { borderContentInset, cellContentInsets, simpleBandWidthPt } from './table-cell-geometry.ts';
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
  const own = row.cells.map((cell) =>
    borderContentInset(
      cell.margins.top,
      effectiveBorderSide(cell.borders.top, (cell.rowTableBorders ?? structure.tableBorders).top)
    )
  );
  // One boundary carries one content band: the row's widest top rule moves every cell down.
  let band = 0;
  for (const [index, cell] of row.cells.entries())
    band = Math.max(band, own[index]! - cell.margins.top);
  for (const [index, cell] of row.cells.entries()) {
    const top = Math.max(own[index]!, cell.margins.top + band);
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
  return closingRowContentDeps(structure, row, deps, 'bottom');
}

/**
 * A row split at the end of its fragment closes the fragment with the inside rule it would share
 * with the row below, not with the table's outer bottom edge.
 */
export function cutRowContentDeps(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  deps: TableFlowDeps
): TableFlowDeps {
  return closingRowContentDeps(structure, row, deps, 'insideH');
}

function closingRowContentDeps(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  deps: TableFlowDeps,
  edge: 'bottom' | 'insideH'
): TableFlowDeps {
  if (structure.cellSpacingPt > 0) return deps;
  const insets = new Map(deps.cellContentInsets);
  const minimumInsets = new Map(deps.cellMinimumContentInsets);
  let changed = false;
  for (const cell of row.cells) {
    const before = insets.get(cell.id) ?? cellContentInsets(cell, true);
    const bottom = borderContentInset(
      cell.margins.bottom,
      effectiveBorderSide(
        cell.borders.bottom,
        (cell.rowTableBorders ?? structure.tableBorders)[edge]
      )
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

/**
 * A split row continued below a repeated header reserves its own authored top rule, as a
 * body row does beside a repeat, rather than the band of the row it was authored under.
 */
export function repeatedHeaderContinuationDeps(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  deps: TableFlowDeps
): TableFlowDeps {
  if (structure.cellSpacingPt > 0) return deps;
  const reserve = row.cells.reduce(
    (widest, cell) =>
      cell.borders.top.state === 'edge'
        ? Math.max(widest, simpleBandWidthPt(cell.borders.top))
        : widest,
    -1
  );
  if (reserve < 0) return deps;
  const insets = new Map(deps.cellContentInsets);
  for (const cell of row.cells) {
    const before = insets.get(cell.id) ?? cellContentInsets(cell, true);
    insets.set(cell.id, { ...before, top: cell.margins.top + reserve });
  }
  return { ...deps, cellContentInsets: insets };
}

/** Content deps for a row about to open, continue in, or follow rows of one fragment. */
export function fragmentRowContentDeps(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  deps: TableFlowDeps,
  placed: readonly { readonly isHeaderRepeat?: boolean }[],
  isContinuation: boolean
): TableFlowDeps {
  if (placed.length === 0) return firstRowContentDeps(structure, row, deps);
  return isContinuation && placed.every((item) => item.isHeaderRepeat)
    ? repeatedHeaderContinuationDeps(structure, row, deps)
    : deps;
}
