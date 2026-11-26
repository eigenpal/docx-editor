// The cell properties a table style states: `w:style/w:tcPr` (CT_TcPr, 17.7.6.9) for the
// whole table and `w:tblStylePr/w:tcPr` (CT_TcPr, 17.7.6.8) for one conditional format.
//
// This unit resolves the two that move content: `w:tcMar` (CT_TcMar, 17.4.68) and `w:vAlign`
// (CT_VerticalJc, 17.4.83). Shading, borders, `w:noWrap` and `w:hideMark` have their own
// units. A style's `w:textDirection` (17.4.72) does not turn the text of a cell, so nothing
// here reads it.
//
// Sources, strongest first:
// - Margins: the cell's own `w:tcMar`, the conditional formats of the cell's row, the
//   whole-table `w:tcPr` of each style in the `w:basedOn` chain (17.7.2), then the table-level
//   margins (`w:tblPrEx`, `w:tblPr`, the style's `w:tblPr`: 17.4.41, 17.4.42).
// - Alignment: the cell's own `w:vAlign`, a whole-table `center` or `bottom`, the conditional
//   formats of the cell, then `top`.
//
// Two of these orders are not the plain layering of 17.7.6, which applies the whole table
// first and each conditional format over it. They follow rendered documents instead: a
// conditional margin reaches its whole row, and a whole-table `center` or `bottom` holds
// against a conditional alignment. A derived style's `w:tblStylePr` also replaces its base
// style's format of the same type as a whole, as it does for shading (`style.conditional`).

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { wmlChildNamed as childNamed } from '../store/store/tree-op-table-shared.ts';
import type { CascadedTableFormatting } from './style-cascade.ts';
import { readMarginSides, type StatedMarginSides } from './table-cell-margins.ts';
import {
  readStatedCellVerticalAlign,
  type CellVerticalAlign,
} from './table-cell-vertical-align.ts';

type TableStyle = Pick<CascadedTableFormatting, 'tableCellPropertyNodes' | 'conditional'>;

const NO_SIDES: StatedMarginSides = Object.freeze({});

interface WholeTableCellProperties {
  readonly margins: StatedMarginSides;
  readonly vAlign: CellVerticalAlign | undefined;
  /** Whether a conditional format states `w:tcMar` or `w:vAlign` at all. */
  readonly conditionalMargins: boolean;
  readonly conditionalAlign: boolean;
}

// A resolved style is one frozen object shared by every table that names it
// (`cascadeTableFormatting`), so its whole-table answer is read once.
const wholeTable = new WeakMap<object, WholeTableCellProperties>();

function wholeTableCellProperties(style: TableStyle): WholeTableCellProperties {
  const known = wholeTable.get(style);
  if (known) return known;
  let margins = NO_SIDES;
  let vAlign: CellVerticalAlign | undefined;
  // Base style first: a derived style replaces a side or the alignment its base states and
  // keeps the rest.
  for (const node of style.tableCellPropertyNodes ?? []) {
    const box = childNamed(node, 'tcMar');
    if (box) margins = { ...margins, ...readMarginSides(box) };
    vAlign = readStatedCellVerticalAlign(node) ?? vAlign;
  }
  let conditionalMargins = false;
  let conditionalAlign = false;
  for (const format of style.conditional.values()) {
    const tcPr = childNamed(format, 'tcPr');
    if (!tcPr) continue;
    conditionalMargins ||= childNamed(tcPr, 'tcMar') !== undefined;
    conditionalAlign ||= readStatedCellVerticalAlign(tcPr) !== undefined;
  }
  const resolved = { margins, vAlign, conditionalMargins, conditionalAlign };
  wholeTable.set(style, resolved);
  return resolved;
}

/**
 * The cell margins a table style gives every cell of one row.
 *
 * `cellConditions` lists the active conditional formats of each cell of the row, in cell
 * order, each list weakest first (`conditionalTypesFor`). A style holds one set of cell
 * margins per row, so
 * a conditional `w:tcMar` reaches the whole row of a cell it covers: a first-column left
 * margin insets every cell of every row, and a corner-cell margin insets its whole row. The
 * cells write their formats' sides into the row's set in order, so a later cell replaces a
 * side an earlier cell wrote. A side stated without a width clears that side: the row then
 * takes the table-level margin for it.
 */
export function rowStyleCellMargins(
  style: TableStyle,
  cellConditions: readonly (readonly string[])[]
): StatedMarginSides {
  const whole = wholeTableCellProperties(style);
  if (!whole.conditionalMargins) return whole.margins;
  let margins = whole.margins;
  for (const conditions of cellConditions) {
    for (const condition of conditions) {
      const format = style.conditional.get(condition);
      const box = format && conditionalMarginBox(format);
      if (box) margins = { ...margins, ...readMarginSides(box) };
    }
  }
  return margins;
}

function conditionalMarginBox(format: OoxmlElement): OoxmlElement | undefined {
  const tcPr = childNamed(format, 'tcPr');
  return tcPr && childNamed(tcPr, 'tcMar');
}

/**
 * The vertical alignment a table style gives one cell, or undefined when it states none.
 *
 * `conditions` lists the cell's active conditional formats, weakest first
 * (`conditionalTypesFor`). A whole-table `center` or `bottom` holds for every cell: a
 * conditional format does not replace it, unlike the layering of 17.7.6. Without one, the
 * strongest active conditional format that states `w:vAlign` decides, and a conditional `top`
 * counts.
 */
export function styleCellVerticalAlign(
  style: TableStyle,
  conditions: readonly string[]
): CellVerticalAlign | undefined {
  const whole = wholeTableCellProperties(style);
  if (whole.vAlign === 'center' || whole.vAlign === 'bottom') return whole.vAlign;
  let vAlign: CellVerticalAlign | undefined = whole.vAlign;
  if (!whole.conditionalAlign) return vAlign;
  for (const condition of conditions) {
    const format = style.conditional.get(condition);
    const tcPr = format && childNamed(format, 'tcPr');
    vAlign = readStatedCellVerticalAlign(tcPr) ?? vAlign;
  }
  return vAlign;
}
