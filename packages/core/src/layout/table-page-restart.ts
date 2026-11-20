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
//   against its neighbors, its index, and the table's last row.
// - Nothing an earlier row decided reads past the restart row. A row reads the next row for
//   its closing rule, and a `w:keepNext` row reads the rows it keeps with, so the restart row
//   and the row above it may not both keep with the next row. A vertical merge is planned
//   from its head row, so the restart row may not head or continue one.
// - The paginator state at the page top is carried: the fragment number, the header group
//   decisions, the row ordinals of the earlier pages, the pass budgets, the cell break keys,
//   and the line counter. A page start is recorded only where nothing else is open: no split
//   row, no merge, no closing-rule plan, no wrap zones, no cell spacing, no floats.
//
// The body flow carries the rest (`semantic-layout.ts`): the pages are kept, the header and
// footer variants and note reserves come with each page index, and a restart is refused when
// the flow before the table holds anything a page top could carry (drawings, frames,
// positioned tables). Collaboration is unaffected: this reads the tree and writes no ops.
//
// Every fragment the paginator closes records the structure it was laid out from. A restart
// compares the new rows with the structure of every fragment it keeps, so kept pages from
// earlier restarts stay valid. A fragment that another path made, such as the in-place text
// update, records nothing, and the next structure edit paginates the whole table again. The
// records are set once on new fragments and never change, so a dropped pass leaves none stale.

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
import { registerResumedTableCellBreakKeys } from './table-cell-break-keys.ts';
import { rowKeepsWithNext } from './table-row-keeps.ts';
import { hasTableMerge } from './table-border-probe.ts';
import { holdsNestedTable } from './table-flow-structure.ts';

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
  /** Row ordinals of the rows placed on the kept pages; the paginator adds to it. */
  readonly ordinals: Map<string, number>;
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

/** Kept fragments may come from this many structures; more paginate the table whole. */
const MAX_KEPT_SOURCES = 4;

/**
 * The structures the fragments `[0, through]` were laid out from, or null when one has none or
 * there are more than `MAX_KEPT_SOURCES`.
 */
function keptSources(
  fragments: readonly TableFragmentRecord[],
  through: number
): Set<SemanticTableStructure> | null {
  const sources = new Set<SemanticTableStructure>();
  for (let at = 0; at <= through; at += 1) {
    const source = fragmentSources.get(fragments[at]!);
    if (!source) return null;
    sources.add(source);
    if (sources.size > MAX_KEPT_SOURCES) return null;
  }
  return sources;
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
 * Whether `after` paginates rows `[0, through]` exactly as each of `sources` does. Rows are
 * compared from `through` down, every source at each row, because an edit changes the rows
 * nearest the restart row first.
 */
function samePrefix(
  sources: ReadonlySet<SemanticTableStructure>,
  after: SemanticTableStructure,
  through: number
): boolean {
  const { rows: afterRows, ...afterFrame } = after;
  const others: SemanticTableStructure[] = [];
  for (const before of sources) {
    if (before === after) continue;
    if (
      hasTableMerge(before) !== hasTableMerge(after) ||
      holdsNestedTable(before) !== holdsNestedTable(after)
    )
      return false;
    const { rows: _rows, ...beforeFrame } = before;
    if (!sameValue(beforeFrame, afterFrame)) return false;
    others.push(before);
  }
  for (let index = through; index >= 0; index -= 1)
    for (const before of others) if (!sameValue(before.rows[index], afterRows[index])) return false;
  return true;
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

let observer: { restarts: number; keptPages: number } | null = null;

/** @internal Counts the restarts planned and the pages they keep, for tests that need one. */
export function tablePageRestartTestRecorder(): {
  readonly restarts: number;
  readonly keptPages: number;
  dispose(): void;
} {
  const counts = { restarts: 0, keptPages: 0 };
  observer = counts;
  return {
    get restarts() {
      return counts.restarts;
    },
    get keptPages() {
      return counts.keptPages;
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
  read: { readonly width: number; readonly deps: TableFlowDeps }
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
  for (let offset = fragments.length - 1; offset > 0; offset -= 1) {
    const pageIndex = first + offset;
    const fragment = fragments[offset]!;
    const start = pageStarts.get(fragment);
    if (!start || pages[pageIndex]!.fragments[0] !== fragment) continue;
    // The kept pages and the restart page's own record must all read as the new rows do.
    const sources = keptSources(fragments, offset);
    if (!sources) continue;
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
    const at = start.rowIndex;
    const row = structure.rows[at];
    const above = structure.rows[at - 1];
    if (
      !row ||
      rowHoldsMerge(row) ||
      (above &&
        rowKeepsWithNext(above, deps.styleCascade) &&
        rowKeepsWithNext(row, deps.styleCascade)) ||
      !samePrefix(sources, structure, at)
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
      breakKeys: flow.breakKeys,
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
  'ordinals' | 'start' | 'headerGroupHeight' | 'headerMerged'
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
}): {
  at(flow: TableFlowPageState | undefined, state: TablePageStartAt): TablePageStart | undefined;
} {
  const { structure, deps } = input;
  const plain = !structure.float && structure.cellSpacingPt === 0;
  return {
    at(flow, state) {
      const row = structure.rows[state.rowIndex];
      if (
        !flow ||
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
        flow,
        budgets: {
          intervals: deps.borderOwnershipBudget?.intervalsRemaining,
          cells: deps.vMergeResolveBudget?.cellsRemaining,
        },
      };
    },
  };
}
