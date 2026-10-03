// Autofit column minimums: a column is never narrower than the widest unbreakable segment
// its cells hold.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { PAGE_BREAK_CHAR } from '../store/package/hard-break.ts';
import { wordBoundaries } from './cjk-line-break.ts';
import { piecesOfParagraphForDisplay } from './field-projection-display.ts';
import type { RevisionDisplayMode } from './revision-projection.ts';
import { displayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { TextMeasurer } from './semantic-records.ts';
import type { SemanticTableRow } from './semantic-table.ts';
import {
  cascadeRunProperties,
  resolveParagraphLayoutInputs,
  type StyleCascadeTable,
} from './style-cascade.ts';
import { cellContentInsets } from './table-cell-geometry.ts';
import type { PreferredWidth } from './table-widths.ts';
import { withoutTrailingSpaces } from './trailing-spaces.ts';

/** Below this a column is already as wide as its content needs. */
const WIDTH_EPSILON_PT = 0.01;
/** No column collapses below a hairline, whatever its content. */
const MIN_COLUMN_PT = 1;

/**
 * The widest segment of a paragraph that no line break may split, plus its side indents.
 *
 * Break opportunities are spaces, tabs, hard breaks, and the dash rule of
 * {@link wordBoundaries}. An ideographic run counts as one segment here: an autofit column
 * widens to keep it whole, although line breaking may still wrap it inside the column. A
 * segment runs across source runs and field results, measured in the face each piece paints.
 */
export function paragraphMinimumWidthPt(
  paragraph: OoxmlElement,
  measurer: TextMeasurer,
  styleCascade: StyleCascadeTable | undefined,
  tableCellStyle: SemanticTableRow['cells'][number]['styleFormatting'] | undefined,
  displayMode: RevisionDisplayMode
): number {
  const inputs = resolveParagraphLayoutInputs(
    paragraph,
    Number.MAX_SAFE_INTEGER,
    styleCascade,
    undefined,
    tableCellStyle,
    true
  );
  const pieces = piecesOfParagraphForDisplay(
    paragraph,
    inputs.inheritedRunProperties,
    undefined,
    styleCascade
      ? (inherited, direct) => cascadeRunProperties(inherited, direct, styleCascade)
      : undefined,
    undefined,
    undefined,
    displayMode,
    undefined,
    undefined,
    styleCascade?.themeFonts
  );
  let widest = 0;
  let segment = 0;
  const close = (): void => {
    if (segment > widest) widest = segment;
    segment = 0;
  };
  for (const piece of pieces) {
    if (piece.text === '\n' || piece.text === PAGE_BREAK_CHAR || piece.style.hidden) {
      close();
      continue;
    }
    const style = styleForFontSlot(piece.style, piece.fontSlot);
    const measure = (text: string): number => measurer.measure(displayText(text, style), style);
    if (piece.measureText !== undefined) {
      segment += measure(piece.measureText);
      continue;
    }
    let from = 0;
    for (const to of wordBoundaries(piece.text, false)) {
      const candidate = piece.text.slice(from, to);
      from = to;
      if (candidate.length === 0) continue;
      if (candidate === '\t') {
        close();
        continue;
      }
      // Measured as line breaking measures it, so the advance comes from the same cache;
      // the trailing spaces it hangs are priced on their own.
      const ink = withoutTrailingSpaces(candidate);
      if (ink.length === candidate.length) segment += measure(candidate);
      else if (ink.length > 0) segment += measure(candidate) - measure(candidate.slice(ink.length));
      // A space or a dash ends the segment; a piece seam does not.
      if (ink.length < candidate.length || to < piece.text.length) close();
    }
  }
  close();
  return widest + Math.max(0, inputs.indent.left) + Math.max(0, inputs.indent.right);
}

/**
 * Each column's autofit minimum: its widest single-column cell content plus that cell's
 * horizontal content insets (margins and border clearance), so an empty cell keeps them. A cell that spans columns,
 * continues a vertical merge, sets its text vertically, or holds only a nested table sets no
 * minimum.
 */
export function autofitColumnMinimumsPt(
  rows: readonly SemanticTableRow[],
  columnCount: number,
  measurer: TextMeasurer,
  context: {
    readonly styleCascade: StyleCascadeTable | undefined;
    readonly displayMode: RevisionDisplayMode;
    readonly collapsedBorders: boolean;
  }
): number[] {
  const { styleCascade, displayMode } = context;
  const minimums = new Array<number>(columnCount).fill(0);
  for (const row of rows) {
    for (const cell of row.cells) {
      // Vertical text runs along the row, not across the column.
      if (cell.gridSpan !== 1 || cell.vMergeContinue || cell.textDirection !== 'horizontal')
        continue;
      const column = cell.logicalGridColumn ?? cell.gridColumn;
      if (column < 0 || column >= columnCount) continue;
      let content = -1;
      for (const block of cell.blocks) {
        if (block.kind !== 'paragraph') continue;
        content = Math.max(
          content,
          paragraphMinimumWidthPt(block, measurer, styleCascade, cell.styleFormatting, displayMode)
        );
      }
      if (content < 0) continue;
      const insets = cellContentInsets(cell, context.collapsedBorders);
      const needed = content + insets.left + insets.right;
      if (needed > minimums[column]!) minimums[column] = needed;
    }
  }
  return minimums;
}

/**
 * Widen autofit columns that are narrower than their minimum.
 *
 * A column below its minimum grows to it. A table without an absolute `w:tblW` first grows
 * into the room left in `availablePt`. The rest comes from the other columns, each giving
 * in proportion to how far it sits above its own minimum. When they reach their minimums,
 * the table grows past its stated width; when the minimums together are wider than
 * `availablePt`, every column is its minimum scaled down by the same factor. Widths that
 * already hold their content come back unchanged, by identity.
 */
export function widenAutofitColumns(
  widths: readonly number[],
  minimums: readonly number[],
  tableWidth: PreferredWidth,
  availablePt: number
): readonly number[] {
  let deficit = 0;
  for (const [index, width] of widths.entries()) {
    deficit += Math.max(0, minimums[index]! - width);
  }
  if (deficit <= WIDTH_EPSILON_PT) return widths;
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (!(tableWidth.type === 'dxa' && tableWidth.value > 0) && Number.isFinite(availablePt)) {
    deficit = Math.max(0, deficit - Math.max(0, availablePt - total));
  }
  const grown = widths.map((width, index) => Math.max(width, minimums[index]!));
  const slack = widths.map((width, index) =>
    minimums[index]! > width ? 0 : width - minimums[index]!
  );
  const totalSlack = slack.reduce((sum, value) => sum + value, 0);
  if (deficit <= totalSlack) {
    if (totalSlack <= 0) return grown;
    return grown.map((width, index) => width - (deficit * slack[index]!) / totalSlack);
  }
  const floor = minimums.map((minimum) => Math.max(minimum, MIN_COLUMN_PT));
  const needed = floor.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(availablePt) || needed <= availablePt) return floor;
  const scale = availablePt / needed;
  return floor.map((width) => width * scale);
}
