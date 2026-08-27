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
// - a SECOND merge starting in a row that already has one planned. Detaching it empties the
//   head row of the last thing left in it, so the row collapses and the first span's rows
//   stop adding up to the height it was sized at — its content then paints below the table.
//   One merge per head row is planned; the rest size their own row as they did before;
// - a span every row of which is `hRule="exact"` and too short for the merged content. It is
//   the one span knowably unable to hold its own head, so the head keeps sizing its own row
//   and the exact height clips it there, which is what Word draws.
//
// Those first two together mean accepted spans never overlap, which is why nothing here
// guards against one span's surplus landing in another's rows: it cannot happen. Anything
// that relaxes either rule has to put that guard back.
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
import { resolveVMergeSpans } from './table-vmerge.ts';

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
 * The plan holds NO pass-scoped state, and that is the point.
 *
 * It used to draw on a shared allowance — probe layouts first, then cell visits — and either
 * one makes a table's heights depend on how much of the document came before it. An editor
 * cannot afford that: a resumed pass starts at the first changed block, so it spends less of
 * any pool than a cold open, and a table near exhaustion would plan its merges after an edit
 * and not plan them on reload. One document, two shapes, decided by how you opened it.
 *
 * Nothing needs the allowance now. Resolving a merge chain walks the cells of ONE table, and
 * `readTableStructure` bounds those; probes no longer plan the tables inside them
 * (`TableFlowDeps.measuringOnly`), so the nested re-entry that multiplied the work is gone at
 * its source. What is left is linear in the cells a pass already walks to lay the document
 * out. Anything reintroducing a shared counter here brings the drift back with it.
 */

function collectHeads(rows: readonly SemanticTableRow[]): {
  readonly heads: MergeHead[];
  readonly headIdsByRow: Map<number, Set<string>>;
} {
  const spans = resolveVMergeSpans(rows);
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
  probeRowHeightPt: RowHeightProbe
): VMergeRowHeights | null {
  if (rows.length === 0) return null;
  // Most tables have no vertical merge, and this runs from inside a row PROBE as well as
  // from placement, so the walk that finds none has to be the cheap one: a continuation
  // cell is the only thing that can start a chain, and a scan for one beats building the
  // resolve and its budget accounting to reach the same `null`.
  if (!rows.some((row) => row.cells.some((cell) => cell.vMergeContinue))) return null;
  const { heads, headIdsByRow } = collectHeads(rows);
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
  /** Per row, the floor the span that covers it was admitted on — positioned, not position-free. */
  const plannedFloorPt = new Map<number, number>();
  const coveredRows = new Set<number>();
  const acceptedSpans = new Set<VMergeSpan>();
  const acceptedHeadIds = new Set<string>();
  /** Rows with a planned merge already. A second one there collapses the row out from it. */
  const acceptedHeadRows = new Set<number>();
  /** Where each accepted span's head row was offered, so its height re-derives the same. */
  const admittedAtYPt = new Map<VMergeSpan, number | undefined>();

  /**
   * The row's height with the heads that are DETACHED from it emptied, and no others.
   *
   * A head nobody took still sizes its own row, so its content belongs in this number: leave
   * it out and the span is judged against a row shorter than the one that gets placed, and
   * the paginator moves a row the span was admitted to keep. `pending` is the head being
   * decided right now, which is about to join the accepted set if the span is taken. The
   * detached ones are detached in the probe as well, so this is the height placement gives
   * the row and not an approximation of it.
   *
   * `atYPt` measures the row where it is going, bands included, for the same reason the head
   * is measured that way: a float crossing a COVERED row makes it place taller than a
   * position-free floor says, and the span is then admitted against a page it overruns.
   */
  const baseOf = (rowIndex: number, pending?: string, atYPt?: number): number => {
    const emptied = new Set<string>();
    for (const id of headIdsByRow.get(rowIndex) ?? []) {
      if (acceptedHeadIds.has(id) || id === pending) emptied.add(id);
    }
    const at = atYPt === undefined ? '' : `@${atYPt.toFixed(2)}`;
    const key = `${rowIndex}${at}\u0000${[...emptied].sort().join('\u0000')}`;
    const known = basePt.get(key);
    if (known !== undefined) return known;
    const measured = probeRowHeightPt(rows[rowIndex]!, emptied, atYPt);
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

  const floorOf = (rowIndex: number, pending?: string, atYPt?: number): number =>
    baseOf(rowIndex, pending, atYPt) + (surplusPt.get(rowIndex) ?? 0);

  /** Another merge starting under this one's head row: see the shapes declined above. */
  const headsBelowHead = (span: VMergeSpan): boolean => {
    for (let rowIndex = span.headRow + 1; rowIndex <= span.endRow; rowIndex += 1) {
      if (headIdsByRow.has(rowIndex)) return true;
    }
    return false;
  };

  /**
   * What the span's rows add up to. Each row is measured at the y the ones above it leave
   * it at, so a wrap band is applied to the rows it really crosses — measuring them all at
   * the head's top would put every band over every row.
   */
  const coveredPtOf = (span: VMergeSpan, atYPt?: number): number => {
    let total = 0;
    for (let rowIndex = span.headRow; rowIndex <= span.endRow; rowIndex += 1) {
      total += floorOf(rowIndex, span.headCellId, atYPt === undefined ? undefined : atYPt + total);
    }
    return total;
  };

  /**
   * The same walk, keeping each row's own share.
   *
   * The surplus is `head content − what the rows cover`, and both sides of that subtraction
   * are measured at the y the rows will sit at, bands included. The floor handed to the
   * placer has to come from the SAME measurement: hand out a position-free base plus a
   * positioned surplus and a band that makes a row place taller than its position-free probe
   * absorbs the floor instead of adding to it, so the rows fall short of the head's bound and
   * the difference paints below the table.
   */
  const coveredFloorsOf = (span: VMergeSpan, atYPt?: number): Map<number, number> => {
    const floors = new Map<number, number>();
    let total = 0;
    for (let rowIndex = span.headRow; rowIndex <= span.endRow; rowIndex += 1) {
      const floor = floorOf(
        rowIndex,
        span.headCellId,
        atYPt === undefined ? undefined : atYPt + total
      );
      floors.set(rowIndex, floor);
      total += floor;
    }
    return floors;
  };

  /** Last row of the span Word lets grow: `hRule="exact"` fixes a row at its authored box. */
  const lastGrowableRow = (span: VMergeSpan): number | undefined => {
    for (let rowIndex = span.endRow; rowIndex >= span.headRow; rowIndex -= 1) {
      if (rows[rowIndex]!.height.rule !== 'exact') return rowIndex;
    }
    return undefined;
  };

  const spanHeightOf = (span: VMergeSpan, atYPt?: number): number => {
    // Shapes this module declines read as "taller than any page", so the caller never
    // admits them and never probes for a height it will not use.
    if (headsBelowHead(span)) return Number.POSITIVE_INFINITY;
    if (acceptedHeadRows.has(span.headRow) && !acceptedSpans.has(span)) {
      return Number.POSITIVE_INFINITY;
    }
    const covered = coveredPtOf(span, atYPt);
    if (lastGrowableRow(span) === undefined) return covered;
    return Math.max(covered, contentOf(span, atYPt));
  };

  return {
    spansAt: (rowIndex) => spansByRow.get(rowIndex) ?? [],
    heightOf: spanHeightOf,
    accept: (span, atYPt) => {
      if (acceptedSpans.has(span)) return;
      if (headsBelowHead(span) || acceptedHeadRows.has(span.headRow)) return;
      const rowFloors = coveredFloorsOf(span, atYPt);
      let covered = 0;
      for (const floor of rowFloors.values()) covered += floor;
      const growable = lastGrowableRow(span);
      const contentHeightPt = contentOf(span, atYPt);
      // Nothing in the span can grow and the content does not fit what the rows are fixed
      // at: the one case where the span is knowably too short for its own head, and the
      // only way to keep the content inside a box is to leave the head sizing its own row,
      // where `hRule="exact"` clips it exactly as Word does.
      if (growable === undefined && contentHeightPt > covered + EPSILON_PT) return;
      const surplus = growable === undefined ? 0 : contentHeightPt - covered;
      acceptedSpans.add(span);
      acceptedHeadIds.add(span.headCellId);
      acceptedHeadRows.add(span.headRow);
      if (surplus > EPSILON_PT) {
        surplusPt.set(growable!, (surplusPt.get(growable!) ?? 0) + surplus);
        rowFloors.set(growable!, (rowFloors.get(growable!) ?? 0) + surplus);
      }
      for (const [rowIndex, floor] of rowFloors) {
        coveredRows.add(rowIndex);
        // What the span was admitted on IS what the placer is told to leave room for.
        plannedFloorPt.set(rowIndex, Math.max(plannedFloorPt.get(rowIndex) ?? 0, floor));
      }
      // The span's height is NOT stored here. A second head in this same row is decided
      // after this one and detaches too, which empties it out of `baseOf(headRow)` and so
      // changes what this span covers; a height captured now would describe a row that no
      // longer exists by the time either head is placed. `rowOptions` derives both heights
      // once every span at the row has been decided.
      admittedAtYPt.set(span, atYPt);
    },
    rowOptions: (rowIndex) => {
      if (!coveredRows.has(rowIndex)) return undefined;
      // Derived now, not at accept: every span heading this row has been decided by the
      // time the row is placed, so this is the first moment the heights are all settled.
      let detachedSpanHeightPtByCellId: Map<string, number> | undefined;
      for (const span of spansByRow.get(rowIndex) ?? []) {
        if (!acceptedSpans.has(span)) continue;
        detachedSpanHeightPtByCellId ??= new Map<string, number>();
        detachedSpanHeightPtByCellId.set(
          span.headCellId,
          spanHeightOf(span, admittedAtYPt.get(span))
        );
      }
      // The floor recorded when the span was admitted, in the same measurement space the
      // surplus was taken from. `floorOf` is the fallback for a covered row no accepted span
      // recorded, which only a decline can leave behind.
      return {
        ...(detachedSpanHeightPtByCellId ? { detachedSpanHeightPtByCellId } : {}),
        heightFloorPt: plannedFloorPt.get(rowIndex) ?? floorOf(rowIndex),
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
  /** A getter where the caller moves the table between rows; a number where it cannot. */
  left: number | (() => number),
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
  ) => number
): VMergeRowHeights | null {
  return planVMergeRowHeights(structure.rows, (row, detached, atYPt) =>
    measure(
      row,
      structure.columnWidthsPt,
      typeof left === 'function' ? left() : left,
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
    )
  );
}

/**
 * Accept every merge starting at `rowIndex` for a table placed in one pass, where there is
 * no page to fall off and so no fit to judge.
 *
 * `rowTopPt` is where the row is going, and it matters for the same reason it does in the
 * paginator: the head's bound comes from this measurement, and a one-pass caller has no
 * continuation to carry what a bound cut short. Measuring position-free here and placing
 * under a wrap band there would drop the lines the band pushed past the span.
 */
export function acceptVMergeSpansAt(
  plan: VMergeRowHeights | null,
  rowIndex: number,
  rowTopPt: number
): RowVMergeLayoutOptions | undefined {
  for (const span of plan?.spansAt(rowIndex) ?? []) plan!.accept(span, rowTopPt);
  return plan?.rowOptions(rowIndex);
}
