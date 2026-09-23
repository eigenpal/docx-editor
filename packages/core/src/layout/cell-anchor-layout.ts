// How an anchored object flowing inside a cell box relates to that box.
//
// Cell flow lays out more than table cells: header, footer, note and text-box stories reuse
// it, so "has a cell box" does not mean "is in a table". The compatibility-mode rule below
// is Word's for an anchor in a real `w:tc`. Every consumer (break-time wrap synthesis, record
// publication) asks {@link anchorLaidOutInCell}, so the wrap hole and the published object
// cannot disagree about where the object is.

import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import { isWord2013OrLaterMode } from './document-compatibility-mode.ts';
import type { LayoutBox } from './semantic-records.ts';

/** What decides `layoutInCell` for the anchors of one cell-flow paragraph. */
export interface CellAnchorScope {
  /** A real table cell, as opposed to a story box that reuses cell flow. */
  readonly inTableCell: boolean;
  readonly compatibilityMode: number | undefined;
}

export function cellAnchorScope(
  inTableCell: boolean | undefined,
  compatibilityMode: number | undefined
): CellAnchorScope {
  return Object.freeze({ inTableCell: inTableCell === true, compatibilityMode });
}

/**
 * Whether an anchored object that flows in a cell box is laid out in it.
 *
 * In a table cell, Word honours `layoutInCell="0"` in compatibility mode 14 and below or with
 * no mode declared: the object is then positioned against the page. From mode 15 Word ignores
 * the flag and lays the object out in the cell, positioned against it and wrapping its text,
 * the same as `"1"`. The projection keeps what the file says; this is the layout's reading.
 *
 * Outside a table the authored flag is read as it always was, in every mode. Word ignores it
 * there too, but it also runs header text under a square-wrapped logo that the engine wraps
 * around; reading `"0"` as `"1"` there would move those headers further from Word, not nearer.
 */
export function anchorLaidOutInCell(
  anchor: { readonly layoutInCell: boolean } | null | undefined,
  scope: CellAnchorScope
): boolean {
  if (scope.inTableCell && isWord2013OrLaterMode(scope.compatibilityMode)) return true;
  return anchor?.layoutInCell ?? true;
}

/**
 * An anchor in a table cell that Word lays out against the page instead. It is not part of
 * the cell's flow and carves no side hole in it: Word runs the cell's text straight through
 * it. `topAndBottom` does not go through here: Word moves the whole table below such an
 * object, and pushing the cell's text down is the nearer approximation of that than letting
 * the object cover it.
 */
export function anchoredOutOfCell(
  projection: DrawingProjection,
  options: {
    readonly anchorCellBox?: LayoutBox | null;
    readonly cellAnchorScope?: CellAnchorScope;
  }
): boolean {
  return (
    options.anchorCellBox != null &&
    options.cellAnchorScope !== undefined &&
    !anchorLaidOutInCell(projection.anchor, options.cellAnchorScope)
  );
}

/** The anchor frame a cell-flow paragraph breaks against, and the scope that reads it. */
export function cellAnchorFlow(
  width: number,
  available: number,
  scope: CellAnchorScope
): { readonly anchorCellBox: LayoutBox; readonly cellAnchorScope: CellAnchorScope } {
  return {
    anchorCellBox: Object.freeze({ x: 0, y: 0, width, height: Math.max(1, available) }),
    cellAnchorScope: scope,
  };
}
