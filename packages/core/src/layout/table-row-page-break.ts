// `w:pageBreakBefore` on a body table row.
//
// A row starts a new page when the FIRST paragraph of its FIRST cell resolves
// `w:pageBreakBefore` (§17.3.1.23) through the full cascade: document defaults, table style,
// paragraph style chain, then direct formatting, last value winning. The same property on a
// later paragraph of that cell or on another cell's paragraph does nothing, and so does a
// manual page break inside any cell. Only the body flow asks: a nested table's rows never
// break the page, and a positioned (`w:tblpPr`) table stays on its anchor sheet.

import type { SemanticTableRow } from './semantic-table.ts';
import { propertiesOf } from './paragraph-flow.ts';
import { paragraphBreaksBefore } from './paragraph-style.ts';
import { cascadeParagraphFormatting, type StyleCascadeTable } from './style-cascade.ts';
import { findParagraphProperties } from './style-definition-reader.ts';

/**
 * Whether `row` asks to start on a new page.
 *
 * A vertically merged continuation cell has no content of its own, so its paragraph never
 * asks; neither does a first cell that opens with a nested table instead of a paragraph.
 */
export function rowBreaksPageBefore(
  row: SemanticTableRow,
  styleCascade: StyleCascadeTable | undefined
): boolean {
  const cell = row.cells[0];
  if (!cell || cell.vMergeContinue) return false;
  const first = cell.blocks[0];
  if (first?.kind !== 'paragraph') return false;
  const pPr = findParagraphProperties(first);
  const props = styleCascade
    ? cascadeParagraphFormatting(styleCascade, pPr, cell.styleFormatting).paragraphProperties
    : propertiesOf(pPr);
  return paragraphBreaksBefore(props);
}
