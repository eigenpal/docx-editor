import { firstRowContentDeps } from './table-fragment-content-insets.ts';
import type { CellContentInsets } from './table-cell-geometry.ts';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { MAX_TABLE_NESTING, readTableStructure, tableOriginX } from './semantic-table.ts';
import { stripAnchorSinksForProbe } from './table-probe-deps.ts';
import {
  layoutOnePassRow,
  measureRowHeight,
  vMergePlanFor,
  type CellPlaceCursor,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import { publishDeferredRowAnchors, type DeferredRowAnchor } from './table-anchor-republish.ts';
import { acceptVMergeSpansAt } from './table-vmerge-heights.ts';
import { finalizeTableRows } from './table-fragment-finalize.ts';
import { annotateTableFragmentGeometry } from './semantic-table-interaction.ts';
import type { TableFragmentRecord, TableRowFragmentRecord } from './semantic-records.ts';

/**
 * A nested table inside a cell. Ordinary rows may continue at row boundaries; repeated
 * headers and vertical merges remain atomic until their continuation state is represented.
 * Returns null for an empty table or past the nesting ceiling.
 */
export function emitNestedTable(
  table: OoxmlElement,
  left: number,
  right: number,
  top: number,
  depth: number,
  deps: TableFlowDeps,
  maxBottom = Number.POSITIVE_INFINITY,
  continuation?: CellPlaceCursor['nestedTable']
): {
  readonly fragment: TableFragmentRecord | null;
  readonly bottom: number;
  readonly remainder?: CellPlaceCursor['nestedTable'];
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
    deps.compatibilityMode
  );
  if (!structure || structure.rows.length === 0) return null;
  const startRowIndex = continuation?.nextRowIndex ?? 0;
  const fragmentIndex = continuation?.fragmentIndex ?? 0;
  const bounded = Number.isFinite(maxBottom);
  const atomic = structure.rows.some(
    (row) => row.isHeader || row.cells.some((cell) => cell.vMergeContinue)
  );
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
    deferAnchoredDrawings: (pending) => {
      nestedDeferred.push(pending);
    },
  };
  // A nested table is placed inside its CELL's content box by the same rules a top-level one
  // is placed inside the text column.
  const tableLeft = left + tableOriginX(structure, containerWidth);
  const vMergePlan = vMergePlanFor(
    structure,
    tableLeft,
    depth,
    nestedFlowDeps,
    undefined,
    (row) => row.id === structure.rows[startRowIndex]?.id
  );
  const rawRows: TableRowFragmentRecord[] = [];
  const occurrenceInsets = new Map<
    TableRowFragmentRecord,
    ReadonlyMap<string, CellContentInsets>
  >();
  let y = top;
  let nextRowIndex = startRowIndex;
  for (let rowIndex = startRowIndex; rowIndex < structure.rows.length; rowIndex++) {
    const row = structure.rows[rowIndex]!;
    const rowDeps =
      rowIndex === startRowIndex
        ? firstRowContentDeps(structure, row, nestedFlowDeps)
        : nestedFlowDeps;
    const rowProbeDeps =
      rowIndex === startRowIndex ? firstRowContentDeps(structure, row, probeDeps) : probeDeps;
    if (bounded && !atomic) {
      const height = measureRowHeight(
        row,
        structure.columnWidthsPt,
        tableLeft,
        depth,
        rowProbeDeps,
        structure.cellSpacingPt,
        undefined,
        y
      );
      if (y + height > maxBottom + 0.001) break;
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
      }
    );
    rawRows.push(placed.record);
    if (rowDeps.cellContentInsets) occurrenceInsets.set(placed.record, rowDeps.cellContentInsets);
    y = placed.bottom;
    nextRowIndex = rowIndex + 1;
  }
  if (rawRows.length === 0 || y > maxBottom + 0.001) return { fragment: null, bottom: top };
  const rows = finalizeTableRows(
    rawRows,
    structure,
    structure.rows.slice(startRowIndex, nextRowIndex),
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
      ? { remainder: { nextRowIndex, fragmentIndex: fragmentIndex + 1 } }
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
