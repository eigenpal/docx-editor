// How an autofit table with a preferred width on every column settles: from those preferred
// widths, not from the grid the width resolver already scaled to the table's width.
import type { SemanticTableCell, SemanticTableStructure } from './semantic-table.ts';
import { spreadPreferredColumns } from './table-autofit-distribution.ts';
import type { AutofitColumnContent } from './table-autofit-widths.ts';
import { cellContentInsets } from './table-cell-geometry.ts';
import { legacyLeadingInsetPt, legacyTrailingInsetPt } from './table-origin.ts';

/**
 * The cell's horizontal insets after widening. A narrow table may share its grid lines or
 * keep legacy content alignment, and widening can end either; the larger insets of the two
 * geometries keep the word that widened the column whole in both.
 */
export function widenedCellInsets(
  cell: SemanticTableCell,
  collapsed: boolean,
  current: { readonly left: number; readonly right: number }
) {
  if (!cell.centeredSideRules && !cell.legacyContentAlignment) return current;
  const { centeredSideRules: _centered, legacyContentAlignment: _legacy, ...plain } = cell;
  const fullStroke = cellContentInsets(plain, collapsed);
  return {
    left: Math.max(current.left, fullStroke.left),
    right: Math.max(current.right, fullStroke.right),
  };
}

/**
 * How far a resolved column may stray from its scaled preferred width: one twip, the unit
 * both the authored grid and the cell preferences are stated in, so their rounding agrees.
 */
const ONE_TWIP_PT = 1 / 20;

/** The table indent, which moves only a table aligned to its leading edge. */
function leadingIndentPt(structure: SemanticTableStructure): number {
  const leading = structure.bidiVisual ? 'right' : 'left';
  return structure.alignment === leading ? Math.max(0, structure.indentPt) : 0;
}

/**
 * Column widths for a top-level autofit table whose every column has an absolute preferred
 * width, or `undefined` when another rule settles the table.
 *
 * A percentage table settles at the width the resolver gave it, which is its share of its
 * reference box. A table without a width of its own takes its preferred widths, and gives
 * way only where they do not fit its room. Either way the columns start at their preferred
 * widths raised to their minimums (see {@link spreadPreferredColumns}). A nested table keeps
 * the proportional geometry the resolver gives it.
 */
export function preferredSpreadWidths(
  structure: SemanticTableStructure,
  content: Pick<AutofitColumnContent, 'preferredWidths' | 'spans' | 'verticalHolds'>,
  minimums: readonly number[],
  contentWidthPt: number,
  depth: number
): readonly number[] | undefined {
  const { tableWidth, columnWidthsPt } = structure;
  const { preferredWidths } = content;
  const count = columnWidthsPt.length;
  if (
    depth > 0 ||
    structure.layoutFixed ||
    structure.cellSpacingPt !== 0 ||
    structure.float ||
    content.spans.length > 0 ||
    content.verticalHolds.length > 0 ||
    (tableWidth.type !== 'pct' && tableWidth.type !== 'auto') ||
    count === 0 ||
    preferredWidths.length !== count ||
    minimums.length !== count
  )
    return undefined;
  const preferred: number[] = [];
  for (let column = 0; column < count; column++) {
    const width = preferredWidths[column];
    if (width === undefined || !Number.isFinite(width) || width <= 0) return undefined;
    preferred.push(width);
  }
  // The preferred widths must share the shape of the resolved grid; a grid that disagrees
  // with them keeps the resolver's geometry.
  let totalPt = 0;
  let preferredPt = 0;
  for (let column = 0; column < count; column++) {
    totalPt += columnWidthsPt[column]!;
    preferredPt += preferred[column]!;
  }
  const scale = totalPt / preferredPt;
  if (!(scale > 0) || !Number.isFinite(scale)) return undefined;
  const slack = ONE_TWIP_PT * Math.max(1, scale);
  for (let column = 0; column < count; column++)
    if (Math.abs(columnWidthsPt[column]! - preferred[column]! * scale) > slack) return undefined;
  // A table without a width of its own keeps a grid wider than its cells ask for.
  if (tableWidth.type === 'auto' && scale > 1)
    for (let column = 0; column < count; column++) preferred[column] = columnWidthsPt[column]!;
  // A legacy content-aligned table spans the text column plus its outer content insets.
  const outerMargins = structure.legacyContentAlignment
    ? legacyLeadingInsetPt(structure) + legacyTrailingInsetPt(structure)
    : 0;
  const roomPt = Math.max(0, contentWidthPt + outerMargins - leadingIndentPt(structure));
  // Minimums wider than the table keep their width, up to its room or the width it already
  // has, whichever is wider: an indent can leave the text column no room.
  const fitPt = Math.max(roomPt, totalPt);
  if (tableWidth.type === 'auto')
    return spreadPreferredColumns(preferred, minimums, roomPt, fitPt, false);
  return tableWidth.value > 0
    ? spreadPreferredColumns(preferred, minimums, totalPt, fitPt, true)
    : undefined;
}
