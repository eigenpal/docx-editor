import { concatMarkdown, literalMarkdown, type MappedMarkdown } from './markdown-source-map.ts';

export function tableWidth(projected: number | undefined, edgeCount: number | undefined): number {
  return Math.max(projected ?? (edgeCount ?? 1) - 1, 1);
}

/**
 * Serialize the one table shape GFM cannot express without interpreting DOCX records.
 *
 * Plain `<table>/<tr>/<td>/<th>` markup, all on one line: element names survive strict
 * sanitizers (GitHub's pipeline and stock `rehype-sanitize` both keep table elements while
 * stripping classes and roles), so the structure is self-contained and needs no consumer CSS.
 * Staying on one line keeps CommonMark inline parsing active inside each cell.
 */
export function nestedTableHtml<TRow extends { readonly isHeaderRow: boolean }>(
  rows: readonly TRow[],
  width: number,
  cellMarkdown: (row: TRow, columnIndex: number) => MappedMarkdown
): MappedMarkdown {
  const renderedRows = rows.map((row) => {
    const tag = row.isHeaderRow ? 'th' : 'td';
    const renderedCells = Array.from({ length: width }, (_, columnIndex) =>
      concatMarkdown([
        literalMarkdown(`<${tag}>`),
        cellMarkdown(row, columnIndex),
        literalMarkdown(`</${tag}>`),
      ])
    );
    return concatMarkdown([literalMarkdown('<tr>'), ...renderedCells, literalMarkdown('</tr>')]);
  });
  return concatMarkdown([literalMarkdown('<table>'), ...renderedRows, literalMarkdown('</table>')]);
}
