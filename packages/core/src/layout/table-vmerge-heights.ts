// Row heights for a table whose cells merge vertically (17.4.85 `w:vMerge`).
//
// A merged cell covers several rows, so Word sizes the MERGE, not the row that starts it:
// the span gets `max(sum of the spanned rows' own heights, the merged content's height)`.
// Sizing the first row to the whole merged content instead pushes every later row of the
// span down by the full content height — the rows fall off the page and the column beside
// the merge paints as one band of the first row's fill.
//
// The surplus — merged content taller than the rows it covers — goes to the LAST row of the
// span that is allowed to grow, not evenly across the span. Word's own rendering of a
// four-row merge settles that: every row but the last painted at exactly its `w:trHeight`
// minimum and the last one painted 6pt over its minimum, which is the whole surplus. An
// even split would have moved the second and third band edges as well, and Word left them
// where the minimums put them. A row with `w:trHeight hRule="exact"` cannot grow (17.18.37),
// so the surplus skips it; when NO row of the span can grow, the span keeps its authored
// height and the merged content is clipped to it, the same as Word clips an exact row.
//
// A span is decided ONE AT A TIME, by the caller, against the page it will really land on:
//
// - `heightOf` says what the span needs, with every span accepted before it folded in;
// - `accept` takes it into the plan — its head is DETACHED from its own row (the row is then
//   sized by the cells that really belong to it), its rows take height floors, and the
//   head's content gets a hard bottom so it can never paint past the span;
// - a merge NOT accepted stays exactly where it was before this module existed: its head
//   sizes its own row, and the ordinary row-split machinery paginates it.
//
// Declining one merge does not decline its neighbours. Two merges in different columns that
// only overlap by a row are separate decisions, so a table where the second one cannot be
// kept whole still gets the benefit for the first.
//
// Two shapes are declined outright, both because a span is only safe while nothing can move
// its rows or change their heights after it was measured and its head's bottom was pinned:
//
// - a span with ANOTHER merge head in a row below its own head row. That head sizes its own
//   row when it is declined, which is a height this span never measured, and the row can
//   then take the paginator's whole-row move and leave this span's content behind on the
//   page above with no table under it;
// - a span whose surplus would land in a row an accepted span already covers, which would
//   grow that span after its bottom was pinned and after it was judged to fit the page.
//
// Measurement is not repeated work: a row inside an accepted span is probed here instead of
// by the paginator, so only the merge head itself costs one extra probe.
//
// NOT handled: a `w:vMerge w:val="restart"` inside a leading `w:tblHeader` row. The header
// group is placed by its own path and repeats on every continuation page, so the merge would
// have to be re-headed per page. Filed as issue #518; those merges keep the old behavior.

import type {
  SemanticTableCell,
  SemanticTableRow,
  SemanticTableStructure,
} from './semantic-table.ts';
import { resolveVMergeSpans, type TableVMergeResolveBudget } from './table-vmerge.ts';

/** Sub-point drift between a probe and the real placement is not a height difference. */
const EPSILON_PT = 0.001;

/** How the vertical merges accepted so far change ONE row's placement. */
export interface RowVMergeLayoutOptions {
  /**
   * Merge heads in this row that cover later rows, each mapped to the y its content must
   * stop at. Their content paints from this row but must not size it — the span carries
   * that height — and must not paint past the span, whose last row may be clipped or on
   * another page.
   */
  readonly detachedBottomPtByCellId?: ReadonlyMap<string, number>;
  /** Minimum finished height: the row's own height plus any surplus the span put on it. */
  readonly heightFloorPt?: number;
}

/** One `w:vMerge` chain: the head cell and the rows it covers. */
export interface VMergeSpan {
  readonly headRow: number;
  /** Last row covered, inclusive. Always greater than `headRow`. */
  readonly endRow: number;
  readonly headCellId: string;
}

/** Per-row placement advice for one table; `null` when no merge covers more than one row. */
export interface VMergeRowHeights {
  /** Merges that START at this row, longest first. Decide each before placing the row. */
  spansAt(rowIndex: number): readonly VMergeSpan[];
  /** Points the span needs below its head row's top, with accepted spans folded in. */
  heightOf(span: VMergeSpan): number;
  /**
   * Take the span into the plan, unless its shape is one the module declines (see the top of
   * this file). `headTopPt` is where its head row is being placed; calling it again after the
   * row moves to another page re-aims the head's bottom and nothing else.
   */
  accept(span: VMergeSpan, headTopPt: number): void;
  /** Placement options for a row covered by an accepted span, `undefined` otherwise. */
  rowOptions(rowIndex: number): RowVMergeLayoutOptions | undefined;
}

/** Probes one row's natural height with no page position and no anchor side effects. */
export type RowHeightProbe = (row: SemanticTableRow) => number;

interface MergeHead {
  readonly span: VMergeSpan;
  readonly cell: SemanticTableCell;
}

/** The row as it stands with the merge heads' content removed: their height is the span's. */
function rowWithoutHeadContent(
  row: SemanticTableRow,
  heads: ReadonlySet<string> | undefined
): SemanticTableRow {
  if (!heads || heads.size === 0) return row;
  return {
    ...row,
    cells: row.cells.map((cell) => (heads.has(cell.id) ? { ...cell, blocks: [] } : cell)),
  };
}

/** Just the merged cell, at its own grid column: what the span has to be tall enough for. */
function soloHeadRow(row: SemanticTableRow, cell: SemanticTableCell): SemanticTableRow {
  return { ...row, height: { rule: 'auto' }, cells: [cell] };
}

function collectHeads(
  rows: readonly SemanticTableRow[],
  budget: TableVMergeResolveBudget | undefined
): { readonly heads: MergeHead[]; readonly headIdsByRow: Map<number, Set<string>> } {
  const spans = resolveVMergeSpans(rows, undefined, budget);
  const heads: MergeHead[] = [];
  const headIdsByRow = new Map<number, Set<string>>();
  for (let headRow = 0; headRow < rows.length; headRow += 1) {
    for (const cell of rows[headRow]!.cells) {
      const covered = spans.get(cell.id);
      if (covered === undefined || covered < 2) continue;
      const endRow = Math.min(headRow + covered - 1, rows.length - 1);
      if (endRow <= headRow) continue;
      heads.push({ span: { headRow, endRow, headCellId: cell.id }, cell });
      const ids = headIdsByRow.get(headRow);
      if (ids) ids.add(cell.id);
      else headIdsByRow.set(headRow, new Set([cell.id]));
    }
  }
  return { heads, headIdsByRow };
}

/**
 * Plan the row heights of one table around its vertical merges.
 *
 * `rows` are the rows the caller places, in order — for a paginated table that is the BODY
 * rows, so a merge is never planned against a repeated header copy of a row. Returns `null`
 * when no merge covers more than one row, which leaves those tables on exactly the path
 * they were on before.
 */
export function planVMergeRowHeights(
  rows: readonly SemanticTableRow[],
  probeRowHeightPt: RowHeightProbe,
  budget?: TableVMergeResolveBudget
): VMergeRowHeights | null {
  if (rows.length === 0) return null;
  const { heads, headIdsByRow } = collectHeads(rows, budget);
  if (heads.length === 0) return null;

  const headBySpan = new Map<VMergeSpan, MergeHead>(heads.map((head) => [head.span, head]));
  const spansByRow = new Map<number, VMergeSpan[]>();
  for (const head of heads) {
    const at = spansByRow.get(head.span.headRow);
    if (at) at.push(head.span);
    else spansByRow.set(head.span.headRow, [head.span]);
  }
  // Longest first: the outer merge takes its decision before one that only overlaps it.
  for (const at of spansByRow.values()) at.sort((a, b) => b.endRow - a.endRow);

  const basePt = new Map<number, number>();
  const contentPt = new Map<VMergeSpan, number>();
  const surplusPt = new Map<number, number>();
  const coveredRows = new Set<number>();
  const acceptedSpans = new Set<VMergeSpan>();
  const acceptedHeadIds = new Set<string>();
  const detachedByRow = new Map<number, Map<string, number>>();

  /** The row's own height, with every merge head in it emptied. Probed once. */
  const baseOf = (rowIndex: number): number => {
    const known = basePt.get(rowIndex);
    if (known !== undefined) return known;
    const measured = probeRowHeightPt(
      rowWithoutHeadContent(rows[rowIndex]!, headIdsByRow.get(rowIndex))
    );
    basePt.set(rowIndex, measured);
    return measured;
  };

  const contentOf = (span: VMergeSpan): number => {
    const known = contentPt.get(span);
    if (known !== undefined) return known;
    const head = headBySpan.get(span)!;
    const measured = probeRowHeightPt(soloHeadRow(rows[span.headRow]!, head.cell));
    contentPt.set(span, measured);
    return measured;
  };

  const floorOf = (rowIndex: number): number => baseOf(rowIndex) + (surplusPt.get(rowIndex) ?? 0);

  /** Another merge starting under this one's head row: see the shapes declined above. */
  const headsBelowHead = (span: VMergeSpan): boolean => {
    for (let rowIndex = span.headRow + 1; rowIndex <= span.endRow; rowIndex += 1) {
      if (headIdsByRow.has(rowIndex)) return true;
    }
    return false;
  };

  const coveredPtOf = (span: VMergeSpan): number => {
    let total = 0;
    for (let rowIndex = span.headRow; rowIndex <= span.endRow; rowIndex += 1) {
      total += floorOf(rowIndex);
    }
    return total;
  };

  /** Last row of the span Word lets grow: `hRule="exact"` fixes a row at its authored box. */
  const lastGrowableRow = (span: VMergeSpan): number | undefined => {
    for (let rowIndex = span.endRow; rowIndex >= span.headRow; rowIndex -= 1) {
      if (rows[rowIndex]!.height.rule !== 'exact') return rowIndex;
    }
    return undefined;
  };

  const spanHeightOf = (span: VMergeSpan): number => {
    const covered = coveredPtOf(span);
    if (lastGrowableRow(span) === undefined) return covered;
    return Math.max(covered, contentOf(span));
  };

  return {
    spansAt: (rowIndex) => spansByRow.get(rowIndex) ?? [],
    heightOf: spanHeightOf,
    accept: (span, headTopPt) => {
      if (!acceptedSpans.has(span)) {
        if (headsBelowHead(span)) return;
        const covered = coveredPtOf(span);
        const growable = lastGrowableRow(span);
        const surplus = growable === undefined ? 0 : contentOf(span) - covered;
        // Growing a row an accepted span already covers would move that span's bottom out
        // from under content already aimed at it.
        if (surplus > EPSILON_PT && coveredRows.has(growable!)) return;
        if (surplus > EPSILON_PT) {
          surplusPt.set(growable!, (surplusPt.get(growable!) ?? 0) + surplus);
        }
        for (let rowIndex = span.headRow; rowIndex <= span.endRow; rowIndex += 1) {
          coveredRows.add(rowIndex);
        }
        acceptedSpans.add(span);
        acceptedHeadIds.add(span.headCellId);
      }
      const bottoms = detachedByRow.get(span.headRow) ?? new Map<string, number>();
      bottoms.set(span.headCellId, headTopPt + spanHeightOf(span));
      detachedByRow.set(span.headRow, bottoms);
    },
    rowOptions: (rowIndex) => {
      if (!coveredRows.has(rowIndex)) return undefined;
      const detachedBottomPtByCellId = detachedByRow.get(rowIndex);
      // A head nobody took still sizes its own row, so the planned floor is not that row's
      // height and the caller has to measure it.
      const heads = headIdsByRow.get(rowIndex);
      const planned = !heads || [...heads].every((id) => acceptedHeadIds.has(id));
      return {
        ...(detachedBottomPtByCellId ? { detachedBottomPtByCellId } : {}),
        ...(planned ? { heightFloorPt: floorOf(rowIndex) } : {}),
      };
    },
  };
}

/**
 * Take every merge that starts at `rowIndex` and fits between `rowTopPt` and
 * `contentBottomPt`, and return this row's placement options.
 *
 * The fit is judged where the row is ACTUALLY about to be placed, which is why this is
 * called from the placing loop rather than planned up front: a page break re-emits repeated
 * header rows and can open a page with a shorter content box. It never breaks a page of its
 * own — the caller's whole-row move does that, and calls again on the fresh page, where a
 * merge that did not fit before may fit now. A merge that still does not fit is simply not
 * taken, which leaves it on the row-by-row path where the row-split machinery paginates it
 * exactly as it did before.
 */
export function admitVMergeSpansAt(
  plan: VMergeRowHeights | null,
  rowIndex: number,
  rowTopPt: number,
  contentBottomPt: number
): RowVMergeLayoutOptions | undefined {
  for (const span of plan?.spansAt(rowIndex) ?? []) {
    if (rowTopPt + plan!.heightOf(span) > contentBottomPt + EPSILON_PT) continue;
    plan!.accept(span, rowTopPt);
  }
  return plan?.rowOptions(rowIndex);
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
): VMergeRowHeights | null {
  return planVMergeRowHeights(
    structure.rows,
    (row) => measure(row, structure.columnWidthsPt, left, depth, deps, structure.cellSpacingPt),
    budget
  );
}

/**
 * Accept every merge starting at `rowIndex` for a table that is placed in one pass, where
 * there is no page to fall off and so no fit to judge.
 */
export function acceptVMergeSpansAt(
  plan: VMergeRowHeights | null,
  rowIndex: number,
  rowTopPt: number
): RowVMergeLayoutOptions | undefined {
  for (const span of plan?.spansAt(rowIndex) ?? []) plan!.accept(span, rowTopPt);
  return plan?.rowOptions(rowIndex);
}
