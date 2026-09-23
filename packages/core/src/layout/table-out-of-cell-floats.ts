// Floats a table cell anchors but Word lays out against the page (`layoutInCell="0"` before
// mode 15), and the rows they push.
//
// Printed from Word 16.113 in mode 14: such an object wraps like a BODY float. It stays where
// it resolves from the table's original, unpushed layout, and every row whose band touches
// or crosses the object's band moves below it, with the rows after it. It does not matter
// whether the row overlaps the object horizontally. `wrapNone`, in-front and behind objects
// push nothing. The object does not move with the rows it pushed.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { anchorLaidOutInCell, cellAnchorScope } from './cell-anchor-layout.ts';
import {
  anchoredDrawingAtomsInParagraph,
  emuToPoints,
  shiftAnchoredDrawingRecords,
  type AnchoredDrawingRecord,
  type InlineDrawingLayoutContext,
} from './drawing-layout.ts';
import type { SemanticTableStructure } from './semantic-table.ts';
import {
  createTableBorderOwnershipBudget,
  createTableVMergeResolveBudget,
  layoutTableFragment,
  type TableFlowDeps,
} from './semantic-table-layout.ts';

const EPSILON = 0.001;

/**
 * How far above a float a row may end and still touch it. The engine resolves a float at
 * the top of its anchor row's content, inside the rule drawn between the rows; Word resolves
 * it on the row edge, so the row above ends exactly where it begins and moves too. 1.5 pt
 * covers the rules Word draws by default (0.5 pt) and the common 1 pt ones.
 */
const ROW_TOUCH_PT = 1.5;

/** A vertical band an out-of-cell float keeps clear, in page-content points. */
export interface OutOfCellBand {
  readonly top: number;
  readonly bottom: number;
}

/**
 * Paragraphs of the table's own cells whose every anchor is an out-of-cell float that wraps
 * text. A paragraph that mixes such a float with an in-cell one is left out: the pin below
 * moves a paragraph's records together, and the in-cell one must move with its row.
 */
export function outOfCellFloatParagraphs(
  structure: SemanticTableStructure,
  deps: TableFlowDeps
): ReadonlySet<string> {
  const layout = deps.inlineDrawingLayout;
  const found = new Set<string>();
  if (!layout) return found;
  const scope = cellAnchorScope(true, deps);
  for (const row of structure.rows) {
    for (const cell of row.cells) {
      for (const block of cell.blocks) {
        if (block.kind !== 'paragraph') continue;
        if (paragraphFloatsOutOfCell(block, layout, scope)) found.add(block.id);
      }
    }
  }
  return found;
}

function paragraphFloatsOutOfCell(
  paragraph: OoxmlElement,
  layout: InlineDrawingLayoutContext,
  scope: ReturnType<typeof cellAnchorScope>
): boolean {
  const atoms = anchoredDrawingAtomsInParagraph(paragraph, layout);
  if (atoms.length === 0) return false;
  return atoms.every(({ projection }) => {
    if (projection.hidden || projection.anchor?.behindDocument) return false;
    if (!['square', 'tight', 'through', 'topAndBottom'].includes(projection.wrap)) return false;
    return !anchorLaidOutInCell(projection, scope);
  });
}

/** The bands the pinned floats keep clear, from where the unpushed probe placed them. */
export function outOfCellBands(
  drawings: readonly AnchoredDrawingRecord[],
  paragraphIds: ReadonlySet<string>,
  layout: InlineDrawingLayoutContext
): readonly OutOfCellBand[] {
  const bands: OutOfCellBand[] = [];
  for (const drawing of drawings) {
    if (!paragraphIds.has(drawing.anchorParagraphId)) continue;
    const distances = layout.projectionForAtom?.(drawing.drawingNodeId)?.wrapGeometry?.distancesEmu;
    const top = drawing.paintBounds.y - (distances ? emuToPoints(distances.top) : 0);
    const bottom =
      drawing.paintBounds.y +
      drawing.paintBounds.height +
      (distances ? emuToPoints(distances.bottom) : 0);
    if (bottom > top + EPSILON) bands.push(Object.freeze({ top, bottom }));
  }
  return bands;
}

/**
 * Where a row whose height at `top` is `heightAt(top)` goes so that it clears every band.
 * Touching counts: a row that ends exactly where a float begins moves below it, as Word's
 * row above an anchor row at offset 0 does.
 */
export function rowTopClearOfBands(
  top: number,
  heightAt: (top: number) => number,
  bands: readonly OutOfCellBand[]
): number {
  let current = top;
  // Each move lands on a band bottom below the cursor, so the loop ends within one move per band.
  for (let moves = 0; moves <= bands.length; moves += 1) {
    const bottom = current + heightAt(current);
    const hit = bands.find(
      (band) => band.top <= bottom + ROW_TOUCH_PT && band.bottom > current + EPSILON
    );
    if (!hit) return current;
    current = hit.bottom;
  }
  return current;
}

/**
 * Lay the table out once at its original top, without pagination or sinks, and read where
 * its out-of-cell floats land. That is where Word keeps them: the rows move, they do not.
 */
export function probeOutOfCellBands(
  structure: SemanticTableStructure,
  tableId: string,
  left: number,
  top: number,
  paragraphIds: ReadonlySet<string>,
  deps: TableFlowDeps
): readonly OutOfCellBand[] {
  const layout = deps.inlineDrawingLayout;
  if (!layout || paragraphIds.size === 0) return [];
  const captured: AnchoredDrawingRecord[] = [];
  const capture = (drawings: readonly AnchoredDrawingRecord[]): void => {
    for (const drawing of drawings) captured.push(drawing);
  };
  let line = 0;
  layoutTableFragment(structure, left, top, 0, tableId, 0, {
    ...deps,
    publishAnchoredDrawings: capture,
    collectAnchoredDrawings: capture,
    deferAnchoredDrawings: undefined,
    onAnchorShift: (paragraphId, dy) => shiftAnchoredDrawingRecords(captured, paragraphId, dy),
    onAnchorRepublish: (paragraphId, drawings) => {
      for (let index = captured.length - 1; index >= 0; index -= 1)
        if (captured[index]!.anchorParagraphId === paragraphId) captured.splice(index, 1);
      capture(drawings);
    },
    onCellBreakKey: undefined,
    borderOwnershipBudget: createTableBorderOwnershipBudget(),
    vMergeResolveBudget: createTableVMergeResolveBudget(),
    nextLineId: () => `out-of-cell-float-probe-${line++}`,
  });
  return outOfCellBands(captured, paragraphIds, layout);
}
