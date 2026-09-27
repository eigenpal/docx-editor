// A two-row vertical merge (17.4.85 `w:vMerge`) whose page break falls right after its head row.
//
// A merge that does not fit the page from its head's top is declined by
// `table-vmerge-heights.ts`, and its head then sizes its own row: the row grows to the page
// bottom, places what fits of the merged text, and continues the rest on the next page ABOVE
// the row the merge continues into. In compatibility mode 15 and later, a merged text that
// cannot place a single line inside the head row's own height is laid out differently:
//
// - the head row keeps only its own cells and its own height on the first page;
// - the whole merged text starts in the continuation row on the next page, beside that row's
//   own cells, with its space before.
//
// "Cannot place a single line" includes the cell's widow and orphan rules: a paragraph whose
// first line alone fits the head row moves whole, as it does at any page break. The head row
// does not grow for the merged text even when the page has room below it.
//
// The rule is deliberately narrow. It applies only when every merge headed in the row ends in
// the next row, the next row starts no merge of its own, the next row cannot start on this
// page below the head row, and each merged head either fits the head row whole or places
// nothing there. A merged text that splits inside the head row, a merge over three or more
// rows, an exact-height row, a row at the page top, an earlier compatibility mode, and
// bottom-to-top text all keep the older path.
//
// The continuation row keeps its own identity: its cell id, grid slot, borders, margins and
// alignment. It takes the head's blocks and table-style formatting, because the text it paints
// is the head's text, broken as the head breaks it at the same width. Selection maps through
// paragraph ids, so a caret placed in that text edits the head's paragraphs.

import {
  initialCellCursors,
  layoutRowFragmentBounded,
  measureRowHeight,
  type CellPlaceCursor,
  type LayoutRowBoundedResult,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import type {
  SemanticTableCell,
  SemanticTableRow,
  SemanticTableStructure,
} from './semantic-table.ts';
import { isWord2013OrLaterMode } from './document-compatibility-mode.ts';
import { probeRowFragmentProgress } from './table-row-progress-probe.ts';
import { stripAnchorSinksForProbe } from './table-probe-deps.ts';
import type { RowVMergeLayoutOptions, VMergeRowHeights } from './table-vmerge-heights.ts';

const EPSILON_PT = 0.001;

/** The head row placed without its merged text, and the row that paints that text. */
export interface DeferredMergedText {
  /** The head row to place: each deferred head holds no blocks. */
  readonly headRow: SemanticTableRow;
  /** Every head of the row detached, so none of them sizes it. */
  readonly options: RowVMergeLayoutOptions;
  /** The head row's height without its merged text. */
  readonly heightPt: number;
  /** The next row, with the deferred text in its continuation cells. */
  readonly nextRow: SemanticTableRow;
}

export interface DeferMergedTextInput {
  readonly plan: VMergeRowHeights | null;
  /** The rows the plan was built over, in placement order. */
  readonly rows: readonly SemanticTableRow[];
  readonly rowIndex: number;
  readonly structure: SemanticTableStructure;
  readonly left: number;
  readonly top: number;
  readonly contentBottom: number;
  /** The deps the head row is placed with. */
  readonly deps: TableFlowDeps;
  /** The deps a later row of this fragment is placed with. */
  readonly nextDeps: TableFlowDeps;
  readonly compatibilityMode: number | undefined;
  /** Measure rows at their page position: wrap bands cross this table. */
  readonly positioned: boolean;
}

/** Placement deps for a probe whose result is discarded: nothing published, nothing spent. */
function discardedDeps(deps: TableFlowDeps): TableFlowDeps {
  let lineCounter = 0;
  return {
    ...stripAnchorSinksForProbe(deps),
    cache: undefined,
    borderOwnershipBudget: undefined,
    vMergeResolveBudget: undefined,
    onCellBreakKey: undefined,
    nextLineId: () => `probe-deferred-merge-${lineCounter++}`,
  };
}

/** A cell that has nothing left to place after this fragment. */
const finished = (cell: SemanticTableCell, cursor: CellPlaceCursor | undefined): boolean =>
  cell.vMergeContinue || cursor === undefined || cursor.blockIndex >= cell.blocks.length;

/**
 * The heads whose text the probe left entirely behind, or `null` when any cell split: a head
 * that placed part of its text, or any other cell that did not finish.
 */
function deferredHeads(
  row: SemanticTableRow,
  headIds: ReadonlySet<string>,
  placed: LayoutRowBoundedResult
): Set<string> | null {
  const deferred = new Set<string>();
  const remainder = placed.remainder;
  if (remainder === null) return deferred;
  for (const [index, cell] of row.cells.entries()) {
    if (finished(cell, remainder[index])) continue;
    const record = placed.record.cells[index];
    if (!headIds.has(cell.id) || record === undefined || record.blocks.length > 0) return null;
    deferred.add(cell.id);
  }
  return deferred;
}

/**
 * The head row with each deferred head emptied, and the continuation row with that head's
 * text moved into its own cell. The text moves before either row is placed, so no placement
 * can leave it behind: the head row finishes, and the next row owns every line.
 */
function carriedRows(
  head: SemanticTableRow,
  next: SemanticTableRow,
  deferred: ReadonlySet<string>
): { readonly headRow: SemanticTableRow; readonly nextRow: SemanticTableRow } {
  const heads = head.cells.filter((cell) => deferred.has(cell.id));
  const headRow = {
    ...head,
    cells: head.cells.map((cell) => (deferred.has(cell.id) ? { ...cell, blocks: [] } : cell)),
  };
  const nextRow = {
    ...next,
    cells: next.cells.map((cell) => {
      const source = cell.vMergeContinue
        ? heads.find((candidate) => candidate.gridColumn === cell.gridColumn)
        : undefined;
      if (source === undefined) return cell;
      return {
        ...cell,
        vMergeContinue: false,
        blocks: source.blocks,
        styleFormatting: source.styleFormatting,
        hideEndMark: source.hideEndMark,
      };
    }),
  };
  return { headRow, nextRow };
}

/**
 * Whether the head row's merged text moves whole into the next row, and how to place both.
 * See the top of this file for the rule; `null` keeps the ordinary path.
 */
export function deferMergedTextPastHeadRow(input: DeferMergedTextInput): DeferredMergedText | null {
  const { plan, rows, rowIndex, structure, left, top, contentBottom } = input;
  if (!isWord2013OrLaterMode(input.compatibilityMode) || plan === null || top <= EPSILON_PT) {
    return null;
  }
  const row = rows[rowIndex];
  const next = rows[rowIndex + 1];
  const spans = plan.spansAt(rowIndex);
  if (row === undefined || next === undefined || spans.length === 0) return null;
  // An exact row clips its content and never continues it; that path stays as it is.
  if (row.height.rule === 'exact' || next.height.rule === 'exact') return null;
  if (plan.spansAt(rowIndex + 1).length > 0) return null;
  if (spans.some((span) => span.endRow !== rowIndex + 1)) return null;
  const headIds = new Set(spans.map((span) => span.headCellId));
  for (const cell of row.cells) {
    if (!headIds.has(cell.id)) continue;
    const continuation = next.cells.find(
      (candidate) => candidate.vMergeContinue && candidate.gridColumn === cell.gridColumn
    );
    if (
      cell.textDirection === 'btLr' ||
      continuation === undefined ||
      continuation.gridSpan !== cell.gridSpan ||
      continuation.textDirection === 'btLr'
    ) {
      return null;
    }
  }

  const cols = structure.columnWidthsPt;
  const spacing = structure.cellSpacingPt;
  const unbounded = new Map([...headIds].map((id) => [id, Number.POSITIVE_INFINITY]));
  const at = (y: number) => (input.positioned ? y : undefined);
  const heightPt = measureRowHeight(
    row,
    cols,
    left,
    0,
    input.deps,
    spacing,
    { detachedSpanHeightPtByCellId: unbounded },
    at(top)
  );
  const nextTop = top + heightPt;
  if (heightPt <= EPSILON_PT || nextTop > contentBottom + EPSILON_PT) return null;

  // The next row has to lose this page on its own account; one that could start here would
  // take merged lines beside it, and that is a different layout.
  const nextHeight = measureRowHeight(
    next,
    cols,
    left,
    0,
    input.nextDeps,
    spacing,
    undefined,
    at(nextTop)
  );
  if (nextTop + nextHeight <= contentBottom + EPSILON_PT) return null;
  if (
    !next.cantSplit &&
    probeRowFragmentProgress(
      next,
      cols,
      left,
      nextTop,
      contentBottom,
      false,
      0,
      { ...input.nextDeps, rowAtPageStart: false },
      initialCellCursors(next),
      spacing,
      { requireEveryCell: true }
    )
  ) {
    return null;
  }

  // The heads, bounded by the row's own height, placed the way the row would place them. A
  // head's widow and orphan rules decide here whether its first line may stay alone.
  const options: RowVMergeLayoutOptions = {
    detachedSpanHeightPtByCellId: new Map([...headIds].map((id) => [id, heightPt])),
  };
  const probed = layoutRowFragmentBounded(
    row,
    cols,
    left,
    top,
    Number.POSITIVE_INFINITY,
    false,
    false,
    0,
    discardedDeps(input.deps),
    initialCellCursors(row),
    spacing,
    options,
    contentBottom
  );
  const deferred = deferredHeads(row, headIds, probed);
  if (deferred === null || deferred.size === 0) return null;
  return { ...carriedRows(row, next, deferred), options, heightPt };
}
