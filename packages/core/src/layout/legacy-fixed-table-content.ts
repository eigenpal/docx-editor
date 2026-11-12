import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import type { SemanticTableCell, SemanticTableRow } from './semantic-table.ts';
import type { TableBorderBox } from './table-borders.ts';
import { cellContentInsets } from './table-cell-geometry.ts';
import { cellSpacingGeometry } from './table-cell-spacing.ts';
import { withSpacingFrame } from './table-spacing-frame.ts';
import { outerBandPt } from './table-spacing-band.ts';
import type { SideRuleTableShape } from './legacy-table-side-rules.ts';
import { hasSupportedLegacyTableMargins } from './legacy-table-margins.ts';
import { readTableIndentPt } from './table-widths.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';

/** Row exceptions or grid offsets whose geometry the structure reader does not resolve. */
export function hasUnsupportedRowGeometry(table: OoxmlElement, allowGridSkips = false): boolean {
  const pending = [...table.children];
  let visited = 0;
  while (pending.length > 0) {
    if (++visited > 100_000) return true;
    const node = pending.pop()!;
    if (node.kind === 'textValue' || node.kind === 'paragraph' || node.kind === 'table') continue;
    // Row exceptions are preserved, but the structure reader does not resolve their geometry.
    if (
      node.localName === 'tblPrEx' &&
      node.children.some(
        (child) =>
          child.kind !== 'textValue' &&
          [
            'tblW',
            'jc',
            'tblCellSpacing',
            'tblInd',
            'tblBorders',
            'tblLayout',
            'tblCellMar',
          ].includes(child.localName)
      )
    )
      return true;
    if (node.localName === 'gridBefore' || node.localName === 'gridAfter') {
      const value = node.attributes.find((attr) => attr.localName === 'val');
      if (
        node.namespaceUri !== WML_NAMESPACE_URI ||
        value?.namespaceUri !== WML_NAMESPACE_URI ||
        (value.value !== '0' && !(allowGridSkips && /^\d{1,4}$/.test(value.value)))
      )
        return true;
    }
    for (const child of node.children) pending.push(child);
  }
  return false;
}

/**
 * Where a collapsed legacy table with an absolute or automatic width puts its grid: the offset
 * from its aligned place that moves the content edge of its aligned outer cell onto the text
 * edge, or `undefined` to keep the outer edge there.
 *
 * Fixed and AutoFit layouts behave alike for a `dxa` width; a fixed table also takes it with an
 * `auto` width. A trailing alignment (right in a left-to-right
 * table, left in a right-to-left one) always aligns the content. A leading alignment aligns
 * the content when an indent is stated, directly or by a table style, or a table style
 * applies; a table with neither puts its outer edge on the text edge. In a text box, only a
 * leading alignment takes the rule, and it always aligns the content.
 *
 * A table with cell spacing aligns the content of its aligned outer cell the same way, so its
 * frame reaches past the text edge by the spacing gap, the frame rule and the cell inset.
 * Rows that skip grid columns (`w:gridBefore`, `w:gridAfter`) follow the grid; the aligned
 * cell is the first one on the aligned grid edge, and every cell there must agree.
 */
export function legacyFixedTableContentOffset(
  table: OoxmlElement,
  propertyNodes: readonly OoxmlElement[],
  rows: readonly SemanticTableRow[],
  shape: SideRuleTableShape,
  /** A table style applies: a named one, or the document's default table style. */
  styled: boolean,
  /** The table's outer and inside borders, which place the cells of a spaced table. */
  tableBorders?: TableBorderBox
): number | undefined {
  const spaced = shape.cellSpacingPt !== 0;
  if (
    !hasCompatibilityRule(shape.compatibilityMode, 'fixedTableContentEdgeOrigin') ||
    shape.depth !== 0 ||
    shape.floating ||
    (spaced && (!tableBorders || shape.bidiVisual || shape.textBox)) ||
    (shape.alignment !== 'left' && shape.alignment !== 'right') ||
    // AutoFit takes it with an absolute width only; captured controls cover no other. A
    // spaced table takes it with an automatic or a percentage width too.
    !(
      shape.widthType === 'dxa' ||
      ((shape.layoutFixed || spaced) && shape.widthType === 'auto') ||
      (spaced && shape.widthType === 'pct')
    ) ||
    // In a text box only a leading alignment aligns the content; a trailing one keeps the
    // outer edge on the trailing text edge.
    (shape.textBox && shape.alignment !== 'left') ||
    !hasSupportedLegacyTableMargins(table, propertyNodes) ||
    hasUnsupportedRowGeometry(table, !shape.bidiVisual)
  )
    return undefined;
  const leadingAlignment = shape.alignment === 'left';
  let indentStated = false;
  // Invalid indentation is not evidence for moving the grid outside its old origin.
  const direct = table.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'tblPr'
  );
  for (const props of direct && direct.kind !== 'textValue'
    ? [...propertyNodes, direct]
    : propertyNodes) {
    for (const node of props.children) {
      if (node.kind === 'textValue' || node.localName !== 'tblInd') continue;
      indentStated = true;
      const types = node.attributes.filter((attr) => attr.localName === 'type');
      const widths = node.attributes.filter((attr) => attr.localName === 'w');
      if (
        node.namespaceUri !== WML_NAMESPACE_URI ||
        types.length > 1 ||
        widths.length !== 1 ||
        widths[0]!.namespaceUri !== WML_NAMESPACE_URI ||
        (types[0] && (types[0].namespaceUri !== WML_NAMESPACE_URI || types[0].value !== 'dxa')) ||
        readTableIndentPt(node, 31_680 / 20) === undefined
      )
        return undefined;
    }
  }
  if (leadingAlignment && !indentStated && !styled && !shape.textBox) {
    // A spaced table keeps its outer edge at the text edge, less half its leading frame rule.
    const half = spaced ? outerBandPt(tableBorders!.left) / 2 : 0;
    return half > 0 ? -half : undefined;
  }
  // The aligned visual edge: a leading alignment is the right edge of a right-to-left table.
  const side = leadingAlignment === shape.bidiVisual ? 'right' : 'left';
  // Rows keep document order with visual grid columns: a right-to-left row lists its visually
  // rightmost cell first.
  const visualLeft = (row: SemanticTableRow) =>
    shape.bidiVisual ? row.cells.at(-1) : row.cells[0];
  const visualRight = (row: SemanticTableRow) =>
    shape.bidiVisual ? row.cells[0] : row.cells.at(-1);
  const columns = shape.columnWidthsPt.length;
  // Whether a row's cell on the aligned side reaches the aligned grid edge.
  const reachesEdge = (row: SemanticTableRow): boolean => {
    const cell = side === 'left' ? visualLeft(row) : visualRight(row);
    return side === 'left'
      ? cell?.gridColumn === 0
      : cell !== undefined && cell.gridColumn + cell.gridSpan === columns;
  };
  const edgeRow = rows.find(reachesEdge);
  const edgeCell = side === 'left' ? visualLeft : visualRight;
  const leading = edgeRow && edgeCell(edgeRow)?.margins[side];
  if (leading === undefined || !Number.isFinite(leading) || leading < 0) return undefined;
  // A spaced table places its cells by the first edge row's borders; rows whose edge cells
  // draw another width are unmeasured, so they keep the outer edge.
  const edgeRuleOf = (row: SemanticTableRow): number => {
    const borders = edgeCell(row)?.contentBorders ?? edgeCell(row)?.borders;
    const edge = borders?.[side];
    return edge?.state === 'edge' ? edge.widthPt : 0;
  };
  const edgeRule = edgeRow && edgeRuleOf(edgeRow);
  for (const row of rows) {
    const first = visualLeft(row);
    const last = visualRight(row);
    if (
      !first ||
      !last ||
      (reachesEdge(row) && edgeCell(row)?.margins[side] !== leading) ||
      (spaced && reachesEdge(row) && edgeRuleOf(row) !== edgeRule) ||
      (shape.bidiVisual && (first.gridColumn !== 0 || last.gridColumn + last.gridSpan !== columns))
    )
      return undefined;
    for (const cell of row.cells) {
      if (cell.vMergeContinue) continue;
      const borders = cell.contentBorders ?? cell.borders;
      if (
        borders.left.state === 'edge' &&
        borders.right.state === 'edge' &&
        borders.left.widthPt !== borders.right.widthPt
      )
        return undefined;
      for (const cellSide of ['left', 'right'] as const) {
        const edge = borders[cellSide];
        const margin = cell.margins[cellSide];
        if (!Number.isFinite(margin) || margin < 0) return undefined;
        if (edge.state === 'edge' && !['single', 'thick'].includes(edge.style)) return undefined;
      }
    }
  }
  // The aligned cell's text edge meets the aligned text edge, moved by any indent. The grid
  // stays the same width. Cell margins already start at the centred rule, so they do not add
  // another half-rule; a leading side whose margin is narrower than that half starts its
  // text at the half. A trailing side places by its margin alone.
  const edge = edgeRow && edgeCell(edgeRow);
  if (!edge) return undefined;
  const rule = (edge.contentBorders ?? edge.borders)[side];
  const inset = spaced
    ? spacedContentInsetPt(rows, edge, side, shape, tableBorders!)
    : leadingAlignment && rule.state === 'edge'
      ? Math.max(leading, rule.widthPt / 2)
      : leading;
  if (inset === undefined) return undefined;
  return side === 'left' && inset !== 0 ? -inset : inset;
}

/**
 * How far the content edge of a spaced table's outer cell sits in from the table's outer edge
 * on `side`: the frame, the spacing gaps and the cell's own content inset, as layout places
 * them (`table-cell-spacing.ts`).
 */
function spacedContentInsetPt(
  rows: readonly SemanticTableRow[],
  cell: SemanticTableCell,
  side: 'left' | 'right',
  shape: SideRuleTableShape,
  borders: TableBorderBox
): number | undefined {
  const frame = withSpacingFrame(rows.slice(0, 1), borders, shape.cellSpacingPt)[0]?.spacingFrame;
  const geometry = cellSpacingGeometry(shape.columnWidthsPt, shape.cellSpacingPt, frame);
  if (!geometry) return undefined;
  const insets = cellContentInsets(cell, false);
  if (side === 'left') return geometry.cellLeft(cell.gridColumn) + insets.left;
  const total = shape.columnWidthsPt.reduce((sum, width) => sum + width, 0);
  const right =
    geometry.cellLeft(cell.gridColumn) + geometry.cellWidth(cell.gridColumn, cell.gridSpan);
  // The content ends past the text edge by the first column's frame part less the last
  // column's: measured with 0.5 and 6pt outer rules on either side, absolute and percentage
  // widths, to within 0.25pt. Equal outer rules leave the content on the text edge.
  const inset = total - right + insets.right + geometry.leadPt - geometry.trailPt;
  return Number.isFinite(inset) ? inset : undefined;
}
