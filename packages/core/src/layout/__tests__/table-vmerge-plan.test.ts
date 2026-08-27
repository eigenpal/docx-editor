// What the vMerge height plan is allowed to hand the paginator.
//
// The plan is ADVISORY. It raises a row's minimum height and takes a merge head's content
// out of its own row's height, and that is the whole of its authority: it may not hand out a
// position, because a row can move to another page after the plan was made and a position
// would then be a lie. Both rules below are the ones four rounds of review kept breaking.

import { describe, expect, test } from 'bun:test';
import type { SemanticTableCell, SemanticTableRow } from '../semantic-table.ts';
import { planVMergeRowHeights, type RowVMergeLayoutOptions } from '../table-vmerge-heights.ts';

const BORDERS = {
  top: { state: 'omitted' as const },
  left: { state: 'omitted' as const },
  bottom: { state: 'omitted' as const },
  right: { state: 'omitted' as const },
};

function cell(id: string, gridColumn: number, vMergeContinue = false): SemanticTableCell {
  return {
    id,
    gridSpan: 1,
    gridColumn,
    vMergeContinue,
    vAlign: 'top',
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    borders: BORDERS,
    preferredWidth: { type: 'auto' },
    styleFormatting: {},
    blocks: [],
  } as unknown as SemanticTableCell;
}

function row(id: string, cells: readonly SemanticTableCell[]): SemanticTableRow {
  return {
    id,
    isHeader: false,
    cantSplit: false,
    height: { rule: 'auto' },
    cells,
  } as unknown as SemanticTableRow;
}

/** Heights by cell id, so a probe answers with whatever the test wants each row to measure. */
function probeFrom(
  heights: Readonly<Record<string, number>>
): (probed: SemanticTableRow) => number {
  return (probed) => {
    let tallest = 10;
    for (const probedCell of probed.cells) {
      // An emptied head measures as an empty cell; anything else keeps its authored height.
      const authored = probedCell.blocks.length === 0 ? 10 : (heights[probedCell.id] ?? 10);
      tallest = Math.max(tallest, authored);
    }
    return tallest;
  };
}

/** A cell with content, so the probe can tell an emptied head from one that stayed. */
function filled(id: string, gridColumn: number): SemanticTableCell {
  return { ...cell(id, gridColumn), blocks: [{} as never] };
}

describe('the vMerge plan hands out heights, never positions', () => {
  test('no option a row can outlive: nothing in them is an absolute coordinate', () => {
    const rows = [
      row('r0', [filled('head', 0), filled('side0', 1)]),
      row('r1', [cell('cont', 0, true), filled('side1', 1)]),
    ];
    const plan = planVMergeRowHeights(rows, probeFrom({ head: 90, side0: 10, side1: 10 }))!;
    expect(plan).not.toBeNull();
    for (const span of plan.spansAt(0)) plan.accept(span);

    const options = plan.rowOptions(0)!;
    // The whole contract: a set of ids to detach, and a height. A `y` here would be read on
    // a page the row may already have left.
    expect(Object.keys(options).sort()).toEqual(['detachedCellIds', 'heightFloorPt']);
    expect([...(options.detachedCellIds ?? [])]).toEqual(['head']);
    expect(typeof options.heightFloorPt).toBe('number');
  });

  test('every covered row gets a floor, including one that still holds a declined head', () => {
    // Row 0 heads two merges. Column 0 covers rows 0-2, column 1 covers rows 0-1, and the
    // second is declined because its surplus would land on a row the first already covers.
    // The declined head goes on sizing row 0, so row 0's floor has to include it — measuring
    // row 0 without it judged the row against a height nobody would ever place.
    const rows = [
      row('r0', [filled('longHead', 0), filled('shortHead', 1)]),
      row('r1', [cell('c0', 0, true), cell('c1', 1, true)]),
      row('r2', [cell('c2', 0, true), filled('plain', 1)]),
    ];
    const plan = planVMergeRowHeights(rows, probeFrom({ longHead: 20, shortHead: 80, plain: 10 }))!;
    for (const span of plan.spansAt(0)) plan.accept(span);

    const head = plan.rowOptions(0)!;
    expect([...(head.detachedCellIds ?? [])]).toEqual(['longHead']);
    // 80, not 10: the declined head is still in the row, so it is still in the floor.
    expect(head.heightFloorPt).toBe(80);
    for (const rowIndex of [1, 2]) {
      const covered: RowVMergeLayoutOptions | undefined = plan.rowOptions(rowIndex);
      expect(covered?.heightFloorPt).toBeGreaterThan(0);
      expect(covered?.detachedCellIds).toBeUndefined();
    }
  });

  test('a span no row of which can grow is declined rather than handed a short box', () => {
    const exact = (id: string, cells: readonly SemanticTableCell[]): SemanticTableRow =>
      ({ ...row(id, cells), height: { rule: 'exact', valuePt: 20 } }) as SemanticTableRow;
    const rows = [
      exact('r0', [filled('head', 0), filled('side0', 1)]),
      exact('r1', [cell('cont', 0, true), filled('side1', 1)]),
    ];
    const plan = planVMergeRowHeights(rows, probeFrom({ head: 200, side0: 10, side1: 10 }))!;
    for (const span of plan.spansAt(0)) plan.accept(span);
    expect(plan.rowOptions(0)).toBeUndefined();
  });
});
