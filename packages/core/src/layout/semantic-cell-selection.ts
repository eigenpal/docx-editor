// Rectangular table-cell selection over semantic layout records.
//
// Dragging across cells does not mean the same thing as dragging across text. Sweeping from
// A1 to B2 selects FOUR CELLS, not the run of characters between the first and the last —
// which would take in everything painted in between and let a single delete unpick the table.
// A word processor selects the rectangle, and so does this.
//
// It is expressed as a SIBLING of the text selection rather than a variant of it. A union
// would push a narrowing branch into every reader of `SemanticSelection` — ordering, deletion,
// clipboard, formatting, viewport pinning, the DOM mirror — and each is one future edit away
// from forgetting it. Carrying an equivalent TEXT range inside the cell selection instead
// means every one of those keeps working untouched, and only the readers that genuinely want
// the rectangle ask for it.

import { paragraphTextFromLayout, type SemanticSelection } from './semantic-interaction.ts';
import type { TableCellAddress } from './semantic-hit-test.ts';
import {
  paragraphFragmentsOf,
  type BlockFragmentRecord,
  type SemanticLayout,
  type StyleSpanRecord,
  type TableCellFragmentRecord,
  type TableRowFragmentRecord,
} from './semantic-records.ts';

/** A rectangle of table cells. */
export interface CellSelection {
  readonly kind: 'cells';
  /** Canonical node id of the `w:tbl`. */
  readonly tableId: string;
  /** Every selected `w:tc`, in document order, with merges resolved. */
  readonly cellIds: readonly string[];
  /** Inclusive row ordinals within the table. */
  readonly rows: { readonly from: number; readonly to: number };
  /** Inclusive grid columns. */
  readonly columns: { readonly from: number; readonly to: number };
  /**
   * The equivalent text range.
   *
   * Every existing reader of a selection — deletion, the clipboard, the DOM mirror, viewport
   * pinning — takes this and needs no knowledge that a rectangle produced it.
   */
  readonly text: SemanticSelection;
}

/** One painted occurrence of a cell, and where it sits. */
export interface PlacedCell {
  readonly pageIndex: number;
  readonly tableId: string;
  readonly row: TableRowFragmentRecord;
  readonly cell: TableCellFragmentRecord;
  /** Ordinal within the whole table, shared by a header row and every repeat of it. */
  readonly rowIndex: number;
  readonly isHeaderRepeat: boolean;
}

interface TableIndex {
  /** Every painted cell of a table, in document order, repeats included. */
  readonly placed: readonly PlacedCell[];
  /** The authored rows once each, in order, keyed by ordinal. */
  readonly rows: ReadonlyMap<number, readonly TableCellFragmentRecord[]>;
}

const tableIndexCache = new WeakMap<SemanticLayout, Map<string, TableIndex>>();

/**
 * Tables indexed by id, built once per layout.
 *
 * A table can span pages, and a `w:tblHeader` row is re-emitted at the top of each
 * continuation — so "the rows of this table" is not something any single fragment knows. The
 * ordinal is assigned from the first non-repeat occurrence, which is what makes a repeat on
 * page four resolve to the same row as the original on page one.
 */
function tableIndex(layout: SemanticLayout): Map<string, TableIndex> {
  const cached = tableIndexCache.get(layout);
  if (cached) return cached;

  const placed = new Map<string, PlacedCell[]>();
  const rows = new Map<string, Map<number, readonly TableCellFragmentRecord[]>>();
  const ordinals = new Map<string, Map<string, number>>();

  const visit = (blocks: readonly BlockFragmentRecord[], pageIndex: number): void => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') continue;
      const id = block.tableId;
      let rowOrdinals = ordinals.get(id);
      if (!rowOrdinals) {
        rowOrdinals = new Map();
        ordinals.set(id, rowOrdinals);
        placed.set(id, []);
        rows.set(id, new Map());
      }
      for (const row of block.rows) {
        let rowIndex = rowOrdinals.get(row.id);
        if (rowIndex === undefined) {
          // A repeat can only ever follow the original, so an unseen id here is a new row.
          rowIndex = rowOrdinals.size;
          rowOrdinals.set(row.id, rowIndex);
          rows.get(id)!.set(rowIndex, row.cells);
        }
        for (const cell of row.cells) {
          placed.get(id)!.push({
            pageIndex,
            tableId: id,
            row,
            cell,
            rowIndex,
            isHeaderRepeat: row.isHeaderRepeat,
          });
          visit(cell.blocks, pageIndex);
        }
      }
    }
  };

  for (const page of layout.pages) visit(page.fragments, page.index);

  const index = new Map<string, TableIndex>();
  for (const [id, cells] of placed) {
    index.set(id, { placed: cells, rows: rows.get(id) ?? new Map() });
  }
  tableIndexCache.set(layout, index);
  return index;
}

/** Anything that occupies grid columns — a painted cell, or an address naming one. */
interface GridExtent {
  readonly gridColumn: number;
  readonly gridSpan: number;
}

const spans = (cell: GridExtent): { from: number; to: number } => ({
  from: cell.gridColumn,
  to: cell.gridColumn + Math.max(1, cell.gridSpan) - 1,
});

/**
 * The rectangle two cells define.
 *
 * Grown to a fixpoint rather than taken literally: a cell that spans two columns cannot be
 * half selected, and a vertically merged run cannot be selected in the middle. Word grows the
 * rectangle until every cell it touches is wholly inside it, so dragging into a merged cell
 * pulls the selection out to that cell's full extent.
 */
export function cellSelectionBetween(
  layout: SemanticLayout,
  anchor: TableCellAddress,
  head: TableCellAddress
): CellSelection | null {
  if (anchor.tableId !== head.tableId) return null;
  const table = tableIndex(layout).get(anchor.tableId);
  if (!table) return null;

  let rowFrom = Math.min(anchor.rowIndex, head.rowIndex);
  let rowTo = Math.max(anchor.rowIndex, head.rowIndex);
  let columnFrom = Math.min(spans(anchor).from, spans(head).from);
  let columnTo = Math.max(spans(anchor).to, spans(head).to);

  const overlapsColumns = (cell: TableCellFragmentRecord): boolean => {
    const { from, to } = spans(cell);
    return to >= columnFrom && from <= columnTo;
  };
  const continuesInRange = (rowIndex: number): boolean =>
    (table.rows.get(rowIndex) ?? []).some((cell) => cell.vMergeContinue && overlapsColumns(cell));

  // Both ranges only ever grow and are bounded by the table, so this terminates; the pass cap
  // is a backstop against a record set that says something impossible, not a real limit.
  for (let pass = 0; pass <= table.rows.size + 1; pass += 1) {
    let grew = false;
    // A cell spanning columns cannot be half selected: touching it pulls the rectangle out to
    // its full width.
    for (const [rowIndex, cells] of table.rows) {
      if (rowIndex < rowFrom || rowIndex > rowTo) continue;
      for (const cell of cells) {
        if (!overlapsColumns(cell)) continue;
        const { from, to } = spans(cell);
        if (from < columnFrom) {
          columnFrom = from;
          grew = true;
        }
        if (to > columnTo) {
          columnTo = to;
          grew = true;
        }
      }
    }
    // A vertical merge cannot be selected in the middle either. A continuation is the tail of
    // a run that starts higher up, so taking one means taking the whole run — otherwise a
    // delete would empty a cell that is still on screen.
    while (rowFrom > 0 && continuesInRange(rowFrom)) {
      rowFrom -= 1;
      grew = true;
    }
    while (continuesInRange(rowTo + 1)) {
      rowTo += 1;
      grew = true;
    }
    if (!grew) break;
  }

  const cellIds: string[] = [];
  const seen = new Set<string>();
  for (const entry of table.placed) {
    if (entry.isHeaderRepeat) continue;
    if (entry.rowIndex < rowFrom || entry.rowIndex > rowTo) continue;
    const { from, to } = spans(entry.cell);
    if (to < columnFrom || from > columnTo) continue;
    if (seen.has(entry.cell.id)) continue;
    seen.add(entry.cell.id);
    cellIds.push(entry.cell.id);
  }
  if (cellIds.length === 0) return null;

  return {
    kind: 'cells',
    tableId: anchor.tableId,
    cellIds,
    rows: { from: rowFrom, to: rowTo },
    columns: { from: columnFrom, to: columnTo },
    text: textRangeOf(layout, cellIds),
  };
}

/** Paragraph ids inside a set of cells, in document order, each once. */
export function paragraphsInCells(
  layout: SemanticLayout,
  cellIds: readonly string[]
): readonly string[] {
  const wanted = new Set(cellIds);
  const found: string[] = [];
  const seen = new Set<string>();
  for (const table of tableIndex(layout).values()) {
    for (const entry of table.placed) {
      if (entry.isHeaderRepeat || !wanted.has(entry.cell.id)) continue;
      for (const block of entry.cell.blocks) collectParagraphs(block, found, seen);
    }
  }
  return found;
}

function collectParagraphs(block: BlockFragmentRecord, into: string[], seen: Set<string>): void {
  if (block.kind === 'paragraph') {
    if (!seen.has(block.paragraphId)) {
      seen.add(block.paragraphId);
      into.push(block.paragraphId);
    }
    return;
  }
  for (const row of block.rows) {
    if (row.isHeaderRepeat) continue;
    for (const cell of row.cells) {
      for (const nested of cell.blocks) collectParagraphs(nested, into, seen);
    }
  }
}

/**
 * The text range a cell selection stands in for.
 *
 * From the first selected paragraph's start to the last one's end, so deletion, the clipboard
 * and the DOM mirror can act on a cell selection without knowing it is one. A rectangle whose
 * cells are all empty still has to name a position, or those readers would have nothing.
 */
function textRangeOf(layout: SemanticLayout, cellIds: readonly string[]): SemanticSelection {
  const paragraphs = paragraphsInCells(layout, cellIds);
  const first = paragraphs[0];
  const last = paragraphs[paragraphs.length - 1];
  if (!first || !last) return emptySelection(layout);
  return {
    anchor: { paragraphId: first, offset: 0 },
    head: { paragraphId: last, offset: paragraphTextFromLayout(layout, last).length },
  };
}

function emptySelection(layout: SemanticLayout): SemanticSelection {
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      const at = { paragraphId: fragment.paragraphId, offset: 0 };
      return { anchor: at, head: at };
    }
  }
  const nowhere = { paragraphId: '', offset: 0 };
  return { anchor: nowhere, head: nowhere };
}

/** The style spans a cell selection covers, for reporting active formatting. */
export function spansInCells(
  layout: SemanticLayout,
  cellIds: readonly string[]
): readonly StyleSpanRecord[] {
  const wanted = new Set(paragraphsInCells(layout, cellIds));
  const found: StyleSpanRecord[] = [];
  const seen = new Set<string>();
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      if (!wanted.has(fragment.paragraphId)) continue;
      for (const line of fragment.lines) {
        for (const span of line.spans) {
          // A paragraph that crosses a page repeats its spans across fragments.
          const key = `${span.range.paragraphId}:${span.range.start}:${span.range.end}`;
          if (seen.has(key)) continue;
          seen.add(key);
          found.push(span);
        }
      }
    }
  }
  return found;
}

/** One rectangle per painted occurrence of a selected cell, in page-content coordinates. */
export function cellSelectionRects(
  layout: SemanticLayout,
  cellIds: readonly string[]
): readonly { pageIndex: number; x: number; y: number; width: number; height: number }[] {
  const wanted = new Set(cellIds);
  const rects: { pageIndex: number; x: number; y: number; width: number; height: number }[] = [];
  for (const table of tableIndex(layout).values()) {
    for (const entry of table.placed) {
      // Repeats included on purpose: a repeated header row IS drawn on that page, and leaving
      // it unhighlighted would show a selected row that looks unselected on every page but
      // the first.
      if (!wanted.has(entry.cell.id)) continue;
      rects.push({
        pageIndex: entry.pageIndex,
        x: entry.cell.box.x,
        y: entry.cell.box.y,
        width: entry.cell.box.width,
        height: entry.cell.box.height,
      });
    }
  }
  return rects;
}
