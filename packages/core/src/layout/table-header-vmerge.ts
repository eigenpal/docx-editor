// Vertical merges inside the leading `w:tblHeader` rows (17.4.49, 17.4.85 `w:vMerge`).
//
// The header rows are placed as ONE group: measured together, moved whole, and repeated on
// every continuation page. A merge that starts and ends inside that group used to be sized by
// its head row alone, so the head row took the whole merged height and every other header row
// was added below it. The group is now planned by the same planner the body rows use
// (`table-vmerge-heights.ts`), at the y the group is about to be placed at, and the SAME plan
// gives both the height the paginator admits and the options each row is placed with.
//
// Three rules keep that plan safe inside a group that has no continuation page:
//
// - a merge whose chain goes on into the first body row is never planned here. Its head keeps
//   sizing its own header row, which is the shape the body rows and a repeated copy expect;
// - the group is atomic, so a merge is taken whatever the page bottom: the group moves or
//   degrades as a whole, and the planned height is never taller than the unplanned one;
// - a detached head that a side-effect-free placement at its real y shows owing a remainder
//   is withdrawn from the plan before anything is published (the one-pass rollback of
//   `layoutOnePassRow`). The check runs again just before the row is committed, because a row
//   placed above it may have published a wrap band since the group was measured.
//
// A group with no such merge keeps its row-by-row measurement exactly.

import {
  layoutRowFragment,
  vMergePlanFor,
  type LayoutRowBoundedResult,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import { firstRowContentDeps } from './table-fragment-content-insets.ts';
import { measuringFlowDeps } from './table-probe-deps.ts';
import type { RowVMergeLayoutOptions } from './table-vmerge-heights.ts';

/** One occurrence of the header group, planned at the top it is about to be placed at. */
export interface HeaderGroupPlan {
  /** The group's height from that top. */
  readonly heightPt: number;
  /**
   * True when a merge starts and ends inside the group. Such a group is planned again at each
   * top it is offered, because a merge's measurements belong to the y it was taken at.
   */
  readonly planned: boolean;
  /**
   * The options to commit header row `index` with at `rowTopPt`. Rechecks a row with a
   * detached head against the live wrap bands and withdraws its merge when the head would owe
   * a remainder, so the committed row never cuts merged content.
   */
  optionsAt(index: number, rowTopPt: number): RowVMergeLayoutOptions | undefined;
}

/**
 * Plan the header rows placed from `top`.
 *
 * `rowHeightOf` is the paginator's own unplanned row probe; rows no merge covers are measured
 * with it, the same way the group was measured before merges were planned here.
 */
export function planHeaderGroup(
  structure: SemanticTableStructure,
  headerRows: readonly SemanticTableRow[],
  left: () => number,
  top: number,
  deps: TableFlowDeps,
  rowHeightOf: (row: SemanticTableRow, top: number, deps: TableFlowDeps) => number
): HeaderGroupPlan {
  const count = headerRows.length;
  const first = headerRows[0];
  const unplannedHeightOf = (index: number, y: number): number =>
    rowHeightOf(
      headerRows[index]!,
      y,
      index === 0 ? firstRowContentDeps(structure, first!, deps) : deps
    );
  // The first body row joins the plan only so a chain that continues into it resolves to its
  // real length; `insideGroup` then keeps every such merge out.
  const following = structure.rows[count];
  const plan =
    count === 0
      ? null
      : vMergePlanFor(
          structure,
          left,
          0,
          deps,
          following ? [...headerRows, following] : headerRows,
          (row) => row.id === first!.id
        );
  const insideGroup = (span: { readonly endRow: number }): boolean => span.endRow < count;
  if (plan === null || !headerRows.some((_, index) => plan.spansAt(index).some(insideGroup))) {
    let heightPt = 0;
    for (let index = 0; index < count; index += 1)
      heightPt += unplannedHeightOf(index, top + heightPt);
    return { heightPt, planned: false, optionsAt: () => undefined };
  }

  // Placement lays every header row out with the group's first-row insets; so does the probe.
  const placeDeps = firstRowContentDeps(structure, first!, deps);
  const probe = (
    index: number,
    y: number,
    options: RowVMergeLayoutOptions
  ): LayoutRowBoundedResult =>
    layoutRowFragment(
      headerRows[index]!,
      structure.columnWidthsPt,
      left(),
      y,
      false,
      0,
      measuringFlowDeps(placeDeps, true),
      structure.cellSpacingPt,
      options
    );
  /** The row's options at `y`, withdrawn when a detached head would not finish inside its span. */
  const settle = (
    index: number,
    y: number,
    options: RowVMergeLayoutOptions | undefined
  ): { readonly options: RowVMergeLayoutOptions | undefined; readonly heightPt?: number } => {
    if (options === undefined) return { options };
    const placed = probe(index, y, options);
    if (placed.remainder === null) return { options, heightPt: placed.record.box.height };
    plan.withdrawAt(index);
    const rolledBack = plan.rowOptions(index);
    return rolledBack === undefined
      ? { options: undefined }
      : { options: rolledBack, heightPt: probe(index, y, rolledBack).record.box.height };
  };

  let heightPt = 0;
  for (let index = 0; index < count; index += 1) {
    const y = top + heightPt;
    for (const span of plan.spansAt(index)) {
      if (insideGroup(span)) plan.accept(span, y);
    }
    const settled = settle(index, y, plan.rowOptions(index));
    heightPt += settled.heightPt ?? unplannedHeightOf(index, y);
  }
  return {
    heightPt,
    planned: true,
    // Read from the plan, not from the walk: a withdrawal at commit changes the rows below it.
    optionsAt: (index, rowTopPt) => {
      const options = plan.rowOptions(index);
      if (options?.detachedSpanHeightPtByCellId === undefined) return options;
      return settle(index, rowTopPt, options).options;
    },
  };
}
