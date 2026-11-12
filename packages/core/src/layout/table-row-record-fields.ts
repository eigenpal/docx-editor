import type { SemanticTableRow } from './semantic-table.ts';
import type { TableRowFragmentRecord } from './semantic-records.ts';

/** The authored row facts every fragment of the row carries: its revision and its gap fill. */
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
> {
  return {
    ...(row.revisionKind ? { revisionKind: row.revisionKind } : {}),
    ...(row.revisionId !== undefined ? { revisionId: row.revisionId } : {}),
    ...(row.revisionAuthor !== undefined ? { revisionAuthor: row.revisionAuthor } : {}),
    ...(row.revisionDate !== undefined ? { revisionDate: row.revisionDate } : {}),
    ...(row.changeSites ? { changeSites: row.changeSites } : {}),
    ...(row.spacingShading ? { spacingShading: row.spacingShading } : {}),
  };
}
