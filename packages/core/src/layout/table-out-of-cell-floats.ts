// Floats a table cell anchors but Word lays out against the page (`layoutInCell="0"` before
// mode 15), and the rows they push.
//
// Printed from Word 16.113 in mode 14: such an object wraps like a BODY float. It stays where
// it resolves from the table's original, unpushed layout, and every row whose band touches
// or crosses the object's band moves below it, with the rows after it. It does not matter
// whether the row overlaps the object horizontally. `wrapNone`, in-front and behind objects
// push nothing. The object does not move with the rows it pushed.
//
// Only the cases this module can place exactly take part: a top-level cell paragraph whose
// every anchor is such a float, in a table with no vertical merges and a top-aligned cell.
// Everything else keeps the cell flow's own handling (see `anchoredOutOfCell`).

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { anchorLaidOutInCell, cellAnchorScope } from './cell-anchor-layout.ts';
import { wrapProducesExclusion } from './drawing-exclusion.ts';
import {
  anchoredDrawingAtomsInParagraph,
  emuToPoints,
  type AnchoredDrawingRecord,
  type InlineDrawingLayoutContext,
} from './drawing-layout.ts';
import { shiftAnchoredDrawing } from './drawing-overlap.ts';
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import type { TableFragmentRecord } from './semantic-records.ts';
import {
  createTableBorderOwnershipBudget,
  createTableVMergeResolveBudget,
  layoutTableFragment,
  type TableFlowDeps,
} from './semantic-table-layout.ts';

const EPSILON = 0.001;

/** A vertical band an out-of-cell float keeps clear, in page-content points. */
interface OutOfCellBand {
  readonly top: number;
  readonly bottom: number;
}

export interface OutOfCellFloatPlan {
  /** The table's deps with the pin applied at publication; use them for every row. */
  readonly deps: TableFlowDeps;
  /**
   * Where rows of total height `heightAt(top)` go to clear every band, recording that push
   * for the floats of `rows`. Call it before placing those rows.
   */
  readonly clear: (
    top: number,
    heightAt: (top: number) => number,
    rows: readonly SemanticTableRow[]
  ) => number;
  /** The table left the sheet its floats are on: stop pushing, and pin nothing unplaced. */
  readonly end: () => void;
}

/**
 * Plan the rows an in-flow table's out-of-cell floats push, or null when it has none.
 *
 * The floats are placed by a probe of the whole table at its original top, and published
 * there: the push each float's row received is taken back as its records are published, so
 * page-bottom and overlap checks see the final position, never the pushed one.
 */
export function planOutOfCellFloats(
  structure: SemanticTableStructure,
  tableId: string,
  left: number,
  top: number,
  deps: TableFlowDeps
): OutOfCellFloatPlan | null {
  const layout = deps.inlineDrawingLayout;
  if (!layout) return null;
  const paragraphs = outOfCellFloatParagraphs(structure, layout, deps);
  if (paragraphs.size === 0) return null;
  let bands = probeBands(structure, tableId, left, top, paragraphs, layout, deps);
  let push = 0;
  const pushByParagraph = new Map<string, number>();
  const published = new Set<string>();
  const pin = (drawings: readonly AnchoredDrawingRecord[]): readonly AnchoredDrawingRecord[] =>
    drawings.map((drawing) => {
      const dy = pushByParagraph.get(drawing.anchorParagraphId);
      if (dy === undefined) return drawing;
      published.add(drawing.anchorParagraphId);
      return shiftAnchoredDrawing(drawing, 0, -dy);
    });
  const sink = (target: ((drawings: readonly AnchoredDrawingRecord[]) => void) | undefined) =>
    target && ((drawings: readonly AnchoredDrawingRecord[]) => target(pin(drawings)));
  const republish = deps.onAnchorRepublish;
  return {
    deps: {
      ...deps,
      publishAnchoredDrawings: sink(deps.publishAnchoredDrawings),
      collectAnchoredDrawings: sink(deps.collectAnchoredDrawings),
      ...(republish
        ? { onAnchorRepublish: (id: string, drawings) => republish(id, pin(drawings)) }
        : {}),
      outOfCellFloatParagraphs: paragraphs,
    },
    clear: (from, heightAt, rows) => {
      bands = bands.filter((band) => band.bottom > from + EPSILON);
      let current = from;
      for (let moves = 0; moves <= bands.length; moves += 1) {
        const bottom = current + heightAt(current);
        const hit = bands.find(
          (band) => band.top <= bottom + EPSILON && band.bottom > current + EPSILON
        );
        if (!hit) break;
        current = hit.bottom;
      }
      push += current - from;
      if (push > EPSILON)
        for (const row of rows)
          for (const cell of row.cells)
            for (const block of cell.blocks)
              if (paragraphs.has(block.id)) pushByParagraph.set(block.id, push);
      return current;
    },
    end: () => {
      bands = [];
      for (const id of pushByParagraph.keys()) if (!published.has(id)) pushByParagraph.delete(id);
    },
  };
}

/**
 * Top-level cell paragraphs whose every anchor is an out-of-cell float that wraps text. A
 * table with a vertical merge, or a cell that is not top-aligned, is left to the cell flow:
 * finalize moves such content after the probe placed it, so the probe could not pin it.
 */
function outOfCellFloatParagraphs(
  structure: SemanticTableStructure,
  layout: InlineDrawingLayoutContext,
  deps: TableFlowDeps
): ReadonlySet<string> {
  const found = new Set<string>();
  if (structure.rows.some((row) => row.cells.some((cell) => cell.vMergeContinue))) return found;
  const scope = cellAnchorScope(true, deps);
  for (const row of structure.rows) {
    for (const cell of row.cells) {
      if (cell.vAlign !== 'top') continue;
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
    if (!wrapProducesExclusion(projection.wrap)) return false;
    return !anchorLaidOutInCell(projection, scope);
  });
}

/**
 * Lay the table out once at its original top, without pagination and without its own
 * floats' zones from an earlier pass, and read the bands its floats keep clear.
 */
function probeBands(
  structure: SemanticTableStructure,
  tableId: string,
  left: number,
  top: number,
  paragraphs: ReadonlySet<string>,
  layout: InlineDrawingLayoutContext,
  deps: TableFlowDeps
): readonly OutOfCellBand[] {
  const captured: AnchoredDrawingRecord[] = [];
  const capture = (drawings: readonly AnchoredDrawingRecord[]): void => {
    for (const drawing of drawings) captured.push(drawing);
  };
  const zones = deps.pageExclusionZones;
  let line = 0;
  const probe = layoutTableFragment(structure, left, top, 0, tableId, 0, {
    ...deps,
    publishAnchoredDrawings: capture,
    collectAnchoredDrawings: capture,
    deferAnchoredDrawings: undefined,
    onAnchorShift: undefined,
    onAnchorRepublish: undefined,
    onCellBreakKey: undefined,
    ...(zones
      ? {
          pageExclusionZones: () =>
            zones().filter((zone) => !paragraphs.has(zone.anchorParagraphId ?? '')),
        }
      : {}),
    borderOwnershipBudget: createTableBorderOwnershipBudget(),
    vMergeResolveBudget: createTableVMergeResolveBudget(),
    nextLineId: () => `out-of-cell-float-probe-${line++}`,
  });
  const rowTops = rowTopByParagraph(probe.fragment);
  const bands: OutOfCellBand[] = [];
  for (const drawing of captured) {
    if (!paragraphs.has(drawing.anchorParagraphId)) continue;
    const distances = layout.projectionForAtom?.(drawing.drawingNodeId)?.wrapGeometry?.distancesEmu;
    const bottom =
      drawing.paintBounds.y +
      drawing.paintBounds.height +
      (distances ? emuToPoints(distances.bottom) : 0);
    let bandTop = drawing.paintBounds.y - (distances ? emuToPoints(distances.top) : 0);
    // Word resolves a float at the top of its row ON the row edge, where the engine resolves
    // it at the cell's content top, inside the rule between the rows. Measured from the edge,
    // the row above ends exactly where the float begins, and moves with it, as in Word.
    const row = rowTops.get(drawing.anchorParagraphId);
    if (row && bandTop <= row.contentTop + EPSILON) bandTop = Math.min(bandTop, row.top);
    if (bottom > bandTop + EPSILON) bands.push(Object.freeze({ top: bandTop, bottom }));
  }
  return bands;
}

/** Each cell's opening paragraph: its row's top, and the top of the content it opens. */
function rowTopByParagraph(
  fragment: TableFragmentRecord
): ReadonlyMap<string, { readonly top: number; readonly contentTop: number }> {
  const found = new Map<string, { readonly top: number; readonly contentTop: number }>();
  for (const row of fragment.rows) {
    for (const cell of row.cells) {
      const block = cell.blocks[0];
      if (block?.kind === 'paragraph')
        found.set(block.paragraphId, { top: row.box.y, contentTop: block.box.y });
    }
  }
  return found;
}
