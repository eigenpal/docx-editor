// Restarting a table's pagination at a page that an edit leaves standing.
//
// A body table is one flow block, so a row edit paginated the whole table again: its cost
// followed the table, not the rows the edit moves. The paginator now records, for each
// continuation page it opens with a whole body row, the state it held there
// (`TablePageStart`). A later pass whose first changed block is the table keeps every page
// before such a page by identity and paginates from its top (`tablePageRestart`).
//
// The restart lays out what a full pagination lays out when three things hold:
//
// - The rows the earlier pages placed resolve as before. Every row up to and including the
//   restart row resolves to an equal row, the table-level structure (column widths included)
//   is equal, and so are the table-wide facts pagination reads from all rows: whether any
//   row continues a vertical merge (`hasTableMerge`) and whether a fixed table holds a
//   nested table (`holdsNestedTable`). Equal resolved rows also cover what a row resolves
//   against its neighbors and its index. Each kept structure is compared once, from the first
//   row up to the first row that differs.
// - Every row a decision for the kept pages read resolves as before. Those decisions read past
//   the rows they place: the restart row moved to its page because of the row after it (its
//   closing rule), a kept group reads the rows after it, and a merge reads all of its rows. The
//   paginator records at each page start the furthest row read so far
//   (`table-read-horizon.ts`), and the rows through it must be equal. A page start after a
//   read of the content past the table is never recorded. The restart row may not head or
//   continue a vertical merge, or open a kept group, because the paginator does not carry
//   the state those open.
// - The paginator state at the page top is carried or is a cause to refuse. See the inventory
//   below.
//
// Inventory: every paginator variable (`table-flow-pagination.ts`) that the opening of a
// continuation page, or a later row, reads. Each is carried in `TablePageStart`, is the same
// in a full pass because nothing set it yet at that point, or refuses the page start.
//
// Carried:
// - `fragmentIndex`, `repeatsEnabled`, `initialHeaderGroupDegraded`, the header group `start`,
//   `headerGroupHeight`, and `headerMerged`: decisions taken on earlier pages.
// - The repeat flag the break passed to the opening (`repeat`).
// - `rowOrdinals`: rebuilt from the kept fragments.
// - `fragmentsForRow` of the opening row (`MAX_TABLE_ROW_FRAGMENTS`).
// - `naturalHeight` and `baselineBodyHeight` of the opening row as measured where it stood
//   before it moved. The repeat admission (`admitsRepeatedHeaders`) and the repeat border plan
//   (`prepareRepeat`) read them at the opening. They are measured from the kept page.
// - The pass budgets (border ownership intervals, merge cells) and, from the body flow, the
//   line counter and the count of cell break keys.
// - `readThrough`: how far into the table the kept decisions read (`table-read-horizon.ts`).
//
// The same as in a full pass at the opening, because the break that closed the previous
// fragment reset them: `rows`, `sourceRows`, `occurrenceInsets`, `repeatedPlan`, `bandTop`,
// `firstFragmentBottom`, `isContinuation`, the opening row's cell cursors, `movedToFreshPage`
// (set after the opening), and `rowDeps`, which reads only those. The clearance pending
// fragment is rebuilt from the row index before the opening. `closingEdge` is read only
// before the break. Header plans and row probes are caches that answer as fresh reads do.
//
// Refuses the page start (`open` and `at` below, `planTableRestartPass`):
// - a row split across the break (`isContinuation`), a closing-rule plan (`terminalDeps`),
//   merged text carried past a head row (`deferred`), a break the opening row's own placement
//   forces after it (`forceNextFragment` set while that row is placed), merge options
//   (`vMerge`), or a row other than the authored one (`fragmentCarry`);
// - an opening row that heads or continues a vertical merge, or keeps with the next row;
// - a fragment that holds rows other than its header repeat above the opening row, or opens
//   below the page top;
// - page wrap zones, cell spacing, a positioned table, out-of-cell floats, or more than one
//   column;
// - a decision that read the content after the table (`readThrough` unbounded);
// - a pass whose inputs outside the tree moved (`semantic-layout.ts`): the drawing epoch (a
//   picture that finished decoding), projections, field references, styles, or width. The
//   structure rows do not hold them, so equal rows do not prove the kept pages.
//
// A page that a forced break opened is recorded: the row loop consumes `forceNextFragment`
// (as `forceBreak`) before it takes up the opening row. The row above forced the break because
// it fit only without the opening row below it, and the read horizon covers that read.
//
// The body flow at the page top: the kept pages, the header and footer variant and the note
// reserve of each page index (a moved reserve refuses), and the flow checkpoint.
//
// The body flow carries the rest (`semantic-layout.ts`): the pages are kept, the header and
// footer variants and note reserves come with each page index, and a restart is refused when
// the flow before the table holds anything a page top could carry (drawings, frames,
// positioned tables). Collaboration is unaffected: this reads the tree and writes no ops.
//
// Every fragment the paginator closes records the structure it was laid out from. A restart
// compares the new rows with the structure of every fragment it keeps, so kept pages from
// earlier restarts stay valid. A text edit that updates the pages in place records the same on
// the fragments it replaces, and that every other fragment now lays out as its structure does
// (`carryTableTextUpdate`). A fragment that another path made records nothing, and the next
// structure edit paginates the whole table again. The records are set once on new fragments
// and never change, so a dropped pass leaves none stale.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import {
  readTableStructure,
  type SemanticTableRow,
  type SemanticTableStructure,
} from './semantic-table.ts';
import type {
  PageRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from './semantic-records.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';
import type { FlowCheckpoint } from './layout-session.ts';
import type { HeaderGroupStart } from './table-header-group-start.ts';
import type { PreparedBlock } from './section-prepass-types.ts';
import { autofitContextOf } from './table-autofit-widths.ts';
import {
  registerMergedTableCellBreakKeys,
  registerResumedTableCellBreakKeys,
  tableCellBreakKeysUnordered,
} from './table-cell-break-keys.ts';
import { rowKeepsWithNext } from './table-row-keeps.ts';
import { hasTableMerge } from './table-border-probe.ts';
import { holdsNestedTable } from './table-flow-structure.ts';
import type { ReadHorizon } from './table-read-horizon.ts';

/** The body flow at a page start: its line counter and the table's cell break keys so far. */
export interface TableFlowPageState {
  readonly lineCounter: number;
  readonly breakKeys: number;
}

/** The pass budgets left when the page opened (`table-budget-proof.ts`). */
interface PassBudgets {
  readonly intervals: number | undefined;
  readonly cells: number | undefined;
}

/** The paginator state a restart at a page top needs. */
export interface TableResume {
  /** Index into the paginator's body rows of the row the page opens with. */
  readonly bodyRowIndex: number;
  readonly fragmentIndex: number;
  /** Whether the page opened with a header repeat offer. */
  readonly repeat: boolean;
  readonly repeatsEnabled: boolean;
  readonly headerGroupDegraded: boolean;
  readonly start: HeaderGroupStart;
  readonly headerGroupHeight: number;
  readonly headerMerged: boolean;
  /** Page fragments the opening row had already counted (`MAX_TABLE_ROW_FRAGMENTS`). */
  readonly fragmentsForRow: number;
  /**
   * The opening row's heights as measured where it stood on the page before, which the
   * repeat admission and the repeat border plan at the page opening read.
   */
  readonly naturalHeight: number;
  readonly baselineBodyHeight: number;
  /** Row ordinals of the rows placed on the kept pages; the paginator adds to it. */
  readonly ordinals: Map<string, number>;
  /** The furthest row any decision for the kept pages read (`table-read-horizon.ts`). */
  readonly readThrough: number;
}

/** A continuation page the paginator opened with a whole body row, with nothing else open. */
export interface TablePageStart extends Omit<TableResume, 'ordinals'> {
  /** Index of the opening row in the structure. */
  readonly rowIndex: number;
  readonly flow: TableFlowPageState;
  readonly budgets: PassBudgets;
}

const pageStarts = new WeakMap<TableFragmentRecord, TablePageStart>();
const fragmentSources = new WeakMap<TableFragmentRecord, SemanticTableStructure>();

/** Record that the paginator laid `fragment` out from `structure`, opening at `start`. */
export function noteTableFragment(
  fragment: TableFragmentRecord,
  structure: SemanticTableStructure,
  start: TablePageStart | undefined
): void {
  fragmentSources.set(fragment, structure);
  if (start) pageStarts.set(fragment, start);
}

/**
 * A text edit that updated a table's pages in place (`table-text-update.ts`): every fragment
 * of the table then laid out as `to` lays it out, whatever structure it came from.
 */
interface TextUpdate {
  readonly order: number;
  readonly from: ReadonlySet<SemanticTableStructure>;
  readonly to: SemanticTableStructure;
}
const textUpdates = new WeakMap<TableFragmentRecord, TextUpdate>();
let textUpdateOrder = 0;

/**
 * Keep the restart records of a table whose pages a text edit updated in place. Each replaced
 * fragment takes the page start of the fragment it replaces and comes from `structure`. It
 * also records that every other fragment of the table now lays out as `structure` does, so
 * a later restart compares those with `structure` too. With a changed line count the line
 * counter of later page starts moves, so the records are not kept.
 */
export function carryTableTextUpdate(
  pages: readonly PageRecord[],
  tableId: string,
  replacements: ReadonlyMap<object, object>,
  structure: SemanticTableStructure | undefined,
  lineDelta: number
): void {
  if (!structure || lineDelta !== 0) return;
  const from = new Set<SemanticTableStructure>();
  for (const page of pages)
    for (const fragment of page.fragments)
      if (fragment.kind === 'table' && fragment.tableId === tableId) {
        const source = fragmentSources.get(fragment);
        if (source) from.add(source);
      }
  const update: TextUpdate = { order: (textUpdateOrder += 1), from, to: structure };
  for (const [before, after] of replacements) {
    const fragment = before as TableFragmentRecord;
    const replacement = after as TableFragmentRecord;
    // A fragment another path made has no source, and its replacement gets none either.
    if (fragment.kind !== 'table' || replacement === fragment || !fragmentSources.has(fragment))
      continue;
    const start = pageStarts.get(fragment);
    if (start) pageStarts.set(replacement, start);
    fragmentSources.set(replacement, structure);
    textUpdates.set(replacement, update);
  }
}

/** Kept fragments may come from this many structures; more paginate the table whole. */
const MAX_KEPT_SOURCES = 4;

/**
 * The structures the fragments `[0, through]` lay out as, or null when one has none or there
 * are more than `MAX_KEPT_SOURCES`. The latest text update among them stands for every
 * structure it updated in place.
 */
function keptSources(
  fragments: readonly TableFragmentRecord[],
  through: number
): { readonly sources: Set<SemanticTableStructure>; readonly textUpdated: boolean } | null {
  let latest: TextUpdate | undefined;
  for (let at = 0; at <= through; at += 1) {
    const update = textUpdates.get(fragments[at]!);
    if (update && (!latest || update.order > latest.order)) latest = update;
  }
  const sources = new Set<SemanticTableStructure>();
  for (let at = 0; at <= through; at += 1) {
    const source = fragmentSources.get(fragments[at]!);
    if (!source) return null;
    sources.add(latest?.from.has(source) ? latest.to : source);
    if (sources.size > MAX_KEPT_SOURCES) return null;
  }
  return { sources, textUpdated: latest !== undefined };
}

/** Whether `row` heads or continues a vertical merge. */
function rowHoldsMerge(row: SemanticTableRow): boolean {
  return row.cells.some((cell) => cell.vMergeContinue || cell.headsVerticalMerge === true);
}

/** Equal values: identical, or arrays and plain objects with equal entries. */
function sameValue(a: unknown, b: unknown, depth = 0): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null)
    return Number.isNaN(a) && Number.isNaN(b);
  if (depth > 32) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1)
      if (!sameValue(a[index], b[index], depth + 1)) return false;
    return true;
  }
  if (
    Object.getPrototypeOf(a) !== Object.prototype ||
    Object.getPrototypeOf(b) !== Object.prototype
  )
    return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  let keys = 0;
  for (const key in left) {
    keys += 1;
    if (!Object.hasOwn(right, key) || !sameValue(left[key], right[key], depth + 1)) return false;
  }
  for (const _key in right) keys -= 1;
  return keys === 0;
}

/**
 * The index of the first row that `after` paginates differently from `before`: -1 when the
 * table-level structure or a table-wide fact differs, `Infinity` when nothing does. A missing
 * row differs from a present one, so a row added or removed at the end counts too.
 */
function firstChangedRow(before: SemanticTableStructure, after: SemanticTableStructure): number {
  if (before === after) return Number.POSITIVE_INFINITY;
  if (
    hasTableMerge(before) !== hasTableMerge(after) ||
    holdsNestedTable(before) !== holdsNestedTable(after)
  )
    return -1;
  const { rows: beforeRows, ...beforeFrame } = before;
  const { rows: afterRows, ...afterFrame } = after;
  if (!sameValue(beforeFrame, afterFrame)) return -1;
  const count = Math.max(beforeRows.length, afterRows.length);
  for (let index = 0; index < count; index += 1)
    if (!sameValue(beforeRows[index], afterRows[index])) return index;
  return Number.POSITIVE_INFINITY;
}

/** Whether a restart keeps the previous table node's whole key list, not a prefix of it. */
function wholeKeyList(textUpdated: boolean, previous: PreparedBlock | undefined): boolean {
  return previous?.kind === 'table' && (textUpdated || tableCellBreakKeysUnordered(previous.table));
}

/** Whether the flow before the table holds only what a restart at a page top re-creates. */
function plainFlowBefore(checkpoint: FlowCheckpoint): boolean {
  return (
    checkpoint.flowColumnIndex === 0 &&
    !checkpoint.heldTablePages &&
    !checkpoint.pendingParagraphFrames &&
    checkpoint.pendingAnchoredDrawings.length === 0 &&
    checkpoint.deferredAnchoredDrawings.length === 0 &&
    checkpoint.anchorPageDeferCounts.size === 0 &&
    !checkpoint.positionedTableAnchorSignals?.length &&
    !checkpoint.pendingPositionedTableTokens
  );
}

let observer: { restarts: number; keptPages: number; fallbacks: number } | null = null;

/** Count a restart that failed and paginated the whole table instead. */
export function noteRestartFallback(): void {
  if (observer) observer.fallbacks += 1;
}

/**
 * @internal Counts the restarts planned, the pages they keep, and the restarts that failed and
 * paginated the whole table, for tests that need one.
 */
export function tablePageRestartTestRecorder(): {
  readonly restarts: number;
  readonly keptPages: number;
  readonly fallbacks: number;
  dispose(): void;
} {
  const counts = { restarts: 0, keptPages: 0, fallbacks: 0 };
  observer = counts;
  return {
    get restarts() {
      return counts.restarts;
    },
    get keptPages() {
      return counts.keptPages;
    },
    get fallbacks() {
      return counts.fallbacks;
    },
    dispose() {
      if (observer === counts) observer = null;
    },
  };
}

export interface TableRestartPlan {
  /** Pages kept by identity: the restart opens page `pageIndex`. */
  readonly pageIndex: number;
  /** The body flow checkpoint to resume from: at the top of that page. */
  readonly checkpoint: FlowCheckpoint;
  readonly resume: TableResume;
  /** Cell break keys of the previous table node that the kept pages reported. */
  readonly breakKeys: number;
  /** The kept pages' keys are not a prefix of the list: keep it whole, each key once. */
  readonly mergeKeys: boolean;
  /** Give `deps` back the pass budgets it held before the plan, when the paginator refuses. */
  restoreBudgets(): void;
}

function setBudgets(deps: TableFlowDeps, budgets: PassBudgets): void {
  if (deps.borderOwnershipBudget && budgets.intervals !== undefined)
    deps.borderOwnershipBudget.intervalsRemaining = budgets.intervals;
  if (deps.vMergeResolveBudget && budgets.cells !== undefined)
    deps.vMergeResolveBudget.cellsRemaining = budgets.cells;
}

/**
 * Where the pagination of block `index`, the first changed block of the pass, may restart, or
 * null when it is not a table or paginates whole. `checkpoints` and `pages` are the previous
 * pass's; `width` and `deps` read the table as the paginator does. A plan sets the pass
 * budgets in `deps` to what the previous pass had left at that page.
 */
export function tablePageRestart(
  prepared: readonly PreparedBlock[],
  index: number,
  checkpoints: readonly FlowCheckpoint[],
  pages: readonly PageRecord[],
  read: {
    readonly width: number;
    readonly deps: TableFlowDeps;
    /** The block the previous pass laid out at `index`, whose cell keys the kept pages hold. */
    readonly previous?: PreparedBlock | undefined;
  }
): TableRestartPlan | null {
  const entry = prepared[index];
  const before = checkpoints[index];
  if (entry?.kind !== 'table' || !before || !plainFlowBefore(before)) return null;
  const { table } = entry;
  const { deps } = read;
  const first = before.pageCount;
  // The table's pages, in order, while its fragment runs on from the page above.
  const fragments: TableFragmentRecord[] = [];
  for (let at = first; at < pages.length; at += 1) {
    const page = pages[at]!;
    if (page.anchoredDrawings?.length) return null;
    const fragment = page.fragments.find(
      (item): item is TableFragmentRecord => item.kind === 'table' && item.tableId === table.id
    );
    if (!fragment) break;
    fragments.push(fragment);
  }
  let structure: SemanticTableStructure | null | undefined;
  // Each kept structure is compared with the new rows once, from the first row up.
  const changedAt = new Map<SemanticTableStructure, number>();
  const firstChange = (sources: ReadonlySet<SemanticTableStructure>): number => {
    let first = Number.POSITIVE_INFINITY;
    for (const source of sources) {
      let at = changedAt.get(source);
      if (at === undefined) changedAt.set(source, (at = firstChangedRow(source, structure!)));
      first = Math.min(first, at);
    }
    return first;
  };
  for (let offset = fragments.length - 1; offset > 0; offset -= 1) {
    const pageIndex = first + offset;
    const fragment = fragments[offset]!;
    const start = pageStarts.get(fragment);
    if (!start || pages[pageIndex]!.fragments[0] !== fragment) continue;
    // The kept pages and the restart page's own record must all read as the new rows do.
    const kept = keptSources(fragments, offset);
    if (!kept) continue;
    const { sources } = kept;
    structure ??= readTableStructure(
      table,
      read.width,
      0,
      deps.styleCascade,
      deps.displayMode,
      deps.revisionAuthorFilter,
      deps.compatibilityMode,
      autofitContextOf(deps)
    );
    if (!structure || structure.float) return null;
    const row = structure.rows[start.rowIndex];
    // Every row a decision for the kept pages read must resolve as before, the restart row
    // and the rows read past it included (`table-read-horizon.ts`).
    const through = Math.max(start.rowIndex, start.readThrough);
    if (
      !row ||
      rowHoldsMerge(row) ||
      rowKeepsWithNext(row, deps.styleCascade) ||
      !(through < firstChange(sources))
    )
      continue;
    // The ordinals a full pass holds at this page: every row the kept pages placed.
    const ordinals = new Map<string, number>();
    for (let kept = 0; kept < offset; kept += 1)
      for (const placed of fragments[kept]!.rows)
        if (!placed.isHeaderRepeat && !ordinals.has(placed.id))
          ordinals.set(placed.id, placed.rowIndex);
    const { rowIndex: _row, flow, budgets, ...resume } = start;
    if (observer) {
      observer.restarts += 1;
      observer.keptPages += pageIndex;
    }
    const held: PassBudgets = {
      intervals: deps.borderOwnershipBudget?.intervalsRemaining,
      cells: deps.vMergeResolveBudget?.cellsRemaining,
    };
    setBudgets(deps, budgets);
    return {
      restoreBudgets: () => setBudgets(deps, held),
      pageIndex,
      checkpoint: {
        ...before,
        pageCount: pageIndex,
        pageFragments: [],
        cursorY: 0,
        lineCounter: flow.lineCounter,
      },
      resume: { ...resume, ordinals },
      // A text update on a kept page moved its row's keys to the end of the table's list
      // (`registerEditedTableCellBreakKeys`), so the kept pages' keys are no longer its
      // first ones. Keep the whole list then, each key once, until the table is paginated
      // whole again (`registerMergedTableCellBreakKeys`).
      ...(wholeKeyList(kept.textUpdated, read.previous)
        ? { breakKeys: 0, mergeKeys: true }
        : { breakKeys: flow.breakKeys, mergeKeys: false }),
    };
  }
  return null;
}

/**
 * Record the cell break keys of `table` after a restart: the keys the previous table node
 * recorded before the restart page, then the keys the restart reported.
 */
export function registerRestartedTableKeys(
  table: OoxmlElement,
  previous: PreparedBlock | undefined,
  plan: TableRestartPlan,
  keys: readonly string[]
): void {
  if (plan.mergeKeys) {
    registerMergedTableCellBreakKeys(
      table,
      previous?.kind === 'table' ? previous.table : undefined,
      keys
    );
    return;
  }
  registerResumedTableCellBreakKeys(
    table,
    previous?.kind === 'table' ? previous.table : undefined,
    plan.breakKeys,
    keys
  );
}

/** The page-start state of one table's pagination that can change between page starts. */
export interface TablePageStartAt extends Omit<
  TableResume,
  'ordinals' | 'start' | 'headerGroupHeight' | 'headerMerged' | 'readThrough'
> {
  /** The opening row continues nothing: no split, merge carry, closing-rule plan, or force. */
  readonly open: boolean;
  /** Where the fragment opened. */
  readonly top: number;
  /** The rows the fragment holds before its opening row. */
  readonly rows: readonly TableRowFragmentRecord[];
  /** Index of the opening row in the structure. */
  readonly rowIndex: number;
}

/** Captures the page starts of one pagination of `table`; undefined where none applies. */
export function tablePageStarts(input: {
  readonly structure: SemanticTableStructure;
  readonly start: HeaderGroupStart;
  readonly headerGroupHeight: number;
  readonly headerMerged: boolean;
  readonly deps: TableFlowDeps;
  readonly horizon: ReadHorizon;
}): {
  at(flow: TableFlowPageState | undefined, state: TablePageStartAt): TablePageStart | undefined;
} {
  const { structure, deps } = input;
  const plain = !structure.float && structure.cellSpacingPt === 0;
  return {
    at(flow, state) {
      const row = structure.rows[state.rowIndex];
      const readThrough = input.horizon.through;
      if (
        !flow ||
        !Number.isFinite(readThrough) ||
        !plain ||
        !state.open ||
        !row ||
        state.top > 0.001 ||
        rowHoldsMerge(row) ||
        !state.rows.every((placed) => placed.isHeaderRepeat) ||
        deps.pageExclusionZones?.().length
      )
        return undefined;
      const { open: _open, top: _top, rows: _rows, ...resume } = state;
      return {
        ...resume,
        start: input.start,
        headerGroupHeight: input.headerGroupHeight,
        headerMerged: input.headerMerged,
        readThrough,
        flow,
        budgets: {
          intervals: deps.borderOwnershipBudget?.intervalsRemaining,
          cells: deps.vMergeResolveBudget?.cellsRemaining,
        },
      };
    },
  };
}
