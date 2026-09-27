import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import type { SemanticTableRow } from './semantic-table.ts';
import type { SideRuleTableShape } from './legacy-table-side-rules.ts';
import { hasSupportedLegacyTableMargins } from './legacy-table-margins.ts';
import { readTableIndentPt } from './table-widths.ts';

function hasOmittedGridCells(table: OoxmlElement): boolean {
  const pending = [...table.children];
  let visited = 0;
  while (pending.length > 0) {
    if (++visited > 100_000) return true;
    const node = pending.pop()!;
    if (node.kind === 'textValue' || node.kind === 'paragraph' || node.kind === 'table') continue;
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

/** Resolve the leading content edge of a collapsed, fixed legacy table. */
export function legacyFixedTableContentOffset(
  table: OoxmlElement,
  propertyNodes: readonly OoxmlElement[],
  rows: readonly SemanticTableRow[],
  shape: SideRuleTableShape
): number | undefined {
  if (
    shape.compatibilityMode !== 14 ||
    shape.depth !== 0 ||
    shape.bidiVisual ||
    shape.floating ||
    shape.cellSpacingPt !== 0 ||
    !shape.layoutFixed ||
    shape.alignment !== 'left' ||
    !['auto', 'dxa'].includes(shape.widthType) ||
    !hasSupportedLegacyTableMargins(table, propertyNodes) ||
    hasOmittedGridCells(table)
  )
    return undefined;
  // Invalid indentation is not evidence for moving the grid outside its old origin.
  const direct = table.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'tblPr'
  );
  for (const props of direct && direct.kind !== 'textValue'
    ? [...propertyNodes, direct]
    : propertyNodes) {
    for (const node of props.children) {
      if (node.kind === 'textValue' || node.localName !== 'tblInd') continue;
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
  const leading = rows[0]?.cells[0]?.margins.left;
  if (leading === undefined || !Number.isFinite(leading) || leading < 0) return undefined;
  for (const row of rows) {
    const first = row.cells[0];
    const last = row.cells.at(-1);
    if (
      !first ||
      !last ||
      first.gridColumn !== 0 ||
      first.margins.left !== leading ||
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
      for (const side of ['left', 'right'] as const) {
        const edge = borders[side];
        const margin = cell.margins[side];
        if (!Number.isFinite(margin) || margin < 0) return undefined;
        if (
          edge.state === 'edge' &&
          (!['single', 'thick'].includes(edge.style) || margin < edge.widthPt / 2)
        )
          return undefined;
      }
    }
  }
  // The authored indent places the first cell's text edge. The grid stays the same width.
  // Cell margins already start at the centered rule, so they do not add another half-rule.
  return -leading;
}
