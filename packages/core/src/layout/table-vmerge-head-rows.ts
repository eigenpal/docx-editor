// The head rows that carried merged text is published into (`table-vmerge-fragment-carry.ts`).
//
// A vertical merge (ECMA-376 Part 1 §17.4.84 `w:vMerge`) keeps its text in the head cell, the
// cell that restarts the merge. When the merge crosses a page break, each fragment of the
// merge paints its share of that text in one head row:
//
// - In the fragment that holds the authored head row, the placed head row record itself. Its
//   merged cells take the text, and its other cells keep the records they already have.
// - In each later fragment, a zero-height continuation of the head row (`isCarriedHeadRow`),
//   inserted before the first row of the merge in that fragment.
//
// Merges that start in the same row share these head rows, keyed by that row. Each merge
// publishes on top of what the merges before it published, so a head row appears once and holds
// every merged cell. A merge that starts in a later row publishes its own head rows.

import type { SemanticTableRow } from './semantic-table.ts';
import type { TableCellFragmentRecord, TableRowFragmentRecord } from './semantic-records.ts';
import type { CellContentInsets } from './table-cell-geometry.ts';

/** A published head row: its record and the authored row it is laid out from. */
export interface HeadRowEdit {
  readonly record: TableRowFragmentRecord;
  readonly source: SemanticTableRow;
}

/** `placed`: the authored head row at an index. `carried`: a row inserted before an index. */
export type HeadRowKind = 'placed' | 'carried';

export interface HeadRowEdits {
  /**
   * What earlier merges published into this head row, or `undefined` for the first merge.
   * A `placed` head row is the authored row at `index`, so `sourceId` only selects among the
   * `carried` rows inserted before `index`.
   */
  current(kind: HeadRowKind, index: number, sourceId: string): HeadRowEdit | undefined;
  /**
   * Publish `edit` as this head row, in place of `previous` when an earlier merge made one.
   * `insetsFor` gives the content insets of merged cells that differ from the row's own.
   */
  publish(
    kind: HeadRowKind,
    index: number,
    edit: HeadRowEdit,
    previous?: HeadRowEdit,
    insetsFor?: ReadonlyMap<string, CellContentInsets>
  ): void;
  /** The rows and sources with every published head row in place. */
  assemble(sources: readonly SemanticTableRow[]): {
    rows: TableRowFragmentRecord[];
    sources: SemanticTableRow[];
  };
}

type Insets = Map<TableRowFragmentRecord, ReadonlyMap<string, CellContentInsets>>;

/** Collect head-row edits over the row records of one table layout pass. */
export function createHeadRowEdits(
  records: readonly TableRowFragmentRecord[],
  insets: Insets
): HeadRowEdits {
  const placed = new Map<number, HeadRowEdit>();
  const carried = new Map<number, HeadRowEdit[]>();
  return {
    current(kind, index, sourceId) {
      return kind === 'placed'
        ? placed.get(index)
        : carried.get(index)?.find((edit) => edit.source.id === sourceId);
    },
    publish(kind, index, edit, previous, insetsFor) {
      // A carried row takes the cell insets of the row it continues. A placed row takes the
      // insets of the authored record it replaces, which `assemble` still holds by key.
      let key = records[index]!;
      if (kind === 'placed') placed.set(index, edit);
      else {
        const edits = carried.get(index) ?? [];
        const at = previous ? edits.indexOf(previous) : -1;
        if (at >= 0) edits[at] = edit;
        else edits.push(edit);
        carried.set(index, edits);
        const rowInsets = insets.get(previous?.record ?? key);
        if (rowInsets) insets.set(edit.record, rowInsets);
        key = edit.record;
      }
      if (insetsFor?.size) insets.set(key, new Map([...(insets.get(key) ?? []), ...insetsFor]));
    },
    assemble(sources) {
      const rows: TableRowFragmentRecord[] = [];
      const outSources: SemanticTableRow[] = [];
      for (const [index, record] of records.entries()) {
        for (const edit of carried.get(index) ?? []) {
          rows.push(edit.record);
          outSources.push(edit.source);
        }
        const edit = placed.get(index);
        rows.push(edit?.record ?? record);
        outSources.push(edit?.source ?? sources[index]!);
        const rowInsets = insets.get(record);
        if (edit && rowInsets) insets.set(edit.record, rowInsets);
      }
      return { rows, sources: outSources };
    },
  };
}

/** `record` with each cell that `cells` holds replaced by that cell. */
export function withCells(
  record: TableRowFragmentRecord,
  cells: ReadonlyMap<string, TableCellFragmentRecord>
): TableRowFragmentRecord {
  return { ...record, cells: record.cells.map((cell) => cells.get(cell.id) ?? cell) };
}

/** `source` with the cells in `ids` aligned to the top (`w:vAlign`, §17.4.83). */
export function withTopAlignedCells(
  source: SemanticTableRow,
  ids: ReadonlySet<string>
): SemanticTableRow {
  return {
    ...source,
    cells: source.cells.map((cell) =>
      ids.has(cell.id) ? { ...cell, vAlign: 'top' as const } : cell
    ),
  };
}

/**
 * An empty zero-height continuation of the head row `head`, at the top of the fragment whose
 * first row is `first`, with its cells moved to the fragment's left edge `x`.
 */
export function carriedHeadRow(
  head: TableRowFragmentRecord,
  first: TableRowFragmentRecord,
  x: number
): TableRowFragmentRecord {
  return {
    ...head,
    isContinuation: true,
    box: { ...first.box, height: 0 },
    cells: head.cells.map((cell) => ({
      ...cell,
      blocks: [],
      box: { ...cell.box, x: cell.box.x + x - head.box.x, y: first.box.y, height: 0 },
    })),
  };
}
