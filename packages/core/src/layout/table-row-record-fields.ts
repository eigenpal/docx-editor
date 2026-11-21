import type { SemanticTableCell, SemanticTableRow } from './semantic-table.ts';
import type { TableCellFragmentRecord, TableRowFragmentRecord } from './semantic-records.ts';

/** The authored row facts every fragment of the row carries: its revision, gap fill and frame. */
export function authoredRowFields(
  row: SemanticTableRow
): Pick<
  TableRowFragmentRecord,
  | 'revisionKind'
  | 'revisionId'
  | 'revisionAuthor'
  | 'revisionDate'
  | 'changeSites'
  | 'spacingShading'
  | 'spacingFrame'
> {
  return {
    ...(row.revisionKind ? { revisionKind: row.revisionKind } : {}),
    ...(row.revisionId !== undefined ? { revisionId: row.revisionId } : {}),
    ...(row.revisionAuthor !== undefined ? { revisionAuthor: row.revisionAuthor } : {}),
    ...(row.revisionDate !== undefined ? { revisionDate: row.revisionDate } : {}),
    ...(row.changeSites ? { changeSites: row.changeSites } : {}),
    ...(row.spacingShading ? { spacingShading: row.spacingShading } : {}),
    ...(row.spacingFrame ? { spacingFrame: row.spacingFrame } : {}),
  };
}

/** The fields a fresh placement gives a cell fragment, apart from its blocks and box. */
export function authoredCellFields(
  cell: SemanticTableCell
): Omit<TableCellFragmentRecord, 'blocks' | 'box' | 'borders'> {
  return {
    id: cell.id,
    ...(cell.revisionShading
      ? {
          revisionShading: cell.revisionShading,
          revisionShadingAuthor: cell.revisionShadingAuthor,
        }
      : {}),
    gridColumn: cell.gridColumn,
    ...(cell.logicalGridColumn === undefined ? {} : { logicalGridColumn: cell.logicalGridColumn }),
    ...(cell.gridColumnId ? { gridColumnId: cell.gridColumnId } : {}),
    gridSpan: cell.gridSpan,
    vMergeContinue: cell.vMergeContinue,
    ...(cell.vMergeContinue ? { paintInert: true as const } : {}),
    rowSpan: 1,
    ...(cell.shading === undefined ? {} : { shading: cell.shading }),
    ...(cell.textDirection === 'btLr' ? { textDirection: 'btLr' as const } : {}),
  };
}

const ROW_FIELDS = [
  'revisionKind',
  'revisionId',
  'revisionAuthor',
  'revisionDate',
  'changeSites',
  'spacingShading',
  'spacingFrame',
] as const;
// The cell fields `authoredCellFields` can write; a key it leaves out must be absent too.
const CELL_FIELDS = [
  'id',
  'revisionShading',
  'revisionShadingAuthor',
  'gridColumn',
  'logicalGridColumn',
  'gridColumnId',
  'gridSpan',
  'vMergeContinue',
  'paintInert',
  'rowSpan',
  'shading',
  'textDirection',
] as const;

/**
 * Whether a row record placed in an earlier pass still carries the authored fields a fresh
 * placement of `row` gives it. A row moved from an earlier layout keeps its old row and cell
 * fields (`moveRowToTop`, `moveRowToWidths`), so an edit that changed them, such as a cell
 * fill, a merge, or a banded table style after a row insert, must place the row again.
 * Objects compare by identity: a changed revision site or gap fill refuses the reuse.
 */
export function placedRowFieldsHold(
  row: SemanticTableRow,
  placed: TableRowFragmentRecord
): boolean {
  if (placed.isHeaderRow !== row.isHeader) return false;
  if ((placed.placesWhole === true) !== (row.cantSplit || row.height.rule === 'exact'))
    return false;
  const fields = authoredRowFields(row);
  for (const key of ROW_FIELDS) if (fields[key] !== placed[key]) return false;
  if (placed.cells.length !== row.cells.length) return false;
  for (let index = 0; index < row.cells.length; index += 1) {
    const fresh: Partial<TableCellFragmentRecord> = authoredCellFields(row.cells[index]!);
    const before = placed.cells[index]!;
    for (const key of CELL_FIELDS) if (fresh[key] !== before[key]) return false;
  }
  return true;
}
