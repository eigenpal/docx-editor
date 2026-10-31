import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import type { SemanticTableRow } from './semantic-table.ts';
import type { SideRuleTableShape } from './legacy-table-side-rules.ts';
import { hasSupportedLegacyTableMargins } from './legacy-table-margins.ts';
import { readTableIndentPt } from './table-widths.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';

/** Row exceptions or grid offsets whose geometry the structure reader does not resolve. */
export function hasUnsupportedRowGeometry(table: OoxmlElement): boolean {
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
        value.value !== '0'
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
 * fixed left-aligned left-to-right table takes the rule, and it always aligns the content.
 */
export function legacyFixedTableContentOffset(
  table: OoxmlElement,
  propertyNodes: readonly OoxmlElement[],
  rows: readonly SemanticTableRow[],
  shape: SideRuleTableShape,
  /** A table style applies: a named one, or the document's default table style. */
  styled: boolean
): number | undefined {
  if (
    !hasCompatibilityRule(shape.compatibilityMode, 'fixedTableContentEdgeOrigin') ||
    shape.depth !== 0 ||
    shape.floating ||
    shape.cellSpacingPt !== 0 ||
    (shape.alignment !== 'left' && shape.alignment !== 'right') ||
    // AutoFit takes it with an absolute width only; captured controls cover no other.
    !(shape.widthType === 'dxa' || (shape.layoutFixed && shape.widthType === 'auto')) ||
    // References cover only fixed, left-aligned, left-to-right tables in text boxes.
    (shape.textBox && (!shape.layoutFixed || shape.alignment !== 'left' || shape.bidiVisual)) ||
    !hasSupportedLegacyTableMargins(table, propertyNodes) ||
    hasUnsupportedRowGeometry(table)
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
  if (leadingAlignment && !indentStated && !styled && !shape.textBox) return undefined;
  // The aligned visual edge: a leading alignment is the right edge of a right-to-left table.
  const side = leadingAlignment === shape.bidiVisual ? 'right' : 'left';
  // Rows keep document order with visual grid columns: a right-to-left row lists its visually
  // rightmost cell first.
  const visualLeft = (row: SemanticTableRow) =>
    shape.bidiVisual ? row.cells.at(-1) : row.cells[0];
  const visualRight = (row: SemanticTableRow) =>
    shape.bidiVisual ? row.cells[0] : row.cells.at(-1);
  const edgeCell = side === 'left' ? visualLeft : visualRight;
  const leading = rows[0] && edgeCell(rows[0])?.margins[side];
  if (leading === undefined || !Number.isFinite(leading) || leading < 0) return undefined;
  for (const row of rows) {
    const first = visualLeft(row);
    const last = visualRight(row);
    if (
      !first ||
      !last ||
      first.gridColumn !== 0 ||
      edgeCell(row)?.margins[side] !== leading ||
      last.gridColumn + last.gridSpan !== shape.columnWidthsPt.length
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
        if (
          edge.state === 'edge' &&
          (!['single', 'thick'].includes(edge.style) || margin < edge.widthPt / 2)
        )
          return undefined;
      }
    }
  }
  // The aligned cell's text edge meets the aligned text edge, moved by any indent. The grid
  // stays the same width. Cell margins already start at the centred rule, so they do not add
  // another half-rule.
  return side === 'left' && leading !== 0 ? -leading : leading;
}
