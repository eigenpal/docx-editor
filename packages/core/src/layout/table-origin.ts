import type {
  SemanticTableStructure,
  TableAnchorFrames,
  TableFloatPosition,
} from './semantic-table.ts';
import { contentInsets } from './table-cell-geometry.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';

/**
 * Where a table's left edge sits, floated or not.
 *
 * Before mode 15 a floating table aligns its cell content, not its outer edges. A numeric
 * text anchor positions the first row's leading cell content edge. A right or outside
 * alignment, against any anchor, moves the table right by its own right cell margin, so its
 * content ends at the frame edge. A table whose wrap band already covers the text column's
 * leading edge keeps its outer edge, and so its place across the column.
 */
export function positionedTableOriginX(
  structure: SemanticTableStructure,
  frames: TableAnchorFrames,
  compatibilityMode?: number
): number {
  const float = structure.float;
  if (!float) return frames.text.left + tableOriginX(structure, frames.text.width);
  const width = structure.columnWidthsPt.reduce((sum, column) => sum + column, 0);
  const origin = tableFloatOriginX(float, width, frames);
  const first = structure.rows[0]?.cells[0];
  if (
    !hasCompatibilityRule(compatibilityMode, 'floatingTableContentOrigin') ||
    structure.bidiVisual ||
    structure.cellSpacingPt !== 0
  )
    return origin;
  // A right alignment moves by the table's own right cell margin, not a cell's `w:tcMar`.
  if (float.xSpec === 'right' || float.xSpec === 'outside') {
    if (origin - (float.distances?.left ?? 0) <= frames.text.left) return origin;
    return origin + structure.defaultMargins.right;
  }
  if (!first || first.gridColumn !== 0) return origin;
  if (float.horzAnchor !== 'text' || float.vertAnchor !== 'text' || float.xSpec !== undefined)
    return origin;
  const inset = contentInsets(first.margins, first.contentBorders ?? first.borders).left;
  return Math.max(frames.page.left, origin - inset);
}

/** The painted width of a simple side rule, else `0`. */
function simpleRulePt(
  edge: { readonly state: string; readonly style?: string; readonly widthPt?: number } | undefined
): number {
  if (edge?.state !== 'edge' || (edge.style !== 'single' && edge.style !== 'thick')) return 0;
  return Number.isFinite(edge.widthPt) && edge.widthPt! > 0 ? edge.widthPt! : 0;
}

/**
 * Where a table's left edge sits inside the box that contains it.
 *
 * Ordinary left-aligned tables start at their indent, which may be negative and is not
 * limited to the remaining width. Centered and right-aligned left-to-right tables use the
 * remaining width and ignore the indent. `outerRuleOffsetPt` then moves the grid inward by
 * half the outer side rule where the table puts that rule's outer edge on the aligned edge.
 * For a supported mode-14 fixed table, that offset instead aligns the first cell's content.
 * A legacy content-aligned table instead puts the content edge of its leading or trailing
 * cell on the aligned edge of the text column; its indent still applies from the leading edge.
 */
export function tableOriginX(structure: SemanticTableStructure, containerWidthPt: number): number {
  const width = structure.columnWidthsPt.reduce((sum, column) => sum + column, 0);
  const slack = containerWidthPt - width;
  if (!Number.isFinite(slack)) return 0;
  if (structure.legacyContentAlignment && structure.alignment !== 'center') {
    // The leading or trailing cell's content edge sits on the aligned text edge. The indent
    // moves the table from its leading edge.
    const leading = structure.rows[0]?.cells[0];
    const last = structure.rows[0]?.cells.at(-1)?.margins.right ?? 0;
    // A left-to-right table's content starts at the margin, or at its centred outer rule's
    // inner half where the margin is narrower.
    const first = Math.max(
      leading?.margins.left ?? 0,
      structure.bidiVisual
        ? 0
        : simpleRulePt((leading?.contentBorders ?? leading?.borders)?.left) / 2
    );
    if (structure.alignment === 'left')
      return structure.bidiVisual ? -first : structure.indentPt - first;
    if (structure.bidiVisual) return slack + last - structure.indentPt;
    return structure.legacyTrailingOuterEdge ? slack : slack + last;
  }
  if (structure.alignment === 'center')
    return slack / 2 + (structure.bidiVisual ? (structure.outerRuleOffsetPt ?? 0) : 0);
  // Travels with the cell insets that `withSharedGridLineSideRules` gives the same table.
  const ruleOffset = structure.outerRuleOffsetPt ?? 0;
  // A bidiVisual table aligned to its leading (right) edge measures the indent from that edge.
  if (structure.alignment === 'right')
    return structure.bidiVisual ? slack - structure.indentPt + ruleOffset : slack + ruleOffset;
  if (structure.bidiVisual) return ruleOffset;
  // Captured controls apply the whole indent whatever the table width: a negative indent
  // pulls the table into the leading margin, and a positive one can push it past the
  // trailing edge. `readTableIndentPt` bounds the value.
  return structure.indentPt + ruleOffset;
}

/**
 * Where a floated table's left edge sits, in the coordinates layout reports boxes in.
 *
 * `w:tblpXSpec` aligns the table inside its anchor box; `w:tblpX` offsets it from that
 * box's leading edge instead. `inside`/`outside` are the mirrored-margin spellings of
 * `left`/`right` and render as those — the odd/even page flip they ask for only exists in
 * a document with mirrored margins, which this layout does not model.
 *
 * The result keeps the table's leading edge on the sheet whatever the file states, so a
 * hostile offset moves the table rather than painting it off the page entirely.
 */
export function tableFloatOriginX(
  float: TableFloatPosition,
  tableWidthPt: number,
  frames: TableAnchorFrames
): number {
  const frame = frames[float.horzAnchor];
  const slack = frame.width - tableWidthPt;
  let x: number;
  if (float.xSpec === 'center') x = frame.left + slack / 2;
  else if (float.xSpec === 'right' || float.xSpec === 'outside') x = frame.left + slack;
  else if (float.xSpec) x = frame.left;
  else x = frame.left + float.xPt;
  if (!Number.isFinite(x)) return frame.left;
  const pageRight = frames.page.left + frames.page.width;
  return Math.max(frames.page.left, Math.min(x, pageRight));
}
