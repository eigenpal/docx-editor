// Row heights for a table whose cells merge vertically (17.4.85 `w:vMerge`).
//
// A merged cell covers several rows, so Word sizes the MERGE, not the row that starts it:
// the span gets `max(sum of the spanned rows' own heights, the merged content's height)`.
// Sizing the first row to the whole merged content instead pushes every later row of the
// span down by the full content height — the rows fall off the page and the column beside
// the merge paints as one band of the first row's fill.
//
// The surplus — merged content taller than the rows it covers — goes to the LAST row of the
// span, not evenly across it. Word's own rendering of a four-row merge settles that: every
// row but the last painted at exactly its `w:trHeight` minimum and the last one painted
// 6pt over its minimum, which is the whole surplus. An even split would have moved the
// second and third band edges as well, and Word left them where the minimums put them.
//
// The plan is built once per table, before any row is placed:
//
// - a merge head that covers more than one row is DETACHED from its own row, so the row is
//   sized by the cells that really belong to it;
// - each spanned row keeps a height FLOOR (its own height, and on the last row of a span
//   the surplus too), which is what the paginator treats as the row's natural height;
// - the spanned rows form a GROUP the paginator keeps on one page, because the merged
//   content is painted from the head's row top across the whole span.
//
// Measurement is not repeated work: rows inside a group are probed here instead of by the
// paginator, so only the merge head itself costs one extra probe.

import type {
  SemanticTableCell,
  SemanticTableRow,
  SemanticTableStructure,
} from './semantic-table.ts';
import { resolveVMergeSpans, type TableVMergeResolveBudget } from './table-vmerge.ts';

/** Sub-point drift between a probe and the real placement is not a height difference. */
const EPSILON_PT = 0.001;

/** How a vertically merged span changes ONE row's placement. */
export interface RowVMergeLayoutOptions {
  /**
   * Merge heads in this row that cover later rows. Their content is painted from this row
   * but must not size it — the span as a whole carries that height.
   */
  readonly detachedCellIds?: ReadonlySet<string>;
  /** Minimum finished height: the row's own height plus its share of the span's surplus. */
  readonly heightFloorPt?: number;
}

/** Consecutive rows tied together by at least one vertical merge. */
export interface VMergeRowGroup {
  /** First row index of the group, in the row list the plan was built from. */
  readonly startRow: number;
  /** Last row index of the group (inclusive). */
  readonly endRow: number;
  /** Total height of the group once every floor is applied. */
  readonly heightPt: number;
}

/** Per-row placement advice for one table; `null` when no merge covers more than one row. */
export interface VMergeRowHeightPlan {
  /** The group that STARTS at this row index, or `undefined` when none does. */
  groupAt(rowIndex: number): VMergeRowGroup | undefined;
  /** Placement options for a row inside a group, or `undefined` for an ordinary row. */
  rowOptions(rowIndex: number): RowVMergeLayoutOptions | undefined;
}

/** Probes one row's natural height with no page position and no anchor side effects. */
export type RowHeightProbe = (row: SemanticTableRow) => number;

interface MergeHead {
  readonly rowIndex: number;
  readonly cell: SemanticTableCell;
  /** Rows covered, clamped to the row list (a truncated chain keeps the rows it has). */
  readonly span: number;
}

/** The row as it stands with the spanning cells' content removed: their height is the span's. */
function rowWithoutDetachedContent(
  row: SemanticTableRow,
  detached: ReadonlySet<string> | undefined
): SemanticTableRow {
  if (!detached || detached.size === 0) return row;
  return {
    ...row,
    cells: row.cells.map((cell) => (detached.has(cell.id) ? { ...cell, blocks: [] } : cell)),
  };
}

/** Just the merged cell, at its own grid column: what the span has to be tall enough for. */
function soloHeadRow(row: SemanticTableRow, cell: SemanticTableCell): SemanticTableRow {
  return { ...row, height: { rule: 'auto' }, cells: [cell] };
}

function collectHeads(
  rows: readonly SemanticTableRow[],
  budget: TableVMergeResolveBudget | undefined
): { readonly heads: MergeHead[]; readonly detachedByRow: Map<number, Set<string>> } {
  const spans = resolveVMergeSpans(rows, undefined, budget);
  const heads: MergeHead[] = [];
  const detachedByRow = new Map<number, Set<string>>();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (const cell of rows[rowIndex]!.cells) {
      const span = spans.get(cell.id);
      if (span === undefined || span < 2) continue;
      const endRow = Math.min(rowIndex + span - 1, rows.length - 1);
      if (endRow <= rowIndex) continue;
      heads.push({ rowIndex, cell, span: endRow - rowIndex + 1 });
      const detached = detachedByRow.get(rowIndex);
      if (detached) detached.add(cell.id);
      else detachedByRow.set(rowIndex, new Set([cell.id]));
    }
  }
  return { heads, detachedByRow };
}

/** Maximal runs of rows joined by overlapping or adjacent spans, in row order. */
function groupRanges(heads: readonly MergeHead[]): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (const head of heads) {
    const end = head.rowIndex + head.span - 1;
    const open = ranges[ranges.length - 1];
    if (open && head.rowIndex <= open.end) open.end = Math.max(open.end, end);
    else ranges.push({ start: head.rowIndex, end });
  }
  return ranges;
}

/**
 * Plan the row heights of one table around its vertical merges.
 *
 * `rows` are the rows the caller paginates, in order — for a paginated table that is the
 * BODY rows, so a merge is never planned against a repeated header copy of a row.
 * Returns `null` when no merge covers more than one row, which leaves those tables on
 * exactly the path they were on before.
 */
export function planVMergeRowHeights(
  rows: readonly SemanticTableRow[],
  probeRowHeightPt: RowHeightProbe,
  budget?: TableVMergeResolveBudget
): VMergeRowHeightPlan | null {
  if (rows.length === 0) return null;
  const { heads, detachedByRow } = collectHeads(rows, budget);
  if (heads.length === 0) return null;

  const ranges = groupRanges(heads);
  const floors = new Map<number, number>();
  for (const range of ranges) {
    for (let rowIndex = range.start; rowIndex <= range.end; rowIndex += 1) {
      floors.set(
        rowIndex,
        probeRowHeightPt(rowWithoutDetachedContent(rows[rowIndex]!, detachedByRow.get(rowIndex)))
      );
    }
  }

  // Heads are visited in row order, so a second merge inside the same group already sees
  // what the first one grew.
  for (const head of heads) {
    const contentPt = probeRowHeightPt(soloHeadRow(rows[head.rowIndex]!, head.cell));
    const lastRow = head.rowIndex + head.span - 1;
    let coveredPt = 0;
    for (let rowIndex = head.rowIndex; rowIndex <= lastRow; rowIndex += 1) {
      coveredPt += floors.get(rowIndex) ?? 0;
    }
    if (contentPt <= coveredPt + EPSILON_PT) continue;
    floors.set(lastRow, (floors.get(lastRow) ?? 0) + (contentPt - coveredPt));
  }

  const groupByStart = new Map<number, VMergeRowGroup>();
  const groupRowSet = new Set<number>();
  for (const range of ranges) {
    let heightPt = 0;
    for (let rowIndex = range.start; rowIndex <= range.end; rowIndex += 1) {
      heightPt += floors.get(rowIndex) ?? 0;
      groupRowSet.add(rowIndex);
    }
    groupByStart.set(range.start, { startRow: range.start, endRow: range.end, heightPt });
  }

  return {
    groupAt: (rowIndex) => groupByStart.get(rowIndex),
    rowOptions: (rowIndex) => {
      if (!groupRowSet.has(rowIndex)) return undefined;
      const detachedCellIds = detachedByRow.get(rowIndex);
      return {
        ...(detachedCellIds ? { detachedCellIds } : {}),
        heightFloorPt: floors.get(rowIndex) ?? 0,
      };
    },
  };
}

/**
 * {@link planVMergeRowHeights} for a whole resolved structure, for the callers that place
 * every row of a table in one pass (a nested table, a header/footer story).
 *
 * `measure` is the row-height probe, taken as an argument rather than imported: the probe
 * lives with row layout, and this module stays free of that dependency.
 */
export function planTableVMergeHeights<Deps>(
  structure: SemanticTableStructure,
  left: number,
  depth: number,
  deps: Deps,
  measure: (
    row: SemanticTableRow,
    cols: readonly number[],
    left: number,
    depth: number,
    deps: Deps,
    cellSpacingPt?: number
  ) => number,
  budget?: TableVMergeResolveBudget
): VMergeRowHeightPlan | null {
  return planVMergeRowHeights(
    structure.rows,
    (row) => measure(row, structure.columnWidthsPt, left, depth, deps, structure.cellSpacingPt),
    budget
  );
}
