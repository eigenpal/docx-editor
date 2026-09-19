// Cell-box geometry shared by row layout and fragment finalize: where a cell's content box
// sits inside its border box on each page fragment.

import { borderExtentPt, type CellBorderBox } from './table-borders.ts';
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
  collapsedHorizontal = false
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
  return Math.max(
    margin + widthPt * (halfInset ? 0.5 : 1),
    borderExtentPt(edge) * (centered ? 0.5 : 1)
  );
}

export function contentInsets(
  margins: CellMarginsPt,
  borders: SemanticTableCell['borders'],
  legacyCollapsedContentAlignment = false,
  collapsedBorders = true
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
  return {
    top: borderContentInset(margins.top, borders.top, collapsedBorders),
    right: marginCoversRules
      ? margins.right
      : borderContentInset(margins.right, borders.right, false, collapsedBorders),
    bottom: borderContentInset(margins.bottom, borders.bottom, collapsedBorders),
    left: marginCoversRules
      ? margins.left
      : borderContentInset(margins.left, borders.left, false, collapsedBorders),
  };
}
