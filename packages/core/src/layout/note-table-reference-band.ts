// The body band of a footnote reference inside a body table: the referencing ROW.
//
// A body table's row boxes are in page-content coordinates, and a row moves between pages
// as one unit when nothing of it fits. So the band a note must stay below is the row that
// carries its reference, not the whole table fragment. Budgeting every table reference
// below the table's last row starved notes whose references sit in early rows: the notes
// were carried to the next page while every referencing row stayed behind.
//
// The row is the band only where the geometry proves it. Otherwise the caller keeps the
// whole-table band and never evicts (`'table'`):
// - positioned (`w:tblpPr`) and out-of-flow tables;
// - a reference in an authored header row, which moves with the table's opening rows;
// - a reference in a vertically merged cell that spans rows here, whose content can sit
//   in a lower row of the span;
// - a row that keeps with the next one through a direct `w:keepNext` on the first
//   paragraph of a cell, because pushing the next row would take this row with it;
// - a reference line outside its row box (content an exact row height clips). Rotated
//   cells lay out on a local axis, so their row box alone bounds them.
// A vertical merge in ANOTHER cell does not disqualify the row: the paginator already
// carries a merge across a page break between two of its rows.
//
// `evictable` additionally needs the row to be movable as one unit to the next page without
// recreating the same shape there: it must not continue a split row or be the last row of a
// table that ends the page (possibly the head of a split row), a body row of this fragment
// must precede it (a row under only header rows reopens the next page the same way), that
// row must not keep with it, and the page's blocks must stack in one column.

import { isOutOfFlowFragment } from './fragment-flow.ts';
import { fragmentOwnsPosition, lineSegments, segmentOwnsAtomOffset } from './line-segments.ts';
import { paragraphKeeps } from './pagination-keeps.ts';
import type {
  BlockFragmentRecord,
  PageRecord,
  TableCellFragmentRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from './semantic-records.ts';

interface NoteRefSite {
  readonly paragraphId: string;
  readonly atomOffset: number;
}

export interface TableReferenceRowBand {
  readonly top: number;
  readonly bottom: number;
  /**
   * Where the row's content starts when it moves: the row's top minus the header rows that
   * repeat above it on the next page.
   */
  readonly blockTop: number;
  readonly evictable: boolean;
  /** The referencing row fragment. */
  readonly row: TableRowFragmentRecord;
}

/**
 * The referencing row's band in a table fragment on `page`: null when the table does not
 * hold the reference, `'table'` when it does but the row cannot be proven the band.
 */
export function tableReferenceRowBand(
  page: PageRecord,
  table: TableFragmentRecord,
  ref: NoteRefSite
): TableReferenceRowBand | 'table' | null {
  if (table.floatingWrap || isOutOfFlowFragment(table) || table.nestingDepth !== 0) {
    return blocksOwn([table], ref) ? 'table' : null;
  }
  let headerHeight = 0;
  let leadingHeaders = true;
  let previous: TableRowFragmentRecord | undefined;
  for (const row of table.rows) {
    leadingHeaders &&= row.isHeaderRepeat || row.isHeaderRow;
    if (leadingHeaders) headerHeight += row.box.height;
    // A repeated header row is painted furniture; its references belong to the authored row.
    if (row.isHeaderRepeat) continue;
    const cell = owningCell(row, ref);
    if (!cell) {
      previous = row;
      continue;
    }
    if (row.isHeaderRow || (cell.rowSpan ?? 1) > 1 || rowKeepsWithNext(row)) return 'table';
    if (!lineInsideRow(cell, row, ref)) return 'table';
    const top = row.box.y;
    const evictable =
      row.isContinuation !== true &&
      previous !== undefined &&
      !previous.isHeaderRow &&
      !rowKeepsWithNext(previous) &&
      !mayContinue(page, table, row) &&
      stacksInOneColumn(page);
    return { top, bottom: top + row.box.height, blockTop: top - headerHeight, evictable, row };
  }
  return null;
}

/** Whether `row` (a body-table row fragment) holds the reference in any of its cells. */
export function rowOwnsReference(row: TableRowFragmentRecord, ref: NoteRefSite): boolean {
  return owningCell(row, ref) !== null;
}

/**
 * Whether the page's body blocks stack in document order, as one column does. A block that
 * starts above its predecessor's bottom sits in another column or beside a float; lines
 * returning to such a page may change column, and a row moved off it may leave a column
 * that the reserve does not shorten.
 */
export function stacksInOneColumn(page: PageRecord): boolean {
  let previousBottom = Number.NEGATIVE_INFINITY;
  for (const fragment of page.fragments) {
    if (isOutOfFlowFragment(fragment)) continue;
    if (fragment.kind === 'paragraph' && fragment.positionedFrame) continue;
    if (fragment.box.y < previousBottom - 0.001) return false;
    previousBottom = fragment.box.y + fragment.box.height;
  }
  return true;
}

/**
 * Whether `row` may be the head of a row split onto the next page: the last row of a
 * table that ends the page's flow. Moving a split head moves the whole row, and at its
 * destination the rest of the row still fills the band below the reference.
 */
function mayContinue(
  page: PageRecord,
  table: TableFragmentRecord,
  row: TableRowFragmentRecord
): boolean {
  if (table.rows[table.rows.length - 1] !== row) return false;
  const at = page.fragments.indexOf(table);
  for (let index = at + 1; index < page.fragments.length; index += 1) {
    const fragment = page.fragments[index]!;
    if (isOutOfFlowFragment(fragment)) continue;
    if (fragment.kind === 'paragraph' && fragment.positionedFrame) continue;
    return false;
  }
  return true;
}

function owningCell(row: TableRowFragmentRecord, ref: NoteRefSite): TableCellFragmentRecord | null {
  for (const cell of row.cells) {
    if (blocksOwn(cell.blocks, ref)) return cell;
  }
  return null;
}

function blocksOwn(blocks: readonly BlockFragmentRecord[], ref: NoteRefSite): boolean {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      if (fragmentOwnsPosition(block, ref.paragraphId, ref.atomOffset)) return true;
      continue;
    }
    for (const row of block.rows) {
      if (row.isHeaderRepeat) continue;
      for (const cell of row.cells) {
        if (blocksOwn(cell.blocks, ref)) return true;
      }
    }
  }
  return false;
}

/**
 * The row keeps with the next one (`table-row-keeps.ts`) when the first paragraph of its
 * first cell resolves `w:keepNext`. Fragment props carry only the direct `w:pPr`, so a
 * style-inherited keep is not seen here; any cell counts, which errs toward the table band.
 */
export function rowKeepsWithNext(row: TableRowFragmentRecord): boolean {
  for (const cell of row.cells) {
    const first = cell.blocks[0];
    if (first?.kind === 'paragraph' && paragraphKeeps(first.props).keepNext) return true;
  }
  return false;
}

/**
 * Whether the reference's line lies inside the row box. A direct cell paragraph in a
 * horizontal cell is laid out in page-content coordinates; nested tables and rotated
 * cells are bounded by the row box they are painted in.
 */
function lineInsideRow(
  cell: TableCellFragmentRecord,
  row: TableRowFragmentRecord,
  ref: NoteRefSite
): boolean {
  if (cell.textDirection) return true;
  for (const block of cell.blocks) {
    if (block.kind !== 'paragraph') continue;
    if (!fragmentOwnsPosition(block, ref.paragraphId, ref.atomOffset)) continue;
    for (const line of block.lines) {
      for (const segment of lineSegments(line)) {
        if (!segmentOwnsAtomOffset(segment, ref.paragraphId, ref.atomOffset)) continue;
        return (
          line.box.y >= row.box.y - 0.001 &&
          line.box.y + line.box.height <= row.box.y + row.box.height + 0.001
        );
      }
    }
    return false;
  }
  return true;
}
