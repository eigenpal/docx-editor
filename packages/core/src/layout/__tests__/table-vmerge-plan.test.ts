// What the vMerge height plan is allowed to hand the paginator.
//
// The plan is ADVISORY. It raises a row's minimum height and takes a merge head's content
// out of its own row's height, and that is the whole of its authority: it may not hand out a
// position, because a row can move to another page after the plan was made and a position
// would then be a lie. Both rules below are the ones four rounds of review kept breaking.

import { describe, expect, test } from 'bun:test';
import type { SemanticTableCell, SemanticTableRow } from '../semantic-table.ts';
import {
  planVMergeRowHeights,
  type RowVMergeLayoutOptions,
  type VMergeRowHeights,
} from '../table-vmerge-heights.ts';

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

/**
 * Heights by cell id, standing in for row layout: the tallest cell wins, and a DETACHED cell
 * contributes nothing at all — not even an empty cell's line, which is the whole point of
 * passing the set through instead of blanking the cell's blocks.
 */
function probeFrom(
  heights: Readonly<Record<string, number>>
): (probed: SemanticTableRow, detached?: ReadonlySet<string>) => number {
  return (probed, detached) => {
    let tallest = 0;
    for (const probedCell of probed.cells) {
      if (detached?.has(probedCell.id)) continue;
      tallest = Math.max(tallest, heights[probedCell.id] ?? 10);
    }
    return tallest;
  };
}

/** A cell the probe gives an authored height to, as opposed to a bare continuation cell. */
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
    expect(Object.keys(options).sort()).toEqual(['detachedSpanHeightPtByCellId', 'heightFloorPt']);
    expect([...(options.detachedSpanHeightPtByCellId ?? [])]).toEqual([['head', 90]]);
    expect(typeof options.heightFloorPt).toBe('number');
  });

  test('every covered row gets a floor, including one that still holds a declined head', () => {
    // Row 0 heads two merges. Column 0 covers rows 0-2, column 1 covers rows 0-1, and the
    // second is declined for starting in a row that already has one planned.
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
    expect([...(head.detachedSpanHeightPtByCellId ?? []).keys()]).toEqual(['longHead']);
    // 80, not 10: the declined head is still in the row, so it is still in the floor.
    expect(head.heightFloorPt).toBe(80);
    for (const rowIndex of [1, 2]) {
      const covered: RowVMergeLayoutOptions | undefined = plan.rowOptions(rowIndex);
      expect(covered?.heightFloorPt).toBeGreaterThan(0);
      expect(covered?.detachedSpanHeightPtByCellId).toBeUndefined();
    }
  });

  test('a detached head costs the row nothing, not even an empty cell line', () => {
    // The probe used to blank a head's blocks instead of detaching it, and row layout gives
    // an empty cell a line plus its insets. That phantom line became a hard floor on a
    // placement where the head contributes nothing at all.
    const rows = [
      row('r0', [filled('head', 0), filled('side0', 1)]),
      row('r1', [cell('cont', 0, true), filled('side1', 1)]),
    ];
    const seen: (readonly string[] | undefined)[] = [];
    const plan = planVMergeRowHeights(rows, (probed, detached) => {
      seen.push(detached ? [...detached] : undefined);
      let tallest = 0;
      for (const probedCell of probed.cells) {
        if (detached?.has(probedCell.id)) continue;
        tallest = Math.max(tallest, probedCell.id === 'head' ? 90 : 12);
      }
      return tallest;
    })!;
    for (const span of plan.spansAt(0)) plan.accept(span);
    // The head reached the probe as a DETACHED id, never as a cell with its blocks removed.
    expect(seen.some((ids) => ids?.includes('head'))).toBe(true);
    expect(rows[0]!.cells[0]!.blocks.length).toBe(1);
    // Row 0 is 12: exactly what the cell that stayed needs, with nothing charged for the
    // head. The span's shortfall lands on the last row that can grow, as always.
    expect(plan.rowOptions(0)!.heightFloorPt).toBe(12);
    expect(plan.rowOptions(1)!.heightFloorPt).toBe(90 - 12);
  });

  test('the thousandth table of a pass plans exactly like the first', () => {
    // The plan holds no pass-scoped state, so a table's heights cannot depend on how much
    // of the document came before it. That mattered because a resumed pass starts at the
    // first changed block: with any shared allowance, a table near the end could plan its
    // merges after an edit and not plan them on reload.
    //
    // A thousand plans is far past what any allowance this module ever carried would have
    // survived, so reintroducing one fails this rather than passing on a technicality —
    // which is what the budgeted version of this test did.
    const rows = [
      row('r0', [filled('head', 0), filled('side0', 1)]),
      row('r1', [cell('cont', 0, true), filled('side1', 1)]),
    ];
    const planOnce = (): VMergeRowHeights => {
      const plan = planVMergeRowHeights(rows, probeFrom({ head: 90 }))!;
      for (const span of plan.spansAt(0)) plan.accept(span);
      return plan;
    };
    const first = planOnce();
    let last = first;
    for (let index = 0; index < 1000; index += 1) last = planOnce();

    expect(last.rowOptions(0)!.heightFloorPt).toBe(first.rowOptions(0)!.heightFloorPt);
    expect(last.rowOptions(1)!.heightFloorPt).toBe(first.rowOptions(1)!.heightFloorPt);
    expect(last.rowOptions(0)!.detachedSpanHeightPtByCellId?.get('head')).toBe(
      first.rowOptions(0)!.detachedSpanHeightPtByCellId?.get('head')
    );
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
