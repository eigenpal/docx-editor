// What a placed table fragment holds, without where it holds it.
//
// Readers that only ask whether a fragment holds some paragraph or nested table, and how many
// lines it counts, need none of its geometry. These facts follow the fragment's rows the way
// such readers walk them: a repeated header row is skipped at every nesting level (its
// paragraphs belong to the row's first occurrence), and nested tables are entered.
//
// Facts are computed once per immutable fragment. A width-only table update proves that each
// replacement has the same rows, header-row repeats, cells, paragraphs and line counts as the
// fragment it replaces (`sameRowHeights` in `table-width-update.ts`), and shares the facts,
// so the replacement is never walked for them.

import type { BlockFragmentRecord, TableFragmentRecord } from './semantic-records.ts';

export interface TableFragmentFacts {
  /** Paragraph ids outside repeated header rows, nested tables included. */
  readonly paragraphIds: ReadonlySet<string>;
  /** Ids of nested tables outside repeated header rows; not the fragment's own id. */
  readonly nestedTableIds: ReadonlySet<string>;
  /** Lines of those paragraphs. */
  readonly lineCount: number;
}

const known = new WeakMap<TableFragmentRecord, TableFragmentFacts>();

let observer: { computed: number; shared: number; skipped: number; skipOff: boolean } | null = null;

/**
 * @internal Counts facts computed by walking rows, facts shared by a width-only update, and
 * tables a reader skipped. `skipOff` makes {@link linesOfUnneededTable} always answer null,
 * so tests can compare against the full walk.
 */
export function tableFragmentFactsTestRecorder(options: { readonly skipOff?: boolean } = {}): {
  readonly computed: number;
  readonly shared: number;
  readonly skipped: number;
  dispose(): void;
} {
  const counts = { computed: 0, shared: 0, skipped: 0, skipOff: options.skipOff === true };
  observer = counts;
  return {
    get computed() {
      return counts.computed;
    },
    get shared() {
      return counts.shared;
    },
    get skipped() {
      return counts.skipped;
    },
    dispose() {
      if (observer === counts) observer = null;
    },
  };
}

/** The fragment's facts, from the memo or one walk of its rows. */
export function tableFragmentFacts(fragment: TableFragmentRecord): TableFragmentFacts {
  const cached = known.get(fragment);
  if (cached) return cached;
  const paragraphIds = new Set<string>();
  const nestedTableIds = new Set<string>();
  let lineCount = 0;
  const visitRows = (table: TableFragmentRecord): void => {
    for (const row of table.rows) {
      if (row.isHeaderRepeat) continue;
      for (const cell of row.cells) visitBlocks(cell.blocks);
    }
  };
  const visitBlocks = (blocks: readonly BlockFragmentRecord[]): void => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        paragraphIds.add(block.paragraphId);
        lineCount += block.lines.length;
        continue;
      }
      nestedTableIds.add(block.tableId);
      visitRows(block);
    }
  };
  visitRows(fragment);
  const facts: TableFragmentFacts = { paragraphIds, nestedTableIds, lineCount };
  known.set(fragment, facts);
  if (observer) observer.computed += 1;
  return facts;
}

/**
 * Give `next` the facts already known for `previous`. The caller proves that `next` has the
 * same rows, header-row repeats, cells, paragraphs, nested tables and line counts. Facts not
 * yet known for `previous` are not computed here.
 */
export function shareTableFragmentFacts(
  previous: TableFragmentRecord,
  next: TableFragmentRecord
): void {
  const facts = known.get(previous);
  if (!facts || previous === next) return;
  known.set(next, facts);
  if (observer) observer.shared += 1;
}

function intersects(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const id of small) if (large.has(id)) return true;
  return false;
}

/**
 * The line count of `fragment` when a reader needs none of the paragraphs or nested tables
 * inside it, or null when it must walk the rows. The fragment's own id is the caller's to
 * check: it needs no row.
 */
export function linesOfUnneededTable(
  fragment: TableFragmentRecord,
  neededBlockIds: ReadonlySet<string>,
  neededParagraphIds: ReadonlySet<string>
): number | null {
  if (observer?.skipOff) return null;
  const facts = tableFragmentFacts(fragment);
  if (
    intersects(facts.paragraphIds, neededBlockIds) ||
    intersects(facts.paragraphIds, neededParagraphIds) ||
    intersects(facts.nestedTableIds, neededBlockIds)
  )
    return null;
  if (observer) observer.skipped += 1;
  return facts.lineCount;
}
