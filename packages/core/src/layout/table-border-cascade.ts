// Layering border boxes across the table style cascade.
//
// Separate from `table-borders.ts`, which decides which of two ADJACENT cells owns the rule
// between them. This is the earlier question: what a table or cell's borders are once the
// style it names, the conditional formats that style carries, and its own properties have
// all had their say.

import type { CellBorderBox, TableBorderBox, TableBorderSide } from './table-borders.ts';

const later = (base: TableBorderSide, over: TableBorderSide): TableBorderSide =>
  over.state === 'omitted' ? base : over;

/**
 * Layer one border box over another: a side the later box OMITS inherits.
 *
 * This is what makes a table style visible. Word writes the grid into the style's
 * `w:tblBorders` and the document says only `<w:tblStyle w:val="TableGrid"/>`, so a reader
 * that looks at the table's own `w:tblPr` alone draws nothing at all. An explicit `none`
 * is not an omission — it is the document turning the inherited rule off.
 */
export function mergeTableBorders(base: TableBorderBox, over: TableBorderBox): TableBorderBox {
  const side = later;
  return {
    top: side(base.top, over.top),
    left: side(base.left, over.left),
    bottom: side(base.bottom, over.bottom),
    right: side(base.right, over.right),
    insideH: side(base.insideH, over.insideH),
    insideV: side(base.insideV, over.insideV),
  };
}

/** The same layering for a cell box, which has no interior sides. */
export function mergeCellBorders(base: CellBorderBox, over: CellBorderBox): CellBorderBox {
  const side = later;
  return {
    top: side(base.top, over.top),
    left: side(base.left, over.left),
    bottom: side(base.bottom, over.bottom),
    right: side(base.right, over.right),
  };
}
