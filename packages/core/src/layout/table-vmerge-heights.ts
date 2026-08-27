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
// - `accept` takes it into the plan — its head is DETACHED from its own row, so the row is
//   sized by the cells that really belong to it, and its rows take height floors;
// - a merge NOT accepted stays exactly where it was before this module existed: its head
//   sizes its own row, and the ordinary row-split machinery paginates it.
//
// The plan binds NOTHING a later row can contradict. It sets a floor under a row's height
// and takes a head's content out of its row's height; every number it hands out is a HEIGHT,
// turned into a position by whoever is placing, so nothing here goes stale when a row moves.
//
// A merged head is measured WHERE IT WILL SIT. `measureRowHeight` is otherwise position-free
// and drops wrap bands on purpose, which under-measures a head a floating drawing makes
// wrap; the span is then too short for its own content, and every way that ends — painting
// past the rows, clipping the tail, splitting a row that cannot split — is a defect. So the
// admission probe runs at the head row's real top with the bands in place. Getting the
// measurement right is the fix; the fallout is not something to choose between.
//
// Two things then keep the content inside the cell:
//
//   1. a detached head stops at the page content box AND at its own span. Both are bounds a
//      cell can hand back a remainder against, so neither swallows the line it stops: the
//      row splits and the next fragment carries the rest, the way any cell does;
//   2. every row of an accepted span lands in the same fragment as its head — the span was
//      admitted only because it fits the page from the head's top, and a covered row may not
//      break a page BEFORE placing something into it.
//
// Nothing here DISCARDS content to stay inside a box. Losing a word is worse than the
// overflow this module exists to stop, so where a bound bites, what it stops is carried.
//
// (2) holds at five break sites, for three different reasons:
//
//   whole-row move        an OPTIMIZATION — the row would sit here — so it is refused for a
//                         covered row, which is the only guard this design needs;
//   `remaining <= 0`      the page is already full, so the fragment reaches the bottom and
//                         so does the furthest (1) let the content go. Safe, allowed;
//   split continuation    the same, after placing to the page bottom. Safe, allowed;
//   `w:cantSplit` unfit   a RECOVERY: refusing it aborts the whole table instead;
//   nothing fitted        a RECOVERY, likewise.
//
// The two recoveries can still end a fragment above content the head already flowed, which
// paints merged text below its table. They stay allowed, because aborting a document is
// worse, and because the accurate admission probe is what stops them being reachable in the
// first place. `float-over-table-harness.ts` is where that claim gets tested.
//
// Declining one merge does not decline its neighbours. Two merges in different columns that
// only overlap by a row are separate decisions, so a table where the second one cannot be
// kept whole still gets the benefit for the first.
//
// Three shapes are declined outright, each from data that cannot change during placement:
//
// - a span with ANOTHER merge head in a row below its own head row. That head sizes its own
//   row, and a row whose height this span cannot predict is a row the paginator may move;
// - a span whose surplus would land in a row an accepted span already covers, which would
//   change that span's height after it was judged against the page;
// - a span every row of which is `hRule="exact"` and too short for the merged content. It is
//   the one span knowably unable to hold its own head, so the head keeps sizing its own row
//   and the exact height clips it there, which is what Word draws.
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
import {
  MAX_VMERGE_RESOLVE_CELLS,
  resolveVMergeSpans,
  type TableVMergeResolveBudget,
} from './table-vmerge.ts';

/** Sub-point drift between a probe and the real placement is not a height difference. */
const EPSILON_PT = 0.001;

/** How the vertical merges accepted so far change ONE row's placement. */
export interface RowVMergeLayoutOptions {
  /**
   * Merge heads in this row that cover later rows. Their content paints from this row but
   * must not size it — the span as a whole carries that height. It is still bounded by the
   * page, like every other cell's, so a head taller than a page paginates as one always did.
   */
  readonly detachedSpanHeightPtByCellId?: ReadonlyMap<string, number>;
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
  /**
   * Points the span needs below its head row's top, with accepted spans folded in.
   * `atYPt` is where the head row is about to be placed; passing it measures the merged
   * content under whatever wrap bands really cross the row instead of position-free.
   */
  heightOf(span: VMergeSpan, atYPt?: number): number;
  /**
   * Take the span into the plan, unless its shape is one the module declines (see the top of
   * this file). Idempotent: the caller offers a span again after a page move, and a span
   * already in the plan is unaffected because nothing here depends on where it was offered.
   */
  accept(span: VMergeSpan, atYPt?: number): void;
  /** Placement options for a row covered by an accepted span, `undefined` otherwise. */
  rowOptions(rowIndex: number): RowVMergeLayoutOptions | undefined;
}

/**
 * Probes one row's natural height with no page position and no anchor side effects.
 *
 * `detached` is passed straight through to the probe's own row layout, so the probe leaves
 * exactly the cells out that placement will leave out. Emptying a head's blocks instead
 * still charged the row an empty cell's line, and that phantom line became a floor.
 */
export type RowHeightProbe = (
  row: SemanticTableRow,
  detached?: ReadonlySet<string>,
  /** Measure the row at this page-content y, wrap bands included, instead of position-free. */
  atYPt?: number
) => number;

interface MergeHead {
  readonly span: VMergeSpan;
  readonly cell: SemanticTableCell;
}

/** Just the merged cell, at its own grid column: what the span has to be tall enough for. */
function soloHeadRow(row: SemanticTableRow, cell: SemanticTableCell): SemanticTableRow {
  return { ...row, height: { rule: 'auto' }, cells: [cell] };
}

/**
 * Probe layouts one plan may run. A probe re-enters nested-table layout, so a merge at every
 * level of a 16-deep nest multiplies passes rather than adding them; this is the ceiling
 * CLAUDE.md asks for on anything a file controls. Exhaustion fails soft: the table plans no
 * heights and keeps the behaviour it had before this module existed.
 */
export const MAX_VMERGE_PROBE_LAYOUTS = 4096;

/**
 * What one layout pass lets every table plan in it spend: cell visits on resolving the merge
 * chains, and probe layouts on measuring rows. Separate from the budget `finalizeTableRows`
 * spends, which would otherwise run out at half the cell count and leave holes in the grid.
 */
export interface VMergePlanBudget extends TableVMergeResolveBudget {
  layoutsRemaining: number;
}

export function createVMergePlanBudget(
  cells: number = MAX_VMERGE_RESOLVE_CELLS,
  layouts: number = MAX_VMERGE_PROBE_LAYOUTS
): VMergePlanBudget {
  return {
    cellsRemaining: Math.max(0, cells | 0),
    layoutsRemaining: Math.max(0, layouts | 0),
  };
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
  budget?: VMergePlanBudget
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

  const basePt = new Map<string, number>();
  const contentPt = new Map<VMergeSpan | string, number>();
  const surplusPt = new Map<number, number>();
  const coveredRows = new Set<number>();
  const acceptedSpans = new Set<VMergeSpan>();
  const acceptedHeadIds = new Set<string>();
  const detachedByRow = new Map<number, Map<string, number>>();

  /**
   * The row's height with the heads that are DETACHED from it emptied, and no others.
   *
   * A head nobody took still sizes its own row, so its content belongs in this number: leave
   * it out and the span is judged against a row shorter than the one that gets placed, and
   * the paginator moves a row the span was admitted to keep. `pending` is the head being
   * decided right now, which is about to join the accepted set if the span is taken. The
   * detached ones are detached in the probe as well, so this is the height placement gives
   * the row and not an approximation of it.
   */
  const baseOf = (rowIndex: number, pending?: string): number => {
    const emptied = new Set<string>();
    for (const id of headIdsByRow.get(rowIndex) ?? []) {
      if (acceptedHeadIds.has(id) || id === pending) emptied.add(id);
    }
    const key = `${rowIndex}\u0000${[...emptied].sort().join('\u0000')}`;
    const known = basePt.get(key);
    if (known !== undefined) return known;
    const measured = probeRowHeightPt(rows[rowIndex]!, emptied);
    basePt.set(key, measured);
    return measured;
  };

  /**
   * How tall the merged content is, measured WHERE THE HEAD ROW IS GOING when the caller
   * knows that: a float over the table wraps the head's text, and a span sized from the
   * position-free probe is then too short for its own content. Every way that ends —
   * painting past the rows, clipping the tail, splitting a row that cannot split — is a
   * defect, so the measurement is the thing to get right rather than the fallout.
   */
  const contentOf = (span: VMergeSpan, atYPt?: number): number => {
    const key = atYPt === undefined ? span : `${span.headCellId}@${atYPt.toFixed(2)}`;
    const known = contentPt.get(key);
    if (known !== undefined) return known;
    const head = headBySpan.get(span)!;
    const measured = probeRowHeightPt(
      soloHeadRow(rows[span.headRow]!, head.cell),
      undefined,
      atYPt
    );
    contentPt.set(key, measured);
    return measured;
  };

  const floorOf = (rowIndex: number, pending?: string): number =>
    baseOf(rowIndex, pending) + (surplusPt.get(rowIndex) ?? 0);

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
      total += floorOf(rowIndex, span.headCellId);
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

  /**
   * Charge this span's probe layouts once, or refuse it. Each probe re-enters nested-table
   * layout, so an unbounded plan multiplies passes through a nest a file controls.
   */
  const chargedSpans = new Set<VMergeSpan>();
  const affordable = (span: VMergeSpan): boolean => {
    if (chargedSpans.has(span)) return true;
    const needed = span.endRow - span.headRow + 2;
    if (budget && budget.layoutsRemaining < needed) return false;
    if (budget) budget.layoutsRemaining -= needed;
    chargedSpans.add(span);
    return true;
  };

  const spanHeightOf = (span: VMergeSpan, atYPt?: number): number => {
    // Unaffordable reads as "taller than any page", so the caller never admits it.
    if (!affordable(span)) return Number.POSITIVE_INFINITY;
    const covered = coveredPtOf(span);
    if (lastGrowableRow(span) === undefined) return covered;
    return Math.max(covered, contentOf(span, atYPt));
  };

  return {
    spansAt: (rowIndex) => spansByRow.get(rowIndex) ?? [],
    heightOf: spanHeightOf,
    accept: (span, atYPt) => {
      if (acceptedSpans.has(span)) return;
      if (headsBelowHead(span) || !affordable(span)) return;
      const covered = coveredPtOf(span);
      const growable = lastGrowableRow(span);
      const contentHeightPt = contentOf(span, atYPt);
      // Nothing in the span can grow and the content does not fit what the rows are fixed
      // at: the one case where the span is knowably too short for its own head, and the
      // only way to keep the content inside a box is to leave the head sizing its own row,
      // where `hRule="exact"` clips it exactly as Word does.
      if (growable === undefined && contentHeightPt > covered + EPSILON_PT) return;
      const surplus = growable === undefined ? 0 : contentHeightPt - covered;
      // Growing a row an accepted span already covers would change that span's height after
      // it was judged against the page, which is the one thing this plan must not do.
      if (surplus > EPSILON_PT && coveredRows.has(growable!)) return;
      acceptedSpans.add(span);
      acceptedHeadIds.add(span.headCellId);
      if (surplus > EPSILON_PT) {
        surplusPt.set(growable!, (surplusPt.get(growable!) ?? 0) + surplus);
      }
      for (let rowIndex = span.headRow; rowIndex <= span.endRow; rowIndex += 1) {
        coveredRows.add(rowIndex);
      }
      const detached = detachedByRow.get(span.headRow) ?? new Map<string, number>();
      detached.set(span.headCellId, spanHeightOf(span, atYPt));
      detachedByRow.set(span.headRow, detached);
    },
    rowOptions: (rowIndex) => {
      if (!coveredRows.has(rowIndex)) return undefined;
      const detachedSpanHeightPtByCellId = detachedByRow.get(rowIndex);
      // Always a floor: `baseOf` measures whatever heads stayed in the row, so this is the
      // whole row's height and never a number the caller has to second-guess.
      return {
        ...(detachedSpanHeightPtByCellId ? { detachedSpanHeightPtByCellId } : {}),
        heightFloorPt: floorOf(rowIndex),
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
    if (rowTopPt + plan!.heightOf(span, rowTopPt) > contentBottomPt + EPSILON_PT) continue;
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
    cellSpacingPt?: number,
    vMerge?: RowVMergeLayoutOptions,
    atYPt?: number
  ) => number,
  budget?: VMergePlanBudget
): VMergeRowHeights | null {
  return planVMergeRowHeights(
    structure.rows,
    (row, detached, atYPt) =>
      measure(
        row,
        structure.columnWidthsPt,
        left,
        depth,
        deps,
        structure.cellSpacingPt,
        // A probe only needs to know WHICH cells are out: the span it measures towards has
        // no height of its own yet, and being unbounded is the point of a probe.
        detached
          ? {
              detachedSpanHeightPtByCellId: new Map(
                [...detached].map((id) => [id, Number.POSITIVE_INFINITY])
              ),
            }
          : undefined,
        atYPt
      ),
    budget
  );
}

/**
 * Accept every merge starting at `rowIndex` for a table that is placed in one pass, where
 * there is no page to fall off and so no fit to judge.
 */
export function acceptVMergeSpansAt(
  plan: VMergeRowHeights | null,
  rowIndex: number
): RowVMergeLayoutOptions | undefined {
  for (const span of plan?.spansAt(rowIndex) ?? []) plan!.accept(span);
  return plan?.rowOptions(rowIndex);
}
