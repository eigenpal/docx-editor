// Reusing an earlier placement of an unchanged row inside the full table pagination.
//
// When a table edit cannot keep the old pagination (a row really changed height), the table
// is paginated again from its first row. Most rows still land where they stood: every row
// before the change, and every row of a page the change no longer reaches. Such a row, at the
// same top with the same vertical inputs, has the same vertical geometry as before; only its
// x geometry follows the new column widths. `moveRowToWidths` rebuilds exactly that, with the
// line identity proof of `table-row-geometry-reuse.ts`.
//
// What decides a row's vertical geometry, apart from its cells' lines, is recorded when the
// row probe places it: the top, the per-cell content insets (top and bottom), the row-minimum
// insets, vertical alignment, the authored row height, and the probe's own bottom, height and
// `fitted`. The record is keyed by the first cell paragraph's `range` object, which survives
// finalize, annotation and moves, so it dies with the fragments that share it. A row whose
// final height differs from its probe (the terminal-row correction) is never reused.
//
// A row the change moved down or up keeps everything but its top. `moveRowToTop` rebuilds it
// as a fresh placement at the new top computes it, for the row shapes it covers; such a row is
// not settled, so finalize runs on it exactly as on that fresh placement.
//
// The previous rows of a table are offered by the session only when its table update refused,
// and the paginator takes them once.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { sharedCellContentInsets } from './cell-content-insets-memo.ts';
import {
  moveRowToTop,
  moveRowToWidths,
  noteShiftedRowRefusal,
} from './table-row-geometry-reuse.ts';
import { finalizedWithHeadroom } from './table-budget-proof.ts';
import type { LayoutRowBoundedResult, TableFlowDeps } from './semantic-table-layout.ts';
import type { SemanticTableRow } from './semantic-table.ts';
import type { SectionPrepass } from './section-prepass-types.ts';
import type {
  BlockFragmentRecord,
  PageRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from './semantic-records.ts';

interface RowPlacement {
  readonly top: number;
  readonly bottom: number;
  readonly height: number;
  readonly fitted: boolean;
  /** Per cell: insets top and bottom, minimum insets top and bottom, vertical alignment. */
  readonly vertical: readonly (number | string)[];
  readonly heightRule: SemanticTableRow['height'];
}

const placements = new WeakMap<object, RowPlacement>();

/** Everything outside a cell's lines that sets its vertical geometry, for `deps` at this row. */
function verticalInputs(row: SemanticTableRow, deps: TableFlowDeps): (number | string)[] {
  const values: (number | string)[] = [];
  for (const cell of row.cells) {
    const insets = deps.cellContentInsets?.get(cell.id) ?? sharedCellContentInsets(cell, true);
    const minimum = deps.cellMinimumContentInsets?.get(cell.id) ?? cell.minimumContentInsets;
    values.push(
      insets.top,
      insets.bottom,
      minimum?.top ?? Number.NaN,
      minimum?.bottom ?? Number.NaN,
      cell.vAlign
    );
  }
  return values;
}

function sameMinimum(value: number | undefined, previous: number | string | undefined): boolean {
  const current = value ?? Number.NaN;
  return current === previous || (Number.isNaN(current) && Number.isNaN(previous));
}

function sameVertical(
  row: SemanticTableRow,
  deps: TableFlowDeps,
  known: readonly (number | string)[]
): boolean {
  if (known.length !== row.cells.length * 5) return false;
  let index = 0;
  for (const cell of row.cells) {
    const insets = deps.cellContentInsets?.get(cell.id) ?? sharedCellContentInsets(cell, true);
    const minimum = deps.cellMinimumContentInsets?.get(cell.id) ?? cell.minimumContentInsets;
    if (
      known[index++] !== insets.top ||
      known[index++] !== insets.bottom ||
      !sameMinimum(minimum?.top, known[index++]) ||
      !sameMinimum(minimum?.bottom, known[index++]) ||
      known[index++] !== cell.vAlign
    )
      return false;
  }
  return true;
}

const keyOf = (record: TableRowFragmentRecord): object | undefined => {
  const block = record.cells[0]?.blocks[0];
  return block?.kind === 'paragraph' && record.cells.length > 0 ? block.range : undefined;
};

/** Record a complete row probe placed at `top` (cell spacing 0, no wrap zones). */
export function rememberRowPlacement(
  row: SemanticTableRow,
  result: LayoutRowBoundedResult,
  top: number,
  deps: TableFlowDeps
): void {
  const key = result.remainder === null ? keyOf(result.record) : undefined;
  if (!key) return;
  placements.set(key, {
    top,
    bottom: result.bottom,
    height: result.record.box.height,
    fitted: result.fitted,
    vertical: verticalInputs(row, deps),
    heightRule: row.height,
  });
}

const settledPreviousRows = new WeakSet<TableRowFragmentRecord>();

/**
 * A previous finalized row moved without changing its vertical placement.
 * The ordinary-paragraph proof excludes drawings, so finalization has no anchors to republish.
 */
export function isSettledPreviousRow(row: TableRowFragmentRecord): boolean {
  return settledPreviousRows.has(row);
}

/**
 * The probe result a fresh placement of `row` at `top` would give, rebuilt from its previous
 * finalized row; null when anything vertical or any cell line could differ.
 */
export function placementFromPrevious(
  row: SemanticTableRow,
  previous: TableRowFragmentRecord,
  cols: readonly number[],
  left: number,
  top: number,
  deps: TableFlowDeps
): LayoutRowBoundedResult | null {
  const key = keyOf(previous);
  const known = key ? placements.get(key) : undefined;
  if (
    !known ||
    previous.box.y !== known.top ||
    previous.box.height !== known.height ||
    row.height.rule !== known.heightRule.rule ||
    (row.height.rule !== 'auto' &&
      (known.heightRule.rule === 'auto' || row.height.valuePt !== known.heightRule.valuePt)) ||
    !sameVertical(row, deps, known.vertical)
  )
    return previous.box.y === top ? null : noteShiftedRowRefusal('record');
  if (known.top !== top) {
    // The row moved down or up: rebuilt as a fresh placement at `top` gives it. It is not
    // settled, so finalize treats it exactly as it treats that fresh placement.
    const shifted = moveRowToTop(row, previous, cols, left, top, deps);
    if (!shifted) return null;
    return {
      record: shifted.record,
      bottom: shifted.bottom,
      remainder: null,
      fitted: known.fitted,
      nestedSplitBlocked: false,
    };
  }
  const record = moveRowToWidths(row, previous, cols, left, deps);
  if (!record) return null;
  settledPreviousRows.add(record);
  return {
    record,
    bottom: known.bottom,
    remainder: null,
    fitted: known.fitted,
    nestedSplitBlocked: false,
  };
}

// A cancelled or alternate flow may not consume its offer. Undo history can keep the table
// node alive, so the offer must not keep its previous row geometry alive with it.
const offered = new WeakMap<OoxmlElement, WeakRef<ReadonlyMap<string, TableRowFragmentRecord>>>();

/**
 * Offer the previous layout's complete rows of `table` to its next pagination. Rows that
 * appear more than once (split or repeated) are left out; so is a table whose fragments were
 * finalized after a pass budget ran out.
 */
export function offerPreviousRows(table: OoxmlElement, pages: readonly PageRecord[]): void {
  const rows = previousRowsOf(table, pages);
  if (rows) offered.set(table, new WeakRef(rows));
}

function previousRowsOf(
  table: OoxmlElement,
  pages: readonly PageRecord[]
): ReadonlyMap<string, TableRowFragmentRecord> | undefined {
  const rows = new Map<string, TableRowFragmentRecord>();
  const repeated = new Set<string>();
  for (const page of pages)
    for (const fragment of page.fragments as readonly BlockFragmentRecord[]) {
      if (fragment.kind !== 'table' || fragment.tableId !== table.id) continue;
      if (!finalizedWithHeadroom(fragment as TableFragmentRecord)) return;
      for (const record of fragment.rows) {
        if (record.isHeaderRepeat || record.isContinuation || record.hasContinuation) {
          repeated.add(record.id);
          continue;
        }
        if (rows.has(record.id)) repeated.add(record.id);
        else rows.set(record.id, record);
      }
    }
  for (const id of repeated) rows.delete(id);
  return rows.size > 0 ? rows : undefined;
}

// Scoped to the current pass, never to a table node shared by separate editor sessions.
// Keep only a weak reference to old pages: retained flow dependencies must not retain history.
const unchangedTables = new WeakMap<
  TableFlowDeps,
  { tables: ReadonlySet<OoxmlElement>; pages: WeakRef<readonly PageRecord[]> }
>();

/**
 * Paragraph insertion or deletion before a table can move its rows without editing them.
 * The caller proves identical section inputs. Match the source node and prepared key too;
 * collect row records only if this pass actually paginates that unchanged table.
 */
export function offerUnchangedTableRows(
  deps: TableFlowDeps,
  previous: SectionPrepass,
  next: SectionPrepass,
  pages: readonly PageRecord[]
): void {
  const oldKeys = new Map<OoxmlElement, string>();
  for (const entry of previous.prepared)
    if (entry.kind === 'table') oldKeys.set(entry.table, entry.key);
  const tables = new Set<OoxmlElement>();
  for (const entry of next.prepared)
    if (entry.kind === 'table' && oldKeys.get(entry.table) === entry.key) tables.add(entry.table);
  if (tables.size > 0) unchangedTables.set(deps, { tables, pages: new WeakRef(pages) });
}

/** The rows offered for `table`, once. */
export function takePreviousRows(
  table: OoxmlElement,
  deps?: TableFlowDeps
): ReadonlyMap<string, TableRowFragmentRecord> | undefined {
  const rows = offered.get(table)?.deref();
  offered.delete(table);
  if (rows) return rows;
  const unchanged = deps ? unchangedTables.get(deps) : undefined;
  const pages = unchanged?.tables.has(table) ? unchanged.pages.deref() : undefined;
  return pages ? previousRowsOf(table, pages) : undefined;
}
