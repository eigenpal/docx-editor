import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import type { CellWidthClaim } from './table-widths.ts';

/**
 * The grid columns a table lays out: the authored grid up to the last column any cell reaches.
 * Trailing columns that no cell reaches take no width, even when a row's `w:gridAfter` spans
 * them, so a one-cell row in a four-column grid is as wide as its cell. A row the view hides
 * may still reach them, so the whole grid stays when any row is hidden.
 */
export function reachedGridColumns<T>(
  gridCols: readonly T[],
  cellEnd: number,
  hasOmittedRows: boolean,
  compatibilityMode: number | undefined
): readonly T[] {
  if (!hasCompatibilityRule(compatibilityMode, 'unreachedGridColumnsTakeNoWidth')) return gridCols;
  if (hasOmittedRows || cellEnd <= 0 || cellEnd >= gridCols.length) return gridCols;
  return gridCols.slice(0, cellEnd);
}

/** The width claims that fall inside the first `columnCount` grid columns, cut to fit. */
export function claimsWithinGrid(
  claims: readonly CellWidthClaim[],
  columnCount: number
): readonly CellWidthClaim[] {
  if (claims.every((claim) => claim.start + claim.span <= columnCount)) return claims;
  return claims
    .filter((claim) => claim.start < columnCount)
    .map((claim) =>
      claim.start + claim.span <= columnCount
        ? claim
        : { ...claim, span: columnCount - claim.start }
    );
}
