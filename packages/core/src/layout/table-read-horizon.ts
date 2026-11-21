// How far into a table the paginator's decisions have read, for restarts at a page top.
//
// A restart keeps the pages before its page and paginates from the row that opens it
// (`table-page-restart.ts`). The kept pages are valid only when every row that any decision
// for them read is unchanged. Those decisions read past the rows they place: the row that
// moved to the restart page decided that from the row after it (the closing rule of a row that
// ends a page), a kept group reads the rows it keeps with and the row after them, and a merge
// is planned over all of its rows.
//
// The paginator reports each of those reads here, and records the furthest one at each page
// start. A restart then compares every row up to that index, not only the rows the kept
// pages hold. The reads are reported at three places, so a new rule needs no restart code:
//
// - Each row the paginator takes up reads the row after it, and every row of the merge region
//   it is in and the row after that region. Any rule that decides where a row goes may
//   read its neighbor below (closing rules, repeated header admission) or its merge.
// - Each kept-row pricing reads the rows its source is asked about.
// - A pricing that reaches past the last row reads the content after the table. The horizon
//   is then unbounded and no later page start may restart.

import type { KeptRowSource } from './table-row-keeps.ts';
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';

/** The furthest row index read so far, in the table's own rows. */
export interface ReadHorizon {
  /** `Infinity` once a decision read the content after the table. */
  readonly through: number;
  /** The paginator takes up row `index`. */
  row(index: number): void;
  /** `source` with every row it is asked about read; `offset` maps its rows to the table's. */
  track(source: KeptRowSource, offset: number): KeptRowSource;
}

const holdsMerge = (row: SemanticTableRow): boolean =>
  row.cells.some((cell) => cell.vMergeContinue || cell.headsVerticalMerge === true);

/**
 * For each row, the last index of the run of merge rows it is in, or -1. A merge runs from its
 * head through its continuations, and each of those rows holds a merge, so a run covers it.
 */
function mergeRunEnds(rows: readonly SemanticTableRow[]): Int32Array {
  const ends = new Int32Array(rows.length).fill(-1);
  for (let index = rows.length - 1, end = -1; index >= 0; index -= 1) {
    if (!holdsMerge(rows[index]!)) end = -1;
    else if (end < 0) end = index;
    ends[index] = end;
  }
  return ends;
}

/** A horizon over `structure`, starting at `through` (a resumed pass starts where it stood). */
export function createReadHorizon(structure: SemanticTableStructure, through = -1): ReadHorizon {
  let furthest = through;
  let ends: Int32Array | undefined;
  const read = (index: number): void => {
    if (index > furthest) furthest = index;
  };
  return {
    get through() {
      return furthest;
    },
    row(index) {
      read(index + 1);
      ends ??= mergeRunEnds(structure.rows);
      const end = ends[index] ?? -1;
      if (end >= 0) read(end + 1);
    },
    track(source, offset) {
      const reads = (index: number): number => {
        read(offset + index);
        return index;
      };
      const { mergedHeights, movesToFreshPage } = source;
      return {
        ...source,
        keepsAt: (index) => source.keepsAt(reads(index)),
        breaksAt: (index) => source.breaksAt(reads(index)),
        heightOf: (index) => source.heightOf(reads(index)),
        placesWhole: (index) => source.placesWhole(reads(index)),
        openingOf: (index) => source.openingOf(reads(index)),
        opensWithin: (index, height) => source.opensWithin(reads(index), height),
        ...(movesToFreshPage
          ? { movesToFreshPage: (index: number) => movesToFreshPage(reads(index)) }
          : {}),
        ...(mergedHeights
          ? { mergedHeights: (start: number, end: number) => mergedHeights(start, reads(end)) }
          : {}),
        following: (room) => {
          furthest = Number.POSITIVE_INFINITY;
          return source.following(room);
        },
      };
    },
  };
}
