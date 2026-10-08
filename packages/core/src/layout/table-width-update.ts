// Re-placing a table whose AutoFit column widths changed, without paginating it again.
//
// Typing into an AutoFit cell can move every column edge of the table. When each row keeps
// its vertical geometry, every pagination decision stays the same: the paginator decides
// from row heights, line counts and line heights, never from x. So each page fragment is
// placed again at its old row tops with the new widths and the placement each row had
// (fragment-first insets, the terminal row's own bottom edge, header merge plans).
//
// The result is accepted only when every row, cell, paragraph, line and border stroke has
// the same vertical geometry as before. Anything else (a row that wraps differently, a
// split row, a merge outside the header group, floats, drawings, RTL or nested tables)
// returns null and the caller runs the full table layout instead.

import { ordinaryTableParagraph } from './table-ordinary-paragraph.ts';
import { firstRowContentDeps, lastRowContentDeps } from './table-fragment-content-insets.ts';
import { bodyLineId } from './body-line-id.ts';
import {
  tableOriginX,
  type SemanticTableRow,
  type SemanticTableStructure,
} from './semantic-table.ts';
import { layoutRowFragment, type TableFlowDeps } from './semantic-table-layout.ts';
import { finalizeTableRows } from './table-fragment-finalize.ts';
import { hasTableMerge } from './table-border-probe.ts';
import { planHeaderGroup, type HeaderGroupPlan } from './table-header-vmerge.ts';
import { createRowProbeReuse } from './table-row-probe-reuse.ts';
import { withoutAnchorSinks } from './table-probe-deps.ts';
import { annotateTableFragmentGeometry } from './semantic-table-interaction.ts';
import { registerTableCellBreakKeys } from './layout-cache.ts';
import { isOutOfFlowFragment } from './fragment-flow.ts';
import { finalizedWithHeadroom, withBudgetProof } from './table-budget-proof.ts';
import { moveRowToWidths } from './table-row-geometry-reuse.ts';
import {
  closeGrownRow,
  growthBandOf,
  nextFragmentOpening,
  nextRowMovesAt,
  rowGrowthKeepsNothing,
  rowLineCount,
  sameRowMembership,
} from './table-row-growth.ts';
import type { CellContentInsets } from './table-cell-geometry.ts';
import type { TableBorderStrokeRecord } from './table-borders.ts';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type {
  BlockFragmentRecord,
  LineRecord,
  PageRecord,
  TableCellFragmentRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from './semantic-records.ts';

type TableFragment = Extract<BlockFragmentRecord, { kind: 'table' }>;

/** Same result shape as `updateTableText`. */
export interface TableWidthUpdate {
  readonly paragraphPagesUnchanged: true;
  readonly pages: readonly PageRecord[];
  readonly lineDelta: number;
  readonly replacements: ReadonlyMap<BlockFragmentRecord, BlockFragmentRecord>;
}

/**
 * Structural eligibility of one resolved table, memoized per immutable structure. A text
 * edit gives the table a new structure that shares every unchanged row object, so the row
 * answers are memoized per row as well.
 */
const eligibleStructures = new WeakMap<SemanticTableStructure, boolean>();
const listFreeStructures = new WeakMap<SemanticTableStructure, number>();
const eligibleRows = new WeakMap<SemanticTableRow, boolean>();
const listFreeRows = new WeakMap<SemanticTableRow, number>();
const listIdentities = new WeakMap<NonNullable<TableFlowDeps['listItems']>, number>();
let nextListIdentity = 1;

function listIdentity(items: NonNullable<TableFlowDeps['listItems']>): number {
  let identity = listIdentities.get(items);
  if (identity === undefined) listIdentities.set(items, (identity = nextListIdentity++));
  return identity;
}

function eligibleRow(row: SemanticTableRow): boolean {
  let known = eligibleRows.get(row);
  if (known === undefined) {
    known = row.cells.every(
      (cell) =>
        cell.logicalGridColumn === undefined &&
        cell.textDirection === 'horizontal' &&
        // A merge is planned here only inside the leading header group.
        (!cell.vMergeContinue || row.isHeader) &&
        cell.blocks.every((block) => block.kind === 'paragraph' && ordinaryTableParagraph(block))
    );
    eligibleRows.set(row, known);
  }
  return known;
}

function listFreeRow(
  row: SemanticTableRow,
  listItems: NonNullable<TableFlowDeps['listItems']>,
  identity: number
) {
  if (listFreeRows.get(row) === identity) return true;
  const listFree = row.cells.every((cell) =>
    cell.blocks.every((block) => !listItems.has(block.id))
  );
  if (listFree) listFreeRows.set(row, identity);
  return listFree;
}

function eligibleStructure(structure: SemanticTableStructure, deps: TableFlowDeps): boolean {
  let known = eligibleStructures.get(structure);
  if (known === undefined) {
    known =
      !structure.float &&
      !structure.bidiVisual &&
      structure.cellSpacingPt === 0 &&
      structure.rows.every(eligibleRow);
    eligibleStructures.set(structure, known);
  }
  // List markers depend on the body counter stream, which this lane does not walk.
  const listItems = deps.listItems;
  if (!known || !listItems?.size) return known;
  const identity = listIdentity(listItems);
  if (listFreeStructures.get(structure) === identity) return true;
  const listFree = structure.rows.every((row) => listFreeRow(row, listItems, identity));
  if (listFree) listFreeStructures.set(structure, identity);
  return listFree;
}

/** True when the two structures describe the same rows and cells. */
function sameGrid(a: SemanticTableStructure, b: SemanticTableStructure): boolean {
  if (a.rows.length !== b.rows.length || a.columnWidthsPt.length !== b.columnWidthsPt.length)
    return false;
  for (let index = 0; index < a.rows.length; index += 1) {
    const left = a.rows[index]!;
    const right = b.rows[index]!;
    if (left.id !== right.id || left.isHeader !== right.isHeader) return false;
    if (left.cells.length !== right.cells.length) return false;
    for (let cell = 0; cell < left.cells.length; cell += 1) {
      const x = left.cells[cell]!;
      const y = right.cells[cell]!;
      if (x.id !== y.id || x.gridColumn !== y.gridColumn || x.gridSpan !== y.gridSpan) return false;
      if (x.vMergeContinue !== y.vMergeContinue) return false;
    }
  }
  return true;
}

/** The page occurrence a repeated header row's line ids were stamped with. */
function headerOccurrence(row: TableRowFragmentRecord): string | undefined {
  for (const cell of row.cells)
    for (const block of cell.blocks) {
      if (block.kind !== 'paragraph') continue;
      for (const line of block.lines) {
        const at = line.id.lastIndexOf(':occ:');
        if (at >= 0) return line.id.slice(at + ':occ:'.length);
      }
    }
  return undefined;
}

function sameLineHeights(a: LineRecord, b: LineRecord): boolean {
  return (
    a.box.y === b.box.y &&
    a.box.height === b.box.height &&
    a.baseline === b.baseline &&
    a.leading === b.leading &&
    a.trailingSpacing === b.trailingSpacing &&
    !a.drawings?.length &&
    !b.drawings?.length
  );
}

function sameBlockHeights(a: BlockFragmentRecord, b: BlockFragmentRecord): boolean {
  if (a.kind !== 'paragraph' || b.kind !== 'paragraph') return false;
  if (
    a.paragraphId !== b.paragraphId ||
    a.fragmentIndex !== b.fragmentIndex ||
    a.box.y !== b.box.y ||
    a.box.height !== b.box.height ||
    a.spacing.before !== b.spacing.before ||
    a.spacing.after !== b.spacing.after ||
    a.lines.length !== b.lines.length
  )
    return false;
  for (let index = 0; index < a.lines.length; index += 1)
    if (!sameLineHeights(a.lines[index]!, b.lines[index]!)) return false;
  return true;
}

/**
 * The horizontal rules of a cell, in publication order.
 *
 * Only top, bottom and `between` rules carry occurrence facts: the bottom rule's placement
 * follows the inset the row was finalized with. Side rules run the cell box (compared
 * separately), and whether a cell publishes its leading side rule follows the table's
 * side-rule geometry, which a width change may switch without moving anything vertically.
 */
function horizontalRules(cell: TableCellFragmentRecord): TableBorderStrokeRecord[] {
  const rules: TableBorderStrokeRecord[] = [];
  for (const stroke of cell.borders?.strokes ?? [])
    if (stroke.side !== 'left' && stroke.side !== 'right') rules.push(stroke);
  return rules;
}

function sameStrokeHeights(a: TableCellFragmentRecord, b: TableCellFragmentRecord): boolean {
  const before = horizontalRules(a);
  const after = horizontalRules(b);
  if (before.length !== after.length) return false;
  for (let index = 0; index < before.length; index += 1) {
    const x = before[index]!;
    const y = after[index]!;
    if (x.side !== y.side || x.role !== y.role || x.y !== y.y || x.height !== y.height)
      return false;
  }
  return true;
}

/** Every vertical measurement of a finalized row, plus the facts pagination keyed on. */
function sameRowHeights(a: TableRowFragmentRecord, b: TableRowFragmentRecord): boolean {
  if (
    a.id !== b.id ||
    a.rowIndex !== b.rowIndex ||
    a.isHeaderRow !== b.isHeaderRow ||
    a.isHeaderRepeat !== b.isHeaderRepeat ||
    !!a.isContinuation !== !!b.isContinuation ||
    !!a.hasContinuation !== !!b.hasContinuation ||
    a.box.y !== b.box.y ||
    a.box.height !== b.box.height ||
    a.cells.length !== b.cells.length
  )
    return false;
  for (let index = 0; index < a.cells.length; index += 1) {
    const x = a.cells[index]!;
    const y = b.cells[index]!;
    if (
      x.id !== y.id ||
      x.rowSpan !== y.rowSpan ||
      x.vMergeContinue !== y.vMergeContinue ||
      !!x.paintInert !== !!y.paintInert ||
      x.box.y !== y.box.y ||
      x.box.height !== y.box.height ||
      x.blocks.length !== y.blocks.length ||
      !sameStrokeHeights(x, y)
    )
      return false;
    for (let block = 0; block < x.blocks.length; block += 1)
      if (!sameBlockHeights(x.blocks[block]!, y.blocks[block]!)) return false;
  }
  return true;
}

/** Rows whose cell content changed between the two structures. */
function editedRows(a: SemanticTableStructure, b: SemanticTableStructure): Set<string> {
  const edited = new Set<string>();
  for (let index = 0; index < b.rows.length; index += 1) {
    const before = a.rows[index]!;
    const after = b.rows[index]!;
    if (before === after) continue;
    const changed = after.cells.some((cell, at) => {
      const blocks = before.cells[at]!.blocks;
      return (
        cell.blocks.length !== blocks.length ||
        cell.blocks.some((block, position) => block !== blocks[position])
      );
    });
    if (changed) edited.add(after.id);
  }
  return edited;
}

interface RowPlacement {
  readonly record: TableRowFragmentRecord;
  readonly insets: ReadonlyMap<string, CellContentInsets> | undefined;
  /** Moved from the old finalized row: only its borders are resolved again. */
  readonly moved?: true;
}

/**
 * The paginator's body band for the page at an index of the pages being updated, note
 * reserve included. Without it, no row may grow.
 */
export type TablePageBand = (pageIndex: number) => number;

/**
 * Place every fragment of `after` again at its old row tops under the new column widths.
 * Returns null unless the whole table keeps its vertical geometry on every page, except a
 * last row that grows within `pageBand` (`table-row-growth.ts`).
 */
export function updateTableWidths(
  after: OoxmlElement,
  oldStructure: SemanticTableStructure,
  structure: SemanticTableStructure,
  pages: readonly PageRecord[],
  width: number,
  deps: TableFlowDeps,
  pageBand?: TablePageBand
): TableWidthUpdate | null {
  if (!sameGrid(oldStructure, structure)) return null;
  if (!eligibleStructure(structure, deps) || !eligibleStructure(oldStructure, deps)) return null;
  // Single-column sections only reach this lane, so the column starts at 0.
  const oldLeft = tableOriginX(oldStructure, width);
  const left = tableOriginX(structure, width);
  if (!Number.isFinite(left)) return null;
  const columnWidthsPt = structure.columnWidthsPt;
  const tableWidth = columnWidthsPt.reduce((sum, columnWidth) => sum + columnWidth, 0);
  const sources = new Map<string, SemanticTableRow>();
  const ordinals = new Map<string, number>();
  for (const [index, row] of structure.rows.entries()) {
    sources.set(row.id, row);
    ordinals.set(row.id, index);
  }
  const headers: SemanticTableRow[] = [];
  for (const row of structure.rows) {
    if (!row.isHeader) break;
    headers.push(row);
  }
  const headerMerges = headers.some((row) => row.cells.some((cell) => cell.vMergeContinue));
  // The terminal row's own bottom edge is measured only for tables the paginator probes.
  const terminalRows = !hasTableMerge(structure);
  // Recorded like the full pass records them: every key a placement reports, in order.
  const keys: string[] = [];
  const base: TableFlowDeps = {
    ...withoutAnchorSinks(deps),
    pageExclusionZones: undefined,
    nextLineId: bodyLineId,
    onCellBreakKey: (key) => void keys.push(key),
  };
  const rowProbes = createRowProbeReuse(columnWidthsPt, 0);
  const rowHeightOf = (row: SemanticTableRow, top: number, rowDeps: TableFlowDeps): number =>
    rowProbes.measure(row, left, top, rowDeps);
  const headerPlans = new Map<number, HeaderGroupPlan>();

  const fragments: TableFragment[] = [];
  const pageIndexOf = new Map<TableFragment, number>();
  for (const [pageIndex, page] of pages.entries()) {
    const own = page.fragments.filter(
      (fragment): fragment is TableFragment =>
        fragment.kind === 'table' && fragment.tableId === after.id
    );
    if (own.length === 0) continue;
    // Anchored drawings and floating tables publish wrap bands that can reach any cell.
    if (
      page.anchoredDrawings?.length ||
      page.fragments.some(
        (fragment) =>
          fragment.kind === 'table' && (!!fragment.floatingWrap || isOutOfFlowFragment(fragment))
      )
    )
      return null;
    // Finalize below runs without the pass budgets; a fragment cut by a spent one would differ.
    if (!own.every(finalizedWithHeadroom)) return null;
    for (const fragment of own) pageIndexOf.set(fragment, pageIndex);
    fragments.push(...own);
  }
  if (fragments.length === 0) return null;
  let lineDelta = 0;

  /**
   * The band the fragment's last row may grow into, when the table continues at the top of
   * the next page and the paginator would still move that row's successor there.
   */
  const growthOf = (fragment: TableFragment) => {
    const at = fragments.indexOf(fragment);
    const pageIndex = pageIndexOf.get(fragment)!;
    const next = fragments[at + 1];
    const page = pages[pageIndex]!;
    // The band is addressed by the index the pass filled the page at.
    if (!pageBand || page.index !== pageIndex) return null;
    if (!next || pageIndexOf.get(next) !== pageIndex + 1) return null;
    const band = growthBandOf(page, fragment, next, pageBand(pageIndex));
    const opening = band === null ? null : nextFragmentOpening(next);
    return band === null || !opening ? null : { band, opening };
  };

  const replaceFragment = (fragment: TableFragment): TableFragmentRecord | null => {
    if (fragment.nestingDepth !== 0 || fragment.box.x !== oldLeft) return null;
    const rows = fragment.rows;
    if (rows.length === 0) return null;
    const leadingHeaders = rows.findIndex(
      (row) => !row.isHeaderRow || !sources.get(row.id)?.isHeader
    );
    const headerCount = leadingHeaders < 0 ? rows.length : leadingHeaders;
    // A header group is placed whole; anything else was laid out as body rows.
    if (headerCount !== 0 && headerCount !== headers.length) return null;
    let plan: HeaderGroupPlan | undefined;
    const placed: RowPlacement[] = [];
    let terminal: RowPlacement | undefined;
    const place = (index: number, rowDeps: TableFlowDeps): RowPlacement | null => {
      const old = rows[index]!;
      const source = sources.get(old.id);
      if (!source || old.isContinuation || old.hasContinuation) return null;
      const header = index < headerCount;
      // Most rows only move: same lines, same heights, new x. See table-row-geometry-reuse.ts.
      const moved = header ? null : moveRowToWidths(source, old, columnWidthsPt, left, rowDeps);
      if (moved) return { record: moved, insets: rowDeps.cellContentInsets, moved: true };
      let placementDeps = rowDeps;
      if (old.isHeaderRepeat) {
        const occurrence = headerOccurrence(old);
        if (occurrence === undefined) return null;
        placementDeps = { ...rowDeps, pageOccurrenceKey: () => occurrence };
      }
      if (header && headerMerges && index === 0) {
        // Continuation pages open the group at the same top; its plan is the same.
        plan = headerPlans.get(old.box.y);
        if (!plan) {
          plan = planHeaderGroup(structure, headers, () => left, old.box.y, base, rowHeightOf);
          headerPlans.set(old.box.y, plan);
        }
      }
      const result = layoutRowFragment(
        source,
        columnWidthsPt,
        left,
        old.box.y,
        old.isHeaderRepeat,
        0,
        placementDeps,
        0,
        header ? plan?.optionsAt(index, old.box.y) : undefined
      );
      if (result.remainder !== null) return null;
      return { record: result.record, insets: rowDeps.cellContentInsets };
    };
    const headerDeps =
      headers.length > 0 ? firstRowContentDeps(structure, headers[0]!, base) : base;
    let grown = false;
    for (let index = 0; index < rows.length; index += 1) {
      const old = rows[index]!;
      const source = sources.get(old.id);
      if (!source) return null;
      const rowDeps =
        index < headerCount
          ? headerDeps
          : index === 0
            ? firstRowContentDeps(structure, source, base)
            : base;
      const result = place(index, rowDeps);
      if (!result) return null;
      placed.push(result);
      if (index === rows.length - 1 && terminalRows) {
        const ownEdge = lastRowContentDeps(structure, source, rowDeps);
        if (ownEdge !== rowDeps) {
          terminal = place(index, ownEdge) ?? undefined;
          if (!terminal) return null;
        }
      }
      // Finalize never changes a row box: a different height already decides the outcome.
      if (
        result.record.box.height !== old.box.height &&
        terminal?.record.box.height !== old.box.height
      ) {
        // Only the last row of a fragment may grow; see table-row-growth.ts.
        if (index !== rows.length - 1 || result.moved) return null;
        grown = true;
      }
    }
    if (grown) return growLastRow(fragment, rows, placed);
    // The paginator measures the terminal row with its own bottom edge whenever that probe
    // fits; the vertical comparison tells which placement it kept.
    const candidates = terminal ? [[...placed.slice(0, -1), terminal], placed] : [placed];
    for (const chosen of candidates) {
      const records = chosen.map((entry) => entry.record);
      const insets = new Map<TableRowFragmentRecord, ReadonlyMap<string, CellContentInsets>>();
      const settled = new Set<TableRowFragmentRecord>();
      for (const entry of chosen) {
        if (entry.insets) insets.set(entry.record, entry.insets);
        if (entry.moved) settled.add(entry.record);
      }
      const finalized = finalizeTableRows(
        records,
        structure,
        records.map((record) => sources.get(record.id)!),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        insets,
        settled
      );
      const candidate = annotateTableFragmentGeometry(
        {
          kind: 'table',
          id: fragment.id,
          tableId: fragment.tableId,
          fragmentIndex: fragment.fragmentIndex,
          rows: finalized,
          box: { x: left, y: fragment.box.y, width: tableWidth, height: fragment.box.height },
        },
        columnWidthsPt,
        0,
        ordinals
      );
      if (candidate.rows.every((row, index) => sameRowHeights(rows[index]!, row))) return candidate;
    }
    return null;
  };

  /** Replace a fragment whose last body row grew below every unchanged row above it. */
  const growLastRow = (
    fragment: TableFragment,
    rows: readonly TableRowFragmentRecord[],
    placed: readonly RowPlacement[]
  ): TableFragmentRecord | null => {
    const index = rows.length - 1;
    const old = rows[index]!;
    const before = rows[index - 1];
    const source = sources.get(old.id)!;
    const ordinal = ordinals.get(old.id)!;
    const previousSource = before && sources.get(before.id);
    const nextSource = structure.rows[ordinal + 1];
    const growth = growthOf(fragment);
    const grownRow = placed[index]!.record;
    if (
      !growth ||
      !before ||
      !previousSource ||
      !nextSource ||
      source.isHeader ||
      // The row follows body content on its page, so the paginator places it mid-page.
      before.isHeaderRow ||
      before.isHeaderRepeat ||
      growth.opening.id !== nextSource.id ||
      grownRow.box.height <= old.box.height ||
      grownRow.box.y + grownRow.box.height > growth.band + 0.001 ||
      !rowGrowthKeepsNothing(source, previousSource, deps) ||
      !nextRowMovesAt(
        structure,
        nextSource,
        left,
        grownRow.box.y + grownRow.box.height,
        growth.band,
        base,
        rowHeightOf
      )
    )
      return null;
    const closed = closeGrownRow(
      structure,
      source,
      grownRow,
      placed[index]!.insets,
      left,
      growth.band,
      base
    );
    const chosen: RowPlacement[] = [...placed.slice(0, index), closed];
    const records = chosen.map((entry) => entry.record);
    const insets = new Map<TableRowFragmentRecord, ReadonlyMap<string, CellContentInsets>>();
    const settled = new Set<TableRowFragmentRecord>();
    for (const entry of chosen) {
      if (entry.insets) insets.set(entry.record, entry.insets);
      if (entry.moved) settled.add(entry.record);
    }
    const finalized = finalizeTableRows(
      records,
      structure,
      records.map((record) => sources.get(record.id)!),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      insets,
      settled
    );
    const last = finalized[index]!;
    const candidate = annotateTableFragmentGeometry(
      {
        kind: 'table',
        id: fragment.id,
        tableId: fragment.tableId,
        fragmentIndex: fragment.fragmentIndex,
        rows: finalized,
        box: {
          x: left,
          y: fragment.box.y,
          width: tableWidth,
          height: last.box.y + last.box.height - fragment.box.y,
        },
      },
      columnWidthsPt,
      0,
      ordinals
    );
    const grownLast = candidate.rows[index]!;
    if (
      !candidate.rows.every((row, at) => at === index || sameRowHeights(rows[at]!, row)) ||
      !sameRowMembership(old, grownLast) ||
      grownLast.box.y + grownLast.box.height > growth.band + 0.001
    )
      return null;
    lineDelta += rowLineCount(grownLast) - rowLineCount(old);
    return candidate;
  };

  // The edited rows decide most refusals, so their fragments go first.
  const edited = editedRows(oldStructure, structure);
  const order = [
    ...fragments.filter((fragment) => fragment.rows.some((row) => edited.has(row.id))),
    ...fragments.filter((fragment) => !fragment.rows.some((row) => edited.has(row.id))),
  ];
  const replacements = new Map<BlockFragmentRecord, BlockFragmentRecord>();
  for (const fragment of order) {
    const replacement = replaceFragment(fragment);
    if (!replacement) return null;
    replacements.set(fragment, withBudgetProof(replacement, true));
  }
  registerTableCellBreakKeys(after, keys);
  return {
    // sameRowHeights rejects changed block heights, line counts, and vertical positions,
    // except in a grown last row, which keeps its paragraphs on its page. Each replacement
    // keeps the original rows on their original page fragments.
    paragraphPagesUnchanged: true,
    lineDelta,
    pages: pages.map((page) =>
      page.fragments.some((fragment) => replacements.has(fragment))
        ? { ...page, fragments: page.fragments.map((f) => replacements.get(f) ?? f) }
        : page
    ),
    replacements,
  };
}
