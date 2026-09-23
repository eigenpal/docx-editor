// How an anchored object inside a table cell relates to that cell.

import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import { isWord2013OrLaterMode } from './document-compatibility-mode.ts';
import type { LayoutBox } from './semantic-records.ts';

/**
 * Whether an anchored object in a table cell is laid out in that cell.
 *
 * Word honours `wp:anchor/@layoutInCell="0"` only in compatibility mode 14 and below, or
 * with no mode declared. From mode 15 it ignores the flag and always lays the object out in
 * the cell: positioned against the cell and wrapping the cell's text, the same as `"1"`.
 * The projection keeps what the file says; this is the layout's reading of it.
 */
export function effectiveLayoutInCell(
  anchor: { readonly layoutInCell: boolean } | null | undefined,
  compatibilityMode: number | undefined
): boolean {
  if (isWord2013OrLaterMode(compatibilityMode)) return true;
  return anchor?.layoutInCell ?? true;
}

/**
 * An anchor in a table cell that Word lays out against the page instead (`layoutInCell="0"`
 * below mode 15). It is not part of the cell's flow and carves no side hole in it: Word runs
 * the cell's text straight through it. `topAndBottom` does not go through here: Word moves
 * the whole table below such an object, and pushing the cell's text down is the nearer
 * approximation of that than letting the object cover it.
 */
export function anchoredOutOfCell(
  projection: DrawingProjection,
  options: { readonly anchorCellBox?: LayoutBox | null; readonly compatibilityMode?: number }
): boolean {
  return (
    options.anchorCellBox != null &&
    !effectiveLayoutInCell(projection.anchor, options.compatibilityMode)
  );
}
