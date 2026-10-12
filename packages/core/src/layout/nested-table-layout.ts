import { firstRowContentDeps } from './table-fragment-content-insets.ts';
import { autofitContextOf } from './table-autofit-widths.ts';
import type { CellContentInsets } from './table-cell-geometry.ts';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { MAX_TABLE_NESTING, readTableStructure, tableOriginX } from './semantic-table.ts';
import { stripAnchorSinksForProbe } from './table-probe-deps.ts';
import {
  layoutOnePassRow,
  layoutRowFragmentBounded,
  measureRowHeight,
  type CellPlaceCursor,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import { vMergePlanFor } from './table-vmerge-plan.ts';
import { publishDeferredRowAnchors, type DeferredRowAnchor } from './table-anchor-republish.ts';
import { acceptVMergeSpansAt } from './table-vmerge-heights.ts';
import { finalizeTableRows, splitHead } from './table-fragment-finalize.ts';
import { annotateTableFragmentGeometry } from './semantic-table-interaction.ts';
import type { TableFragmentRecord, TableRowFragmentRecord } from './semantic-records.ts';
import type { SemanticTableRow } from './semantic-table.ts';
import { initialCellCursors, type NestedTableCursor } from './table-cell-cursor.ts';
import { closingCellSpacingPt } from './table-cell-spacing.ts';

/**
 * A nested table inside a cell. Ordinary rows continue at row boundaries, and a row that does
 * not fit the band splits inside its cells as a top-level row does. Repeated headers and
 * vertical merges keep the table whole while a page can hold it; on a fresh band that cannot,
 * the table splits like an ordinary one. Returns null for an empty table or past the nesting
 * ceiling.
 *
 * `freshBand`: nothing precedes the table on this page, so moving it gains no room.
 */
export function emitNestedTable(
  table: OoxmlElement,
  left: number,
  right: number,
  top: number,
  depth: number,
  deps: TableFlowDeps,
  maxBottom = Number.POSITIVE_INFINITY,
  continuation?: NestedTableCursor,
  freshBand = false
): {
  readonly fragment: TableFragmentRecord | null;
  readonly bottom: number;
  readonly remainder?: NestedTableCursor;
} | null {
  if (depth >= MAX_TABLE_NESTING) return null;
  const containerWidth = Math.max(1, right - left);
  const structure = readTableStructure(
    table,
    containerWidth,
    depth - (deps.tableNestingOffset ?? 0),
    deps.styleCascade,
    deps.displayMode,
    deps.revisionAuthorFilter,
    deps.compatibilityMode,
    autofitContextOf(deps),
    deps.textBoxStory === true && depth === (deps.tableNestingOffset ?? 0)
  );
  if (!structure || structure.rows.length === 0) return null;
  const startRowIndex = continuation?.nextRowIndex ?? 0;
  const fragmentIndex = continuation?.fragmentIndex ?? 0;
  const bounded = Number.isFinite(maxBottom);
  // A continuation exists only because the table already split, so it is never atomic.
  const keepsWhole =
    !continuation &&
    structure.rows.some((row) => row.isHeader || row.cells.some((cell) => cell.vMergeContinue));
  let probeLineId = 0;
  const probeDeps: TableFlowDeps = {
    ...stripAnchorSinksForProbe(deps),
    cache: undefined,
    borderOwnershipBudget: undefined,
    vMergeResolveBudget: undefined,
    onCellBreakKey: undefined,
    nextLineId: () => `probe-nested-${probeLineId++}`,
  };
  const nestedDeferred: DeferredRowAnchor[] = [];
  const nestedFlowDeps: TableFlowDeps = {
    ...deps,
    publishAnchoredDrawings: undefined,
    collectAnchoredDrawings: undefined,
    anchorDeferOnly: true,
    // Only the split below knows whether a nested row opens a fresh band.
    rowAtPageStart: false,
    deferAnchoredDrawings: (pending) => {
      nestedDeferred.push(pending);
    },
  };
  // A nested table is placed inside its CELL's content box by the same rules a top-level one
  // is placed inside the text column.
  const tableLeft = left + tableOriginX(structure, containerWidth);
  const rawRows: TableRowFragmentRecord[] = [];
  const sourceRows: SemanticTableRow[] = [];
  const occurrenceInsets = new Map<
    TableRowFragmentRecord,
    ReadonlyMap<string, CellContentInsets>
  >();
  let y = top;
  let nextRowIndex = startRowIndex;
  let rowCursors: readonly CellPlaceCursor[] | undefined;
  const layRows = (atomic: boolean): void => {
    rawRows.length = 0;
    sourceRows.length = 0;
    occurrenceInsets.clear();
    nestedDeferred.length = 0;
    y = top;
    nextRowIndex = startRowIndex;
    rowCursors = undefined;
    // Accepted spans are state; a second attempt starts from a fresh plan.
    const vMergePlan = vMergePlanFor(
      structure,
      tableLeft,
      depth,
      nestedFlowDeps,
      undefined,
      (row) => row.id === structure.rows[startRowIndex]?.id
    );
    for (let rowIndex = startRowIndex; rowIndex < structure.rows.length; rowIndex++) {
      const row = structure.rows[rowIndex]!;
      const rowDeps =
        rowIndex === startRowIndex
          ? firstRowContentDeps(structure, row, nestedFlowDeps)
          : nestedFlowDeps;
      const rowProbeDeps =
        rowIndex === startRowIndex ? firstRowContentDeps(structure, row, probeDeps) : probeDeps;
      const continued = rowIndex === startRowIndex ? continuation?.rowCursors : undefined;
      if (bounded && !atomic) {
        const height = continued
          ? Number.POSITIVE_INFINITY
          : measureRowHeight(
              row,
              structure.columnWidthsPt,
              tableLeft,
              depth,
              rowProbeDeps,
              structure.cellSpacingPt,
              undefined,
              y
            );
        if (y + height > maxBottom + 0.001) {
          // `w:cantSplit` moves the row once; a band that cannot gain room splits it anyway.
          if (row.cantSplit && !continued && (rawRows.length > 0 || !freshBand)) break;
          const deferredBefore = nestedDeferred.length;
          const placed = layoutRowFragmentBounded(
            row,
            structure.columnWidthsPt,
            tableLeft,
            y,
            maxBottom,
            false,
            continued !== undefined,
            depth,
            { ...rowDeps, rowAtPageStart: freshBand && rawRows.length === 0 },
            continued ?? initialCellCursors(row),
            structure.cellSpacingPt
          );
          if (!placed.fitted || placed.bottom > maxBottom + 0.001) {
            nestedDeferred.length = deferredBefore;
            break;
          }
          const hasMore = placed.remainder !== null;
          const record = hasMore ? splitHead(placed.record) : placed.record;
          rawRows.push(record);
          // A partial occurrence is its own source row, so finalize does not remeasure all of it.
          sourceRows.push(continued || hasMore ? { ...row } : row);
          if (rowDeps.cellContentInsets) occurrenceInsets.set(record, rowDeps.cellContentInsets);
          y = placed.bottom;
          if (hasMore) {
            nextRowIndex = rowIndex;
            rowCursors = placed.remainder!;
            break;
          }
          nextRowIndex = rowIndex + 1;
          continue;
        }
      }
      // Anchors this row defers are taken back if its placement is discarded, so a retry
      // cannot publish a drawing twice.
      const deferredBefore = nestedDeferred.length;
      const placed = layoutOnePassRow(
        row,
        structure,
        tableLeft,
        y,
        depth,
        rowDeps,
        false,
        acceptVMergeSpansAt(vMergePlan, rowIndex, y),
        () => {
          nestedDeferred.length = deferredBefore;
          vMergePlan?.withdrawAt(rowIndex);
          return vMergePlan?.rowOptions(rowIndex);
        }
      );
      rawRows.push(placed.record);
      sourceRows.push(row);
      if (rowDeps.cellContentInsets) occurrenceInsets.set(placed.record, rowDeps.cellContentInsets);
      y = placed.bottom;
      nextRowIndex = rowIndex + 1;
    }
  };
  layRows(keepsWhole);
  if (keepsWhole && bounded && freshBand && y > maxBottom + 0.001) layRows(false);
  if (rawRows.length === 0 || y > maxBottom + 0.001) return { fragment: null, bottom: top };
  if (nextRowIndex >= structure.rows.length)
    y = Math.min(y + closingCellSpacingPt(structure), Math.max(y, maxBottom));
  const rows = finalizeTableRows(
    rawRows,
    structure,
    sourceRows,
    deps.borderOwnershipBudget,
    deps.vMergeResolveBudget,
    undefined,
    undefined,
    undefined,
    occurrenceInsets
  );
  for (const pending of nestedDeferred) {
    for (const row of rows) {
      const hostsParagraph = row.cells.some((cell) =>
        cell.blocks.some(
          (block) => block.kind === 'paragraph' && block.paragraphId === pending.paragraphId
        )
      );
      if (!hostsParagraph) continue;
      publishDeferredRowAnchors([pending], row.cells, row.box.y, row.box.height, deps);
      break;
    }
  }
  const width = structure.columnWidthsPt.reduce((sum, column) => sum + column, 0);
  const rowOrdinals = new Map(structure.rows.map((row, index) => [row.id, index]));
  return {
    ...(nextRowIndex < structure.rows.length
      ? {
          remainder: {
            nextRowIndex,
            fragmentIndex: fragmentIndex + 1,
            ...(rowCursors ? { rowCursors } : {}),
          },
        }
      : {}),
    fragment: annotateTableFragmentGeometry(
      {
        kind: 'table',
        id: `${table.id}#f${fragmentIndex}`,
        tableId: table.id,
        fragmentIndex,
        rows,
        box: { x: tableLeft, y: top, width, height: y - top },
      },
      structure.columnWidthsPt,
      depth,
      rowOrdinals
    ),
    bottom: y,
  };
}
