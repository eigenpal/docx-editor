import type {
  SemanticTableStructure,
  TableAnchorFrames,
  TableFloatPosition,
} from './semantic-table.ts';
import { contentInsets } from './table-cell-geometry.ts';

/** Legacy numeric text anchors position the first cell's content, not its outer edge. */
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
    (compatibilityMode !== undefined && ![11, 12, 14].includes(compatibilityMode)) ||
    structure.bidiVisual ||
    structure.cellSpacingPt !== 0 ||
    float.horzAnchor !== 'text' ||
    float.vertAnchor !== 'text' ||
    float.xSpec !== undefined ||
    !first ||
    first.gridColumn !== 0
  )
    return origin;
  const inset = contentInsets(first.margins, first.contentBorders ?? first.borders).left;
  return Math.max(frames.page.left, origin - inset);
}

/**
 * Where a table's left edge sits inside the box that contains it.
 *
 * Ordinary left-aligned tables start at their indent, which may be negative and is not
 * limited to the remaining width. Centered and right-aligned left-to-right tables use the
 * remaining width and ignore the indent. `outerRuleOffsetPt` then moves the grid inward by
 * half the outer side rule where the table puts that rule's outer edge on the aligned edge.
 * A verified legacy content-aligned table instead aligns the leading cell's content edge
 * with the text column, without changing its indent.
 */
export function tableOriginX(structure: SemanticTableStructure, containerWidthPt: number): number {
  if (structure.legacyContentAlignment && structure.alignment === 'left')
    return -(structure.rows[0]?.cells[0]?.margins.left ?? 0);
  const width = structure.columnWidthsPt.reduce((sum, column) => sum + column, 0);
  const slack = containerWidthPt - width;
  if (!Number.isFinite(slack)) return 0;
  if (structure.alignment === 'center') return slack / 2;
  // Travels with the cell insets that `withSharedGridLineSideRules` gives the same table.
  const ruleOffset = structure.outerRuleOffsetPt ?? 0;
  // A bidiVisual table aligned to its leading (right) edge measures the indent from that edge.
  if (structure.alignment === 'right')
    return structure.bidiVisual ? slack - structure.indentPt : slack + ruleOffset;
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
