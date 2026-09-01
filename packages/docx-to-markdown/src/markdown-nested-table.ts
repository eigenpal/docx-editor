import { concatMarkdown, literalMarkdown, type MappedMarkdown } from './markdown-source-map.ts';

export function tableWidth(projected: number | undefined, edgeCount: number | undefined): number {
  return Math.max(projected ?? (edgeCount ?? 1) - 1, 1);
}

/**
 * Serialize the one table shape GFM cannot express without interpreting DOCX records.
 * Inline spans keep CommonMark inline parsing active and preserve every mapped boundary.
 */
export function nestedTableHtml<TRow extends { readonly isHeaderRow: boolean }>(
  rows: readonly TRow[],
  width: number,
  cellMarkdown: (row: TRow, columnIndex: number) => MappedMarkdown
): MappedMarkdown {
  const renderedRows = rows.map((row) => {
    const renderedCells = Array.from({ length: width }, (_, columnIndex) => {
      const role = row.isHeaderRow ? 'columnheader' : 'cell';
      return concatMarkdown([
        literalMarkdown(`<span class="docx-nested-table__cell" role="${role}">`),
        cellMarkdown(row, columnIndex),
        literalMarkdown('</span>'),
      ]);
    });
    return concatMarkdown([
      literalMarkdown('<span class="docx-nested-table__row" role="row">'),
      ...renderedCells,
      literalMarkdown('</span>'),
    ]);
  });
  return concatMarkdown([
    literalMarkdown('<span class="docx-nested-table" role="table">'),
    ...renderedRows,
    literalMarkdown('</span>'),
  ]);
}
