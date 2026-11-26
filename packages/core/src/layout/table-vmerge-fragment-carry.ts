// Carry bounded merged text between physical row groups without changing the tree.
// The carried record keeps the authored head row and cell identity on every page.
//
// A vertical merge (ECMA-376 Part 1 §17.4.84 `w:vMerge`) whose rows cross a page break keeps
// every row at its own height. The rows of the span stay on the page beside the head row as
// space allows, and the merged text breaks at the page boundary and continues beside the rows
// on the next page. Only merged text taller than all the span's rows grows the last row. This
// applies to every row kind: `w:cantSplit`, `hRule="exact"`, and ordinary rows that can split.
//
// §17.4.84: "This element specifies that this cell is part of a vertically merged set of cells
// in a table." The merge joins cells, not rows, so each row keeps its own height rule.
// §17.4.80 (`w:trHeight`): "If omitted, then the table row shall automatically resize its
// height to the height required by its contents". The merged text belongs to the merged cell,
// so it does not count as the contents of one row.
// §17.4.6 (`w:cantSplit`): without it, a page break can fall within the contents of a row.
//
// A two-row merge takes this path only while both rows fit the current page. When the second
// row cannot start on this page, `table-vmerge-boundary.ts` and the head-row split decide,
// unless the head row is `hRule="exact"`: a fixed row clips its own content, so the merged
// text continues here in the part of the merge on the next page.
//
// Merges that share rows take this path only as a family of fixed merges: every row they
// cover is `hRule="exact"` (`fixedFamily`). They can start in the same row or in rows that
// an earlier merge of the family covers. Each merge carries its own text through its own
// rows, and the family activates together.
//
// Each fragment of a carried merge paints its share of the text in one head row: the placed
// head row on the first page, and a zero-height carried head row on each later page. Merges
// from one row share these head rows (`table-vmerge-head-rows.ts`), and a merge that starts in
// a later row has its own.
import type {
  SemanticTableCell,
  SemanticTableRow,
  SemanticTableStructure,
} from './semantic-table.ts';
import type {
  BlockFragmentRecord,
  TableCellFragmentRecord,
  TableRowFragmentRecord,
} from './semantic-records.ts';
import {
  initialCellCursors,
  layoutRowFragmentBounded,
  measureRowHeight,
  TablePaginationError,
  type CellPlaceCursor,
  type LayoutRowBoundedResult,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import { cellContentInsets, type CellContentInsets } from './table-cell-geometry.ts';
import { sharedCellContentInsets } from './cell-content-insets-memo.ts';
import type { RowVMergeLayoutOptions } from './table-vmerge-heights.ts';
import { resolveVMergeSpans } from './table-vmerge.ts';
import { flowsAcrossPages } from './table-vmerge-carry-content.ts';
import { stripAnchorSinksForProbe } from './table-probe-deps.ts';
import { withoutZeroHeightBottomEdge } from './table-vmerge-boundary.ts';
import { isCarriedHeadRow } from './table-carried-head-row.ts';
import { shiftBlocks } from './table-fragment-finalize.ts';
import { cellAlignmentShift } from './table-row-vertical.ts';
import {
  carriedHeadRow,
  createHeadRowEdits,
  withCells,
  withTopAlignedCells,
  type HeadRowEdits,
  type HeadRowKind,
} from './table-vmerge-head-rows.ts';

const blockBottom = (block: BlockFragmentRecord): number => block.box.y + block.box.height;

const EPSILON = 0.001;

interface Head {
  readonly cell: SemanticTableCell;
  cursor: CellPlaceCursor | null;
  complete: boolean;
  /** An earlier fragment placed a line of this text. */
  started?: true;
}

interface Group {
  readonly first: number;
  readonly last: number;
  readonly source: SemanticTableRow;
  readonly heads: Head[];
  physicalHeights: number[];
  heights: number[];
  active: boolean;
  /** Every row is `hRule="exact"`: the last fragment clips what the rows cannot hold. */
  clipsTail?: true;
  /**
   * Where the merged text starts in the open fragment. `pending` marks a fragment that opened
   * with the continuation of a split row: the last row grows when the next row is offered,
   * once the continued part has been placed.
   */
  fragmentStart?: { readonly index: number; readonly top: number; pending?: boolean };
  headRecord?: TableRowFragmentRecord;
  /** The fixed merges that share rows and take this path with it (`fixedFamily`). */
  family?: readonly Group[];
}

export interface VMergeFragmentCarry {
  rowAt(index: number, row: SemanticTableRow, top: number, bottom: number): SemanticTableRow;
  optionsAt(index: number, top: number, bottom: number): RowVMergeLayoutOptions | undefined;
  adjustPlacement(
    index: number,
    placed: LayoutRowBoundedResult,
    bottom: number
  ): LayoutRowBoundedResult;
  /**
   * Whether merged text this row still carries places a line between `top` and `bottom`.
   * `undefined` when the row carries no text past a page break, so the row's own cells decide.
   * The last row of a span can continue only to hold the merged text, and then its own cells
   * have nothing left to place.
   */
  carriedTextFitsAt(index: number, top: number, bottom: number): boolean | undefined;
  /** A split row continues at `top` in a new fragment, so the merged text starts there. */
  continuedAt(index: number, top: number): void;
  finish(rows: TableRowFragmentRecord[]): TableRowFragmentRecord[];
  publish(
    records: TableRowFragmentRecord[],
    sources: SemanticTableRow[],
    insets: Map<TableRowFragmentRecord, ReadonlyMap<string, CellContentInsets>>,
    left: number
  ): { rows: TableRowFragmentRecord[]; sources: SemanticTableRow[] };
}

const continuing = new WeakMap<SemanticTableRow, boolean>();

/** Whether a cell of `row` continues a vertical merge. */
function continuesMerge(row: SemanticTableRow): boolean {
  let known = continuing.get(row);
  if (known === undefined)
    continuing.set(row, (known = row.cells.some((cell) => cell.vMergeContinue)));
  return known;
}

/**
 * `sorted` (by first row) split into runs of merges that share rows. `last` is the last row
 * that a run covers.
 */
function overlappingClusters(sorted: readonly Group[]): { members: Group[]; last: number }[] {
  const clusters: { members: Group[]; last: number }[] = [];
  for (const group of sorted) {
    const open = clusters.at(-1);
    if (open && group.first <= open.last) {
      open.members.push(group);
      open.last = Math.max(open.last, group.last);
    } else clusters.push({ members: [group], last: group.last });
  }
  return clusters;
}

/** Whether `group` decides activation for its family: the first member, or a lone merge. */
const leadsFamily = (group: Group): boolean => (group.family?.[0] ?? group) === group;

/**
 * Merges whose rows can cross a page while their text uses a cursor. Their content must flow
 * across pages (`flowsAcrossPages`, `table-vmerge-carry-content.ts`).
 */
export function createVMergeFragmentCarry(
  structure: SemanticTableStructure,
  rows: readonly SemanticTableRow[],
  deps: TableFlowDeps,
  left: () => number
): VMergeFragmentCarry {
  const groups: Group[] = [];
  const atRow = new Map<number, Group[]>();
  const rowIndex = new Map(rows.map((row, index) => [row.id, index]));
  // Most tables continue no merge; a structure read keeps its rows, so each row is asked once.
  const spans = rows.some(continuesMerge) ? resolveVMergeSpans(rows) : new Map<string, number>();
  const grouped = new Map<string, Group>();
  let work = 0;
  for (const [index, row] of rows.entries()) {
    for (const cell of row.cells) {
      const count = spans.get(cell.id) ?? 1;
      if (count < 2 || cell.vMergeContinue) continue;
      work += count;
      if (work > 100_000 || grouped.size >= 4096) break;
      const last = index + count - 1;
      if (last >= rows.length) continue;
      const key = `${index}:${last}`;
      let group = grouped.get(key);
      if (!group) {
        group = {
          first: index,
          last,
          source: row,
          heads: [],
          physicalHeights: [],
          heights: [],
          active: false,
        };
        grouped.set(key, group);
      }
      group.heads.push({ cell, cursor: null, complete: false });
    }
    if (work > 100_000 || grouped.size >= 4096) break;
  }
  if (
    work <= 100_000 &&
    grouped.size < 4096 &&
    !structure.float &&
    !deps.pageExclusionZones?.().length
  ) {
    const candidates = [...grouped.values()].sort((a, b) => a.first - b.first);
    const nodeBudget = { remaining: 100_000 };
    const validGroup = (group: Group): boolean => {
      let fixed = true;
      for (let index = group.first; index <= group.last; index++)
        fixed &&= rows[index]!.height.rule === 'exact';
      if (!group.heads.every((head) => flowsAcrossPages(head.cell, nodeBudget, fixed)))
        return false;
      for (let index = group.first; index <= group.last; index++) {
        const row = rows[index]!;
        if (row.isHeader) return false;
        const cells = new Map<number, SemanticTableCell>();
        for (const cell of row.cells) {
          if (cells.has(cell.gridColumn)) return false;
          cells.set(cell.gridColumn, cell);
        }
        for (const head of group.heads) {
          const matching = cells.get(head.cell.gridColumn);
          if (
            !matching ||
            matching.gridSpan !== head.cell.gridSpan ||
            (index > group.first && !matching.vMergeContinue)
          ) {
            return false;
          }
        }
      }
      return true;
    };
    // Merges that share a row form one cluster. A cluster of one merge group takes this path
    // alone. A larger cluster takes it only as a family of fixed merges (`fixedFamily`).
    for (const { members, last } of overlappingClusters(candidates)) {
      if (members.length > 1 && !fixedFamily(members, last)) continue;
      if (!members.every(validGroup)) continue;
      for (const group of members) {
        if (members.length > 1) group.family = members;
        groups.push(group);
        for (let index = group.first; index <= group.last; index++) {
          const here = atRow.get(index);
          if (here) here.push(group);
          else atRow.set(index, [group]);
        }
      }
    }
  }

  /**
   * Merges that share rows, over rows that are all `hRule="exact"` (`w:trHeight`, `CT_Height`,
   * §17.4.80; `ST_HeightRule`, §17.18.37). No merged text can change the height of a fixed row,
   * so the merges cannot affect each other's rows, and each one carries its own text through
   * its own rows. This holds for merges from one row and for a merge that starts in a row an
   * earlier one covers. They take this path together or not at all: a head left on the older
   * path would size its row, and the row clips what it cannot hold. The first merge decides
   * for the family when its head row is placed.
   */
  function fixedFamily(cluster: readonly Group[], last: number): boolean {
    const first = cluster[0]!.first;
    // A later member's top is predicted from the fixed rows above it (`activate`). Cell
    // spacing adds gaps between rows that the prediction does not hold, so such a table keeps
    // families to one head row.
    if (structure.cellSpacingPt > 0 && cluster.some((group) => group.first !== first)) return false;
    for (let index = first; index <= last; index++) {
      if (rows[index]!.height.rule !== 'exact') return false;
    }
    return true;
  }

  /**
   * Whether a prepared group takes this path at `top`. A two-row merge takes it only while
   * both rows fit the page, because `table-vmerge-boundary.ts` and the head-row split decide
   * the other case. Neither of those continues the text of a fixed head row, which clips its
   * own content, so a merge headed in an `hRule="exact"` row takes this path as well.
   */
  function wantsCarry(group: Group, top: number, bottom: number): boolean {
    const total = group.heights.reduce((sum, height) => sum + height, 0);
    const physicalTotal = group.physicalHeights.reduce((sum, height) => sum + height, 0);
    return (
      top + total > bottom + EPSILON &&
      group.physicalHeights.every((height) => height <= bottom + EPSILON) &&
      (group.last - group.first >= 2 ||
        top + physicalTotal <= bottom + EPSILON ||
        rows[group.first]!.height.rule === 'exact')
    );
  }

  /** Activate the group, with every merge of its family when one of them needs the carry. */
  function activate(group: Group, top: number, bottom: number): void {
    const family = group.family ?? [group];
    if (!family.every(prepare)) return;
    // A merge that starts in a later row starts below the rows above it. They are fixed rows of
    // the family, so `prepare` has measured each one.
    const topOf = (member: Group): number => {
      let at = top;
      for (let index = group.first; index < member.first; index++)
        at += fixedRowHeight.get(index) ?? 0;
      return at;
    };
    if (!family.some((member) => wantsCarry(member, topOf(member), bottom))) return;
    if (!family.every((member) => member.physicalHeights.every((h) => h <= bottom + EPSILON)))
      return;
    for (const member of family) member.active = true;
  }

  /** The active groups that cover the row at `index`. */
  const activeAt = (index: number): Group[] =>
    (atRow.get(index) ?? []).filter((group) => group.active);

  /** Dependencies for a measuring layout: no caches, sinks, or budgets, and its own line ids. */
  function probeDepsFor(linePrefix: string): TableFlowDeps {
    let lineId = 0;
    return {
      ...stripAnchorSinksForProbe(deps),
      cache: undefined,
      borderOwnershipBudget: undefined,
      vMergeResolveBudget: undefined,
      onCellBreakKey: undefined,
      nextLineId: () => `${linePrefix}-${lineId++}`,
    };
  }

  /**
   * `row` with the merge's head cells emptied. Only the head row holds them, so every other
   * row stays the same object: row deps such as the table's closing rule
   * (`table-exact-terminal-border.ts`) find their row by identity.
   */
  function emptied(group: Group, row: SemanticTableRow): SemanticTableRow {
    const headIds = new Set(group.heads.map((head) => head.cell.id));
    if (!row.cells.some((cell) => headIds.has(cell.id))) return row;
    return {
      ...row,
      cells: row.cells.map((cell) =>
        headIds.has(cell.id) ? { ...cell, blocks: [], vMergeContinue: true } : cell
      ),
    };
  }

  // A fixed row's height does not depend on its cells' content, so the merges of a family,
  // which share their rows, measure each row once.
  const fixedRowHeight = new Map<number, number>();

  function prepare(group: Group): boolean {
    const probeDeps = probeDepsFor('probe-vmerge-fragment');
    const cols = structure.columnWidthsPt;
    const spacing = structure.cellSpacingPt;
    const heights: number[] = [];
    for (let index = group.first; index <= group.last; index++) {
      const row = rows[index]!;
      const fixed = row.height.rule === 'exact';
      const height =
        (fixed ? fixedRowHeight.get(index) : undefined) ??
        measureRowHeight(emptied(group, row), cols, left(), 0, probeDeps, spacing);
      if (fixed) fixedRowHeight.set(index, height);
      heights.push(height);
    }
    if (heights.some((height) => !Number.isFinite(height) || height <= EPSILON)) return false;
    group.physicalHeights = [...heights];
    let total = heights.reduce((sum, height) => sum + height, 0);
    // When no row can grow, the last fragment clips the text at its bottom. A page break can
    // leave part of a fixed row empty, so text that fits the unbroken rows can still reach
    // past the last one. The clip then shows the line it cuts, the way a fixed row does.
    if (rows.slice(group.first, group.last + 1).every((row) => row.height.rule === 'exact'))
      group.clipsTail = true;
    for (const head of group.heads) {
      const needed = measureRowHeight(
        { ...group.source, height: { rule: 'auto' }, cells: [head.cell] },
        cols,
        left(),
        0,
        probeDeps,
        spacing
      );
      if (!Number.isFinite(needed) || needed < 0) return false;
      if (needed > total + EPSILON) {
        let grow = group.last;
        while (grow >= group.first && rows[grow]!.height.rule === 'exact') grow--;
        // No row can grow: the fixed rows carry what they hold, and `clipsTail` (set above,
        // because every row is fixed) clips the rest in the last fragment.
        if (grow < group.first) continue;
        heights[grow - group.first]! += needed - total;
        total = needed;
      }
    }
    group.heights = heights;
    return true;
  }

  function placeHead(
    group: Group,
    head: Head,
    first: TableRowFragmentRecord,
    bottom: number,
    x: number,
    final: boolean
  ): TableCellFragmentRecord {
    // The fragment that ends the span places the rest of the text as one exact row, so the
    // line it cuts shows partly and the text below the span stays in the document.
    const clips = final && group.clipsTail === true;
    // The last piece is placed as a plain cell, because a merge head never clips to its row.
    const { headsVerticalMerge: _head, restartsVerticalMerge: _restart, ...plainCell } = head.cell;
    const sourceCell = { ...(clips ? plainCell : head.cell), vAlign: 'top' as const };
    const row: SemanticTableRow = {
      ...group.source,
      height: clips ? { rule: 'exact', valuePt: bottom - first.box.y } : { rule: 'auto' },
      cantSplit: false,
      cells: [sourceCell],
    };
    const cursors = initialCellCursors(row);
    if (head.cursor) cursors[0] = head.cursor;
    let blocks: readonly BlockFragmentRecord[] = [];
    if (!head.complete) {
      const placed = layoutRowFragmentBounded(
        row,
        structure.columnWidthsPt,
        x,
        first.box.y,
        bottom,
        false,
        head.cursor !== null,
        0,
        deps,
        cursors,
        structure.cellSpacingPt
      );
      const cell = placed.record.cells[0]!;
      blocks = cell.blocks;
      if (blocks.some((block) => block.kind !== 'paragraph' || block.lines.length > 0))
        head.started = true;
      head.complete = placed.remainder === null;
      head.cursor = placed.remainder?.[0] ?? null;
      if (!head.complete && !head.cursor)
        throw new TablePaginationError(
          'table-row-split-unsupported',
          'Merged text lost its continuation cursor'
        );
    }
    const original = group.headRecord!.cells.find((cell) => cell.id === head.cell.id)!;
    return {
      ...original,
      blocks,
      vMergeContinue: false,
      paintInert: false,
      box: {
        ...original.box,
        x: x + original.box.x - group.headRecord!.box.x,
        y: first.box.y,
        height: bottom - first.box.y,
      },
    };
  }

  // A page cut can leave less than one line unused. The unbroken height cannot
  // predict that loss. Measure the carried cursor again before placing this fragment.
  function growForRemainingText(group: Group, index: number, top: number): void {
    const start = group.fragmentStart;
    // The rows above `index` in this fragment hold the text from `textTop`, and they already
    // have their place: only the rows from `index` on can still grow.
    let textTop = top;
    if (start?.pending && start.index < index) {
      start.pending = false;
      textTop = start.top;
    } else if (start && (start.index !== index || start.top === top)) return;
    else group.fragmentStart = { index, top };
    let grow = group.last;
    while (grow >= index && rows[grow]!.height.rule === 'exact') grow--;
    if (grow < index) return;
    const probeDeps = probeDepsFor('probe-vmerge-remainder');
    const available =
      top -
      textTop +
      group.heights.slice(index - group.first).reduce((sum, height) => sum + height, 0);
    let needed = available;
    for (const head of group.heads) {
      if (head.complete) continue;
      const row: SemanticTableRow = {
        ...group.source,
        height: { rule: 'auto' },
        cantSplit: false,
        cells: [{ ...head.cell, vAlign: 'top' }],
      };
      const cursors = initialCellCursors(row);
      if (head.cursor) cursors[0] = head.cursor;
      const probe = layoutRowFragmentBounded(
        row,
        structure.columnWidthsPt,
        left(),
        textTop,
        Infinity,
        false,
        head.cursor !== null,
        0,
        probeDeps,
        cursors,
        structure.cellSpacingPt
      );
      const height = probe.bottom - textTop;
      if (probe.remainder !== null || !Number.isFinite(height) || height < 0)
        throw new TablePaginationError(
          'table-row-split-unsupported',
          'Cannot measure remaining merged text'
        );
      needed = Math.max(needed, height);
    }
    if (needed > available + EPSILON) group.heights[grow - group.first]! += needed - available;
  }

  function adjustedLastRow(
    group: Group,
    placed: LayoutRowBoundedResult,
    bottom: number
  ): LayoutRowBoundedResult {
    const top = group.fragmentStart?.top ?? placed.record.box.y;
    const probeDeps = probeDepsFor('probe-vmerge-final-row');
    let requiredBottom = placed.bottom;
    const pending = group.heads
      .filter((head) => !head.complete)
      .map((head) => {
        const row: SemanticTableRow = {
          ...group.source,
          height: { rule: 'auto' },
          cantSplit: false,
          cells: [{ ...head.cell, vAlign: 'top' }],
        };
        const cursors = initialCellCursors(row);
        if (head.cursor) cursors[0] = head.cursor;
        const measure = layoutRowFragmentBounded(
          row,
          structure.columnWidthsPt,
          left(),
          top,
          Infinity,
          false,
          head.cursor !== null,
          0,
          probeDeps,
          cursors,
          structure.cellSpacingPt
        );
        if (measure.remainder !== null || !Number.isFinite(measure.bottom))
          throw new TablePaginationError(
            'table-row-split-unsupported',
            'Cannot measure the final merged row'
          );
        requiredBottom = Math.max(requiredBottom, measure.bottom);
        return { head, row, cursors };
      });
    const end = Math.min(bottom, requiredBottom);
    let incomplete = false;
    let fitted = placed.fitted;
    for (const { head, row, cursors } of pending) {
      const probe = layoutRowFragmentBounded(
        row,
        structure.columnWidthsPt,
        left(),
        top,
        end,
        false,
        head.cursor !== null,
        0,
        probeDeps,
        cursors,
        structure.cellSpacingPt
      );
      incomplete ||= probe.remainder !== null;
      fitted ||= probe.fitted;
    }
    if (end <= placed.bottom + EPSILON && !incomplete)
      return fitted === placed.fitted ? placed : { ...placed, fitted };
    const height = end - placed.record.box.y;
    const record: TableRowFragmentRecord = {
      ...placed.record,
      box: { ...placed.record.box, height },
      cells: placed.record.cells.map((cell) => ({
        ...cell,
        box: { ...cell.box, height: height - (cell.box.y - placed.record.box.y) },
      })),
    };
    // Completed neighbours must not restart when only the merged head needs another page.
    const completed = initialCellCursors(rows[group.last]!).map((cursor, index) => ({
      ...cursor,
      blockIndex: rows[group.last]!.cells[index]!.blocks.length,
    }));
    return {
      ...placed,
      record,
      bottom: end,
      fitted,
      remainder: placed.remainder ?? (incomplete ? completed : null),
    };
  }

  /**
   * Align the merged text of `aligned` (heads of `group`) against the lowest line of the other
   * cells in a split last row.
   */
  function alignAboveSplitRow(
    group: Group,
    aligned: readonly Head[],
    last: TableRowFragmentRecord,
    placed: Map<string, TableCellFragmentRecord>
  ): void {
    const headIds = new Set(group.heads.map((head) => head.cell.id));
    let lineBottom = Number.NEGATIVE_INFINITY;
    for (const cell of last.cells) {
      if (headIds.has(cell.id)) continue;
      for (const block of cell.blocks) lineBottom = Math.max(lineBottom, blockBottom(block));
    }
    for (const head of aligned) {
      const cell = placed.get(head.cell.id);
      if (!cell || head.cell.vAlign === 'top' || cell.blocks.length === 0) continue;
      const room = lineBottom - Math.max(...cell.blocks.map(blockBottom));
      if (room > EPSILON)
        placed.set(head.cell.id, {
          ...cell,
          blocks: shiftBlocks(cell.blocks, cellAlignmentShift(head.cell.vAlign, room)),
        });
    }
  }

  /**
   * The content insets of the head cells of `group` in a fragment that a page break cuts,
   * where the merge's first and last rows in the fragment are `first` and `last`. A carried
   * fragment's first row does not hold the head cells, so their insets start from the shared
   * ones there.
   *
   * The merged cell closes the fragment with that row, so its bottom inset is the one its
   * own cell in that row uses, as the cells beside it do. A merge that reaches the table's
   * last row reserves the table's outer bottom rule (`w:bottom`, ECMA-376 Part 1 §17.4.4;
   * `CT_Border`, §17.3.4) inside its own box. A fragment that the merge continues past places
   * that rule as the cells beside it do. Without this, the merged cell's closing rule sits one
   * rule width above theirs.
   * When `last` is the head row, the head cell is that own cell: it then reserves what a cell
   * that does not close the table reserves, unless the row splits and its placement reserved
   * the inside rule at the cut (`cutRowContentDeps`).
   * Only the bottom inset changes. The other sides keep what the head row's placement gave.
   */
  function cutInsets(
    group: Group,
    first: TableRowFragmentRecord,
    last: TableRowFragmentRecord,
    insets: ReadonlyMap<TableRowFragmentRecord, ReadonlyMap<string, CellContentInsets>>
  ): ReadonlyMap<string, CellContentInsets> | undefined {
    if (structure.cellSpacingPt > 0) return undefined;
    const lastRow = rows[rowIndex.get(last.id)!]!;
    const cut = new Map<string, CellContentInsets>();
    for (const { cell } of group.heads) {
      const closing = lastRow.cells.find((other) => other.gridColumn === cell.gridColumn);
      if (!closing) continue;
      const own = insets.get(last)?.get(closing.id);
      const bottom =
        closing.id !== cell.id
          ? (own ?? sharedCellContentInsets(closing, true)).bottom
          : last.hasContinuation && own
            ? own.bottom
            : cellContentInsets({ ...cell, contentBottomIsOuter: false }, true).bottom;
      const before = insets.get(first)?.get(cell.id) ?? sharedCellContentInsets(cell, true);
      if (before.bottom !== bottom) cut.set(cell.id, { ...before, bottom });
    }
    return cut.size > 0 ? cut : undefined;
  }

  /** For each active merge, the indexes of its rows' records. A repeated header row is none. */
  function coveredRecords(records: readonly TableRowFragmentRecord[]): Map<Group, number[]> {
    const covered = new Map<Group, number[]>();
    for (const [index, record] of records.entries()) {
      const authored = rowIndex.get(record.id);
      if (record.isHeaderRepeat || authored === undefined) continue;
      for (const group of activeAt(authored)) {
        const indexes = covered.get(group);
        if (indexes) indexes.push(index);
        else covered.set(group, [index]);
      }
    }
    return covered;
  }

  /**
   * Place the share of the merged text of `group` that the records at `indexes` hold, and
   * publish it into the head row of their fragment (`table-vmerge-head-rows.ts`).
   */
  function publishGroup(
    group: Group,
    records: readonly TableRowFragmentRecord[],
    indexes: readonly number[],
    x: number,
    edits: HeadRowEdits,
    insets: ReadonlyMap<TableRowFragmentRecord, ReadonlyMap<string, CellContentInsets>>
  ): void {
    const firstIndex = indexes[0]!;
    const first = records[firstIndex]!;
    const last = records[indexes[indexes.length - 1]!]!;
    // Only the first fragment of the merge holds the authored head row.
    const holdsHeadRow = first.id === group.source.id;
    if (!group.headRecord) {
      if (!holdsHeadRow)
        throw new TablePaginationError(
          'table-row-split-unsupported',
          'Merged text has no placed head row'
        );
      group.headRecord = first;
    }
    const bottom = last.box.y + last.box.height;
    const final = rowIndex.get(last.id) === group.last && !last.hasContinuation;
    // `w:vAlign` (`CT_VerticalJc`, ECMA-376 Part 1 §17.4.83): "This element specifies the
    // vertical alignment for text within the current table cell." The merged text keeps its
    // alignment in the fragment where its first line is placed: the fragment that holds the
    // head row, or a later one when no line fits beside the head row. This holds also when the
    // text goes on to the next page. A fragment that continues text placed on an earlier page
    // fills from the top. The specification does not define alignment for a cell that breaks
    // across pages, so this split is a layout rule.
    const startedBefore = new Set(
      group.heads.filter((head) => head.started).map((head) => head.cell.id)
    );
    const placed = new Map(
      group.heads.map((head) => [head.cell.id, placeHead(group, head, first, bottom, x, final)])
    );
    group.fragmentStart = undefined;
    // When the last row splits while the text goes on, that row ends at its lowest line,
    // not at the page bottom. Text that starts here is aligned against that line instead.
    const splitTail =
      last.hasContinuation === true && group.heads.some((head) => !head.complete)
        ? group.heads.filter((head) => !startedBefore.has(head.cell.id))
        : [];
    if (splitTail.length > 0) alignAboveSplitRow(group, splitTail, last, placed);
    const topAligned = new Set([...startedBefore, ...splitTail.map((head) => head.cell.id)]);

    const kind: HeadRowKind = holdsHeadRow ? 'placed' : 'carried';
    const previous = edits.current(kind, firstIndex, group.source.id);
    const base =
      previous?.record ?? (holdsHeadRow ? first : carriedHeadRow(group.headRecord, first, x));
    const source = previous?.source ?? group.source;
    edits.publish(
      kind,
      firstIndex,
      {
        record: withCells(base, placed),
        source: topAligned.size > 0 ? withTopAlignedCells(source, topAligned) : source,
      },
      previous,
      final ? undefined : cutInsets(group, first, last, insets)
    );

    if (
      final &&
      rows[group.last]!.height.rule !== 'exact' &&
      group.heads.some((head) => !head.complete)
    ) {
      throw new TablePaginationError(
        'table-row-split-unsupported',
        'Merged text remains after its authored row span'
      );
    }
  }

  return {
    rowAt(index, row, top, bottom) {
      const here = atRow.get(index);
      if (!here) return row;
      for (const group of here) {
        // A family decides once, through its first member, when the first head row is placed.
        if (index === group.first && !group.active && leadsFamily(group))
          activate(group, top, bottom);
      }
      let placed = row;
      for (const group of here) if (group.active) placed = emptied(group, placed);
      return placed;
    },
    optionsAt(index, top, _bottom) {
      const active = activeAt(index);
      if (active.length === 0) return undefined;
      // The last row's floor includes the remaining merged text, so a
      // nonbreaking tail moves whole to the next page. A tail taller than a
      // page starts on a fresh page and adjustPlacement splits it there.
      let floor = 0;
      for (const group of active) {
        growForRemainingText(group, index, top);
        floor = Math.max(floor, group.heights[index - group.first]!);
      }
      return { heightFloorPt: floor };
    },
    continuedAt(index, top) {
      for (const group of activeAt(index)) {
        if (!group.fragmentStart) group.fragmentStart = { index, top, pending: true };
      }
    },
    carriedTextFitsAt(index, top, bottom) {
      const ending = activeAt(index).filter((group) => index === group.last);
      const pending = ending.flatMap((group) =>
        group.heads.filter((head) => !head.complete).map((head) => ({ group, head }))
      );
      if (pending.length === 0) return undefined;
      const probeDeps = probeDepsFor('probe-vmerge-carried-start');
      return pending.some(({ group, head }) => {
        const row: SemanticTableRow = {
          ...group.source,
          height: { rule: 'auto' },
          cantSplit: false,
          cells: [{ ...head.cell, vAlign: 'top' }],
        };
        const cursors = initialCellCursors(row);
        if (head.cursor) cursors[0] = head.cursor;
        return layoutRowFragmentBounded(
          row,
          structure.columnWidthsPt,
          left(),
          top,
          bottom,
          false,
          head.cursor !== null,
          0,
          probeDeps,
          cursors,
          structure.cellSpacingPt
        ).fitted;
      });
    },
    adjustPlacement(index, placed, bottom) {
      if (rows[index]!.height.rule === 'exact') return placed;
      let adjusted = placed;
      for (const group of activeAt(index)) {
        if (index === group.last) adjusted = adjustedLastRow(group, adjusted, bottom);
      }
      return adjusted;
    },
    finish(records) {
      if (!groups.some((group) => group.active)) return records;
      return records.map((row) =>
        isCarriedHeadRow(row) ? { ...row, cells: row.cells.map(withoutZeroHeightBottomEdge) } : row
      );
    },
    publish(records, sources, insets, x) {
      if (!groups.some((group) => group.active)) return { rows: records, sources };
      const edits = createHeadRowEdits(records, insets);
      const covered = coveredRecords(records);
      for (const group of groups) {
        const indexes = covered.get(group);
        if (group.active && indexes) publishGroup(group, records, indexes, x, edits, insets);
      }
      return edits.assemble(sources);
    },
  };
}
