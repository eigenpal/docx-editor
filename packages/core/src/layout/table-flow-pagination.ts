// Placing ONE top-level table into the body flow, row by row, across page breaks.
//
// Lifted out of the story loop because it is the one block kind whose placement is a loop of
// its own: a table advances the same cursor a paragraph does, but it decides per ROW whether
// to place, move, split or fail, and it re-emits repeated header rows on every page it runs
// onto. Keeping that beside paragraph fragmentation buried both.
//
// The flow it advances arrives as {@link TableFlowCursor}: the cursor itself, the geometry
// getters that answer where the column is and how much page is left, and the sinks a placed
// row publishes into. Everything the paginator needs to mutate is on that object, so the
// story loop keeps ownership of the cursor and this module keeps the row rules.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import {
  finalizeTableRows,
  initialCellCursors,
  layoutRowFragment,
  layoutRowFragmentBounded,
  measureRowHeight,
  MAX_TABLE_ROW_FRAGMENTS,
  rowWithSplitBorders,
  TablePaginationError,
  vMergePlanFor,
  type CellPlaceCursor,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import { admitVMergeSpansAt, type RowVMergeLayoutOptions } from './table-vmerge-heights.ts';
import { annotateTableFragmentGeometry } from './semantic-table-interaction.ts';
import {
  readTableStructure,
  tableFloatOriginX,
  tableOriginX,
  type SemanticTableRow,
  type TableAnchorFrames,
} from './semantic-table.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import type { RevisionDisplayMode } from './revision-projection.ts';
import type { BlockFragmentRecord, TableRowFragmentRecord } from './semantic-records.ts';

/** The body flow a table is placed into: the cursor it moves, and what it publishes to. */
export interface TableFlowCursor {
  /** Points down the page content box. The paginator both reads and advances it. */
  cursorY: number;
  /** Width of the column being filled. */
  readonly columnWidth: () => number;
  /** Left edge of the column being filled, in page-content coordinates. */
  readonly columnLeft: () => number;
  /** Height available on the page being filled — note reserves already subtracted. */
  readonly contentHeight: () => number;
  /** Move to the next column, or the next page when this was the last one. */
  readonly advanceColumn: () => void;
  /** Frames a `w:tblpPr` table positions against. */
  readonly anchorFrames: () => TableAnchorFrames;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly displayMode: RevisionDisplayMode;
  readonly deps: TableFlowDeps;
  /**
   * Moves an anchored drawing already published by a placed row, when finalize shifts the
   * paragraph it belongs to. A callback for the same reason `publishFragment` is one: the
   * list it edits is replaced whenever a page completes.
   */
  readonly shiftAnchor: (paragraphId: string, dy: number) => void;
  /**
   * Publishes a finished table fragment onto the page being filled.
   *
   * A sink rather than the array itself: completing a page REPLACES the story loop's
   * fragment list, so a reference taken when the table started would collect the rest of
   * its fragments into an array nobody reads.
   */
  readonly publishFragment: (fragment: BlockFragmentRecord) => void;
}

/**
 * Lay out one top-level table with OOXML-aligned row pagination.
 *
 * Preflights the real unsplit row height (not a one-line estimate). A row that fits on a
 * fresh page but not the current remainder moves whole. A row taller than a fresh page
 * fragments at paragraph/line boundaries when splittable; `w:cantSplit` and unsafe nested
 * cuts fail closed via {@link TablePaginationError} instead of overflowing contentHeight().
 * Contiguous leading `w:tblHeader` rows form one atomic repeated group: preflighted and
 * placed together, moved whole when the remainder is too short, re-emitted complete atop
 * each continuation page, and rejected when the group itself exceeds a fresh content page.
 */
export function paginateTableInFlow(table: OoxmlElement, flow: TableFlowCursor): void {
  const {
    columnWidth,
    columnLeft,
    contentHeight,
    advanceColumn,
    anchorFrames,
    styleCascade,
    displayMode,
    deps: tableDeps,
    shiftAnchor,
    publishFragment,
  } = flow;
  const regionWidth = columnWidth();
  const structure = readTableStructure(table, regionWidth, 0, styleCascade, displayMode);
  if (!structure || structure.rows.length === 0) return;
  // `w:tblInd` / `w:jc` place the table inside the text column, `w:tblpPr` against a wider
  // anchor box; every row and the fragment box share the one origin so cell geometry and
  // the reported box cannot drift apart.
  const tableWidthPt = structure.columnWidthsPt.reduce((sum, column) => sum + column, 0);
  const originX = (): number =>
    structure.float
      ? tableFloatOriginX(structure.float, tableWidthPt, anchorFrames())
      : columnLeft() + tableOriginX(structure, columnWidth());
  let tableLeft = originX();
  // `w:tblpY` against the text anchor is an offset from where the table would otherwise
  // sit, so it moves the table within the flow. The page and margin anchors state an
  // absolute position on the sheet, which this layout does not model — those stay in flow.
  if (structure.float && structure.float.vertAnchor === 'text' && !structure.float.ySpec) {
    flow.cursorY = Math.max(0, Math.min(flow.cursorY + structure.float.yPt, contentHeight()));
  }
  /** One row's natural height where the table stands now. `tableLeft` moves; this reads it. */
  const rowHeightOf = (probeRow: SemanticTableRow): number =>
    measureRowHeight(
      probeRow,
      structure.columnWidthsPt,
      tableLeft,
      0,
      tableDeps,
      structure.cellSpacingPt
    );
  const headerRows: SemanticTableRow[] = [];
  for (const row of structure.rows) {
    if (row.isHeader) headerRows.push(row);
    else break;
  }
  let fragmentIndex = 0;
  let fragmentTop = flow.cursorY;
  let rows: TableRowFragmentRecord[] = [];
  const rowOrdinals = new Map<string, number>();
  // Authored rows backing the open fragment (includes header repeats) for finalize.
  let sourceRows: (typeof structure.rows)[number][] = [];
  const closeTableFragment = (): void => {
    if (rows.length === 0) return;
    const finalized = finalizeTableRows(
      rows,
      structure,
      sourceRows,
      tableDeps.borderOwnershipBudget,
      tableDeps.vMergeResolveBudget,
      undefined,
      shiftAnchor,
      tableDeps
    );
    const last = finalized[finalized.length - 1]!;
    publishFragment(
      annotateTableFragmentGeometry(
        {
          kind: 'table',
          id: `${table.id}#f${fragmentIndex}`,
          tableId: table.id,
          fragmentIndex,
          rows: finalized,
          box: {
            x: tableLeft,
            y: fragmentTop,
            width: structure.columnWidthsPt.reduce((sum, columnWidth) => sum + columnWidth, 0),
            height: last.box.y + last.box.height - fragmentTop,
          },
        },
        structure.columnWidthsPt,
        0,
        rowOrdinals
      )
    );
    fragmentIndex += 1;
    rows = [];
    sourceRows = [];
  };

  /**
   * Place the contiguous leading header rows as one group. Never splits the group across
   * pages; fails closed when the group itself is taller than a fresh content page.
   */
  const placeHeaderGroup = (asRepeat: boolean): void => {
    if (headerRows.length === 0) return;

    let groupHeight = 0;
    for (const headerRow of headerRows) {
      groupHeight += rowHeightOf(headerRow);
    }
    if (groupHeight > contentHeight() + 0.001) {
      throw new TablePaginationError(
        'table-row-overheight',
        `Table header group (${headerRows.length} row(s)) is taller than the page content box`
      );
    }
    if (flow.cursorY + groupHeight > contentHeight() + 0.001 && flow.cursorY > 0) {
      closeTableFragment();
      advanceColumn();
      tableLeft = originX();
      // The cursor, not 0: a same-sheet column advance opens at the column REGION top
      // (a continuous section shares its sheet), and a fragment box anchored at 0 would
      // stretch over whatever the earlier section already painted above the region.
      fragmentTop = flow.cursorY;
    }

    for (const headerRow of headerRows) {
      const placed = layoutRowFragment(
        headerRow,
        structure.columnWidthsPt,
        tableLeft,
        flow.cursorY,
        asRepeat,
        0,
        tableDeps,
        structure.cellSpacingPt
      );
      if (placed.bottom > contentHeight() + 0.001) {
        throw new TablePaginationError(
          'table-row-overheight',
          `Table header row ${headerRow.id} overflowed the page content box`
        );
      }
      rows.push(placed.record);
      sourceRows.push(headerRow);
      flow.cursorY = placed.bottom;
    }
  };

  const breakForContinuation = (emitHeaders: boolean): void => {
    closeTableFragment();
    advanceColumn();
    tableLeft = originX();
    // See placeHeaderGroup: the new fragment opens at the advanced cursor, which is the
    // column region top on a shared sheet and 0 only when a fresh page was opened.
    fragmentTop = flow.cursorY;
    if (emitHeaders) placeHeaderGroup(true);
  };

  // Initial authored header group (not repeats) — atomic with body-row pagination below.
  placeHeaderGroup(false);

  // `w:vMerge` heights, planned over the BODY rows: a merged cell is as tall as the rows
  // it covers, so its own row must not swallow the whole merged height.
  const bodyRows = structure.rows.slice(headerRows.length);
  // `tableLeft` is read through a getter, not captured: `placeHeaderGroup` and
  // `breakForContinuation` both re-derive it, and a positioned probe localizes wrap bands
  // against it — a stale left measures the head against a band that does not cross it.
  const vMergePlan = vMergePlanFor(structure, () => tableLeft, 0, tableDeps, bodyRows);
  let vMerge: RowVMergeLayoutOptions | undefined;
  let naturalHeight = 0;
  const admitSpans = (bodyRowIndex: number, probeRow?: SemanticTableRow): void => {
    vMerge = admitVMergeSpansAt(vMergePlan, bodyRowIndex, flow.cursorY, contentHeight());
    naturalHeight = vMerge?.heightFloorPt ?? (probeRow ? rowHeightOf(probeRow) : naturalHeight);
  };

  for (const [bodyRowIndex, row] of bodyRows.entries()) {
    admitSpans(bodyRowIndex, row);
    let cursors: CellPlaceCursor[] = initialCellCursors(row);
    let isContinuation = false;
    let fragmentsForRow = 0;
    let movedToFreshPage = false;

    // A row an accepted span covers does not take the whole-row MOVE: alone among the
    // breaks below, that one is an optimization rather than a recovery, and it ends the
    // fragment above merged content already flowed against this page. See the break-site
    // table in `table-vmerge-heights.ts` for why the others stay open to a covered row.
    const heldByOpenSpan =
      vMerge !== undefined && vMerge.detachedSpanHeightPtByCellId === undefined;

    // Whole-row move: fits a fresh page but not the remaining band.
    if (
      !heldByOpenSpan &&
      naturalHeight <= contentHeight() + 0.001 &&
      flow.cursorY + naturalHeight > contentHeight() + 0.001 &&
      flow.cursorY > 0
    ) {
      breakForContinuation(true);
      movedToFreshPage = true;
      // A merge that did not fit the band it was offered in may fit this fresh page.
      admitSpans(bodyRowIndex);
    }

    for (;;) {
      fragmentsForRow += 1;
      if (fragmentsForRow > MAX_TABLE_ROW_FRAGMENTS) {
        throw new TablePaginationError(
          'table-row-fragment-limit',
          `Table row ${row.id} exceeded ${MAX_TABLE_ROW_FRAGMENTS} page fragments`
        );
      }

      const remaining = contentHeight() - flow.cursorY;
      if (remaining <= 0.001 && flow.cursorY > 0) {
        if (movedToFreshPage) {
          throw new TablePaginationError(
            'table-row-overheight',
            `Table row ${row.id} cannot fit after repeated header rows`
          );
        }
        breakForContinuation(true);
        movedToFreshPage = true;
        admitSpans(bodyRowIndex);
        continue;
      }

      // Prefer an unsplit placement when the natural height fits the remaining band. The
      // page bottom goes in for the detached head, whose height this row does not carry
      // and whose overflow the `placed.bottom` check below therefore cannot see.
      if (!isContinuation && naturalHeight <= remaining + 0.001) {
        const placed = layoutRowFragment(
          row,
          structure.columnWidthsPt,
          tableLeft,
          flow.cursorY,
          false,
          0,
          tableDeps,
          structure.cellSpacingPt,
          vMerge,
          contentHeight()
        );
        if (placed.bottom > contentHeight() + 0.001) {
          throw new TablePaginationError(
            'table-row-overheight',
            `Table row ${row.id} overflowed the page content box after placement`
          );
        }
        // This placement is COMMITTED either way. It ran on the live deps, so it has
        // already published its anchored drawings and spent its line ids; throwing it away
        // to re-place would leave a float positioned by a layout that never happened.
        const hasMore = placed.remainder !== null;
        rows.push(placed.record);
        sourceRows.push(hasMore ? rowWithSplitBorders(row, isContinuation, true) : row);
        flow.cursorY = placed.bottom;
        if (!hasMore) break;
        // A detached head that reached the page bottom owes the rest to the next page.
        cursors = placed.remainder!;
        isContinuation = true;
        movedToFreshPage = false;
        breakForContinuation(true);
        continue;
      }

      // Does not fit the remaining band.
      // Exact rows are atomic (Word clips overflow inside the fixed box; they do not
      // continue across pages). Same keep-together path as `w:cantSplit`.
      if (row.cantSplit || row.height.rule === 'exact') {
        if (flow.cursorY > 0 && !movedToFreshPage) {
          breakForContinuation(true);
          movedToFreshPage = true;
          // Re-offered like every other break that retries this row: a merge starting on a
          // `w:cantSplit` row that did not fit the band it was offered in may fit the fresh
          // page it just moved to, which is the whole point of deciding where a row lands.
          admitSpans(bodyRowIndex);
          continue;
        }
        throw new TablePaginationError(
          'table-row-overheight',
          row.height.rule === 'exact'
            ? `Table row ${row.id} has w:trHeight hRule=exact taller than the available page content`
            : `Table row ${row.id} has w:cantSplit and is taller than the available page content`
        );
      }

      const placed = layoutRowFragmentBounded(
        row,
        structure.columnWidthsPt,
        tableLeft,
        flow.cursorY,
        contentHeight(),
        false,
        isContinuation,
        0,
        tableDeps,
        cursors,
        structure.cellSpacingPt,
        vMerge
      );

      // First attempt on a non-empty page placed nothing useful → move to next page.
      if (!placed.fitted && flow.cursorY > 0 && !movedToFreshPage) {
        breakForContinuation(true);
        movedToFreshPage = true;
        admitSpans(bodyRowIndex);
        continue;
      }

      if (!placed.fitted) {
        throw new TablePaginationError(
          placed.nestedSplitBlocked ? 'table-row-split-unsupported' : 'table-row-overheight',
          placed.nestedSplitBlocked
            ? `Table row ${row.id} contains a nested table taller than the page content box`
            : `Table row ${row.id} has content that cannot fit a page content box`
        );
      }

      if (placed.bottom > contentHeight() + 0.001) {
        throw new TablePaginationError(
          'table-row-overheight',
          `Table row ${row.id} overflowed the page content box`
        );
      }

      const hasMore = placed.remainder !== null;
      const source = rowWithSplitBorders(row, isContinuation, hasMore);
      rows.push(placed.record);
      sourceRows.push(source);
      flow.cursorY = placed.bottom;

      if (!hasMore) break;

      cursors = placed.remainder!;
      isContinuation = true;
      movedToFreshPage = false;
      breakForContinuation(true);
    }
  }
  closeTableFragment();
}
