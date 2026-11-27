// The page occurrence a repeated header row was placed under (`pageOccurrenceKey`), read
// back from the line ids of a finalized row.

import type { TableRowFragmentRecord } from './semantic-records.ts';

/** The page occurrence a repeated header row's line ids were stamped with. */
export function headerOccurrence(row: TableRowFragmentRecord): string | undefined {
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

/**
 * The occurrence one repeat of a header group was stamped with, read from any of its repeated
 * rows: a row of continuations holds no line, so it carries none of its own. Undefined when no
 * repeated row holds a line, or when two of them disagree.
 */
export function repeatGroupOccurrence(rows: readonly TableRowFragmentRecord[]): string | undefined {
  let occurrence: string | undefined;
  for (const row of rows) {
    if (!row.isHeaderRepeat) continue;
    const own = headerOccurrence(row);
    if (own === undefined) continue;
    if (occurrence !== undefined && own !== occurrence) return undefined;
    occurrence = own;
  }
  return occurrence;
}
