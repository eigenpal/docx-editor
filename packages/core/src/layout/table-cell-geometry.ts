// Cell-box geometry shared by row layout and fragment finalize: where a cell's content box
// sits inside its border box on each page fragment.

import { borderExtentPt, type CellBorderBox, type TableBorderSide } from './table-borders.ts';
import { effectiveBorderSide } from './table-border-cascade.ts';
import type { CellMarginsPt, SemanticTableCell } from './semantic-table.ts';

/** Per-side content inset, including the applicable border clearance. */
export interface CellContentInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export function borderContentInset(
  margin: number,
  edge: CellBorderBox['top'],
  shared = false,
  collapsedHorizontal = false,
  receivingSharedTop = false
): number {
  if (edge.state !== 'edge') return margin;
  // Simple collapsed horizontal strokes extend halfway into each incident cell.
  // Compound strokes can extend beyond the authored edge box into existing padding.
  // Increase the inset only when that padding cannot clear the painted inner stroke.
  // Word converts eighth-point border sizes to integral twips before reserving space.
  // Odd eighths otherwise accumulate half a twip per row across a long table.
  const widthPt = Math.floor(edge.widthPt * 20 + 1e-8) / 20;
  const centered = shared && edge.style !== 'double' && edge.style !== 'triple';
  // Horizontal padding starts at the middle of a collapsed simple side rule.
  // With little/no padding, content must still clear its full painted extent.
  const halfInset =
    shared || (collapsedHorizontal && (edge.style === 'single' || edge.style === 'thick'));
  // An internal double rule is painted by the preceding cell's bottom edge.
  // Its inner stroke extends one authored width below that edge; reserving the
  // top-owned band's two widths charges the following row an extra stroke.
  const extent =
    shared && receivingSharedTop && edge.style === 'double'
      ? borderExtentPt(edge) - edge.widthPt
      : borderExtentPt(edge);
  return Math.max(margin + widthPt * (halfInset ? 0.5 : 1), extent * (centered ? 0.5 : 1));
}

/** True for a rule whose clearance the captured row-band rule covers. */
function simpleBand(edge: CellBorderBox['top']): boolean {
  return edge.state !== 'edge' || (edge.style !== 'double' && edge.style !== 'triple');
}

/**
 * Authored width of a simple collapsed horizontal rule, in points, else `0`.
 *
 * Compound rules answer to their own extent geometry, so they report `0` and leave the band
 * to {@link borderContentInset}. Word converts eighth-point sizes to whole twips before it
 * reserves space, so the same floor applies here or a long table accumulates half a twip
 * per row.
 */
export function simpleBandWidthPt(
  edge: CellBorderBox['top'] | { readonly style: string; readonly widthPt: number } | undefined
): number {
  if (!edge) return 0;
  if ('state' in edge && edge.state !== 'edge') return 0;
  const { style, widthPt } = edge as { style: string; widthPt: number };
  if (style === 'double' || style === 'triple') return 0;
  return Math.floor(widthPt * 20 + 1e-8) / 20;
}

/**
 * The content insets of one cell, including its authored-row band clearance.
 *
 * Prefer this over {@link contentInsets} wherever a `SemanticTableCell` is in hand: it keeps
 * the span-scoped content borders and the row-scoped band clearance together, which a cell
 * that continues a vertical merge carries separately.
 */
export function cellContentInsets(
  cell: SemanticTableCell,
  collapsedBorders: boolean
): CellContentInsets {
  return contentInsets(
    cell.margins,
    cell.contentBorders ?? cell.borders,
    cell.legacyContentAlignment === true && collapsedBorders,
    collapsedBorders,
    cell.contentBottomIsOuter,
    cell.centeredSideRules,
    cell.topBandClearancePt
  );
}

/**
 * Clearance a receiving cell reserves for the collapsed horizontal band above it, in points.
 *
 * A captured reference charges the whole band here, at full width, and charges the row above
 * nothing. What "full width" means follows OOXML's three states, which the controls separate:
 *
 * - the CELL's own `w:val="nil"` is direct formatting, and the cell reserves NOTHING, even
 *   under a 4pt rule that paints across its margin (`.cache/pdf/claude-row-clearance/`, and
 *   `m2` and `m5` in `.cache/pdf/claude-band-mixed/`);
 * - an authored edge is direct formatting too — the cell reserves its OWN width, whatever the
 *   wider neighbour above paints (`m4`, a 4pt bottom over a 1pt top, keeps the 1pt pitch);
 * - anything a TABLE STYLE supplies, including its `nil`, is not direct formatting: the cell
 *   reserves the rule the collapsed grid resolves for it, so a banded row under a style's
 *   header rule is still pushed down by it.
 *
 * `bandPt` is the resolved band's painted width and `tableSide` what an inherited edge falls
 * back to. A vMerge seam paints nothing yet still reserves its inherited rule, which is why
 * the inherited case takes the larger of the two.
 */
export function ownTopBandWidthPt(
  own: TableBorderSide,
  aboveBottom: TableBorderSide,
  tableSide: TableBorderSide,
  bandPt = 0,
  suppressedByCell = false
): number {
  if (suppressedByCell) return 0;
  if (own.state === 'edge') return simpleBandWidthPt(own);
  if (aboveBottom.state === 'none') return 0;
  return Math.max(simpleBandWidthPt(effectiveBorderSide(own, tableSide)), bandPt);
}

export function contentInsets(
  margins: CellMarginsPt,
  borders: SemanticTableCell['borders'],
  legacyCollapsedContentAlignment = false,
  collapsedBorders = true,
  bottomIsOuter = false,
  centeredSideRules = false,
  topBandClearancePt?: number
): CellContentInsets {
  const leftExtent = borderExtentPt(borders.left);
  const rightExtent = borderExtentPt(borders.right);
  const simpleRules = [borders.left, borders.right].every(
    (edge) => edge.state !== 'edge' || edge.style === 'single' || edge.style === 'thick'
  );
  // The admitted legacy table's margins already start at the collapsed grid lines. Only
  // reuse that budget when BOTH margins clear their full painted strokes; thick/asymmetric cases
  // keep the existing conservative inset. This is not a general Word border-box model.
  const marginCoversRules =
    legacyCollapsedContentAlignment &&
    simpleRules &&
    margins.left >= leftExtent &&
    margins.right >= rightExtent;
  // Collapsed horizontal rules are shared by adjacent rows. Each row reserves half
  // the authored thickness; separated cells reserve an independent full border.
  // A captured reference charges a collapsed horizontal band ENTIRELY to the row below it,
  // at that row's own authored top rule, and charges the row above nothing. Compound rules
  // keep their own extent geometry on both sides.
  const band = collapsedBorders && topBandClearancePt !== undefined;
  const bandTop = band && simpleBand(borders.top);
  const bandBottom = band && !bottomIsOuter && simpleBand(borders.bottom);
  return {
    top: bandTop
      ? margins.top + topBandClearancePt
      : borderContentInset(margins.top, borders.top, collapsedBorders, false, true),
    right:
      centeredSideRules && collapsedBorders
        ? Math.max(margins.right, rightExtent / 2)
        : marginCoversRules
          ? margins.right
          : borderContentInset(margins.right, borders.right, false, collapsedBorders),
    bottom: bandBottom
      ? margins.bottom
      : borderContentInset(margins.bottom, borders.bottom, collapsedBorders && !bottomIsOuter),
    left:
      centeredSideRules && collapsedBorders
        ? Math.max(margins.left, leftExtent / 2)
        : marginCoversRules
          ? margins.left
          : borderContentInset(margins.left, borders.left, false, collapsedBorders),
  };
}
