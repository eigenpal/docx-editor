import { WML_NAMESPACE_URI, type OoxmlElement } from '../store/package/ooxml-tree.ts';
import { attributeValueOf } from '../store/store/tree-op-nodes.ts';
import { wordBorderCss } from './clipboard-html-word-elements.ts';

function wmlChild(parent: OoxmlElement | null, localName: string): OoxmlElement | null {
  if (parent === null) return null;
  for (const child of parent.children) {
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === localName
    ) {
      return child;
    }
  }
  return null;
}

function intAttribute(element: OoxmlElement | null, name: string): number | null {
  if (element === null) return null;
  const raw = attributeValueOf(element, name, WML_NAMESPACE_URI);
  if (raw === undefined || !/^-?\d{1,9}$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) ? value : null;
}

function colorAttribute(element: OoxmlElement | null, name: string): string | null {
  if (element === null) return null;
  const raw = attributeValueOf(element, name, WML_NAMESPACE_URI);
  return raw !== undefined && /^[0-9A-Fa-f]{6}$/.test(raw) ? `#${raw.toLowerCase()}` : null;
}

function pointsFromTwips(value: number): string {
  return `${Math.round((value / 20) * 100) / 100}pt`;
}

export function wordTableCellCss(
  tcPr: OoxmlElement | null,
  tblBorders: OoxmlElement | null,
  rowIndex: number,
  rowCount: number,
  cellIndex: number,
  cellCount: number
): string {
  const rules: string[] = [];
  const tcBorders = wmlChild(tcPr, 'tcBorders');
  const tableEdges = {
    top: rowIndex === 0 ? 'top' : 'insideH',
    bottom: rowIndex === rowCount - 1 ? 'bottom' : 'insideH',
    left: cellIndex === 0 ? 'left' : 'insideV',
    right: cellIndex === cellCount - 1 ? 'right' : 'insideV',
  } as const;
  for (const edge of ['top', 'left', 'bottom', 'right'] as const) {
    const border =
      wordBorderCss(wmlChild(tcBorders, edge)) ??
      wordBorderCss(wmlChild(tblBorders, tableEdges[edge]));
    if (border) rules.push(`border-${edge}:${border}`);
  }
  const fill = colorAttribute(wmlChild(tcPr, 'shd'), 'fill');
  if (fill) rules.push(`background-color:${fill}`);
  const vAlignNode = wmlChild(tcPr, 'vAlign');
  const vAlign =
    vAlignNode === null ? undefined : attributeValueOf(vAlignNode, 'val', WML_NAMESPACE_URI);
  if (vAlign === 'center') rules.push('vertical-align:middle');
  else if (vAlign === 'bottom' || vAlign === 'top') rules.push(`vertical-align:${vAlign}`);
  const tcW = wmlChild(tcPr, 'tcW');
  const width = intAttribute(tcW, 'w');
  const widthType = tcW === null ? undefined : attributeValueOf(tcW, 'type', WML_NAMESPACE_URI);
  if (width !== null && width > 0 && (widthType === undefined || widthType === 'dxa')) {
    rules.push(`width:${pointsFromTwips(width)}`);
  }
  const margins = wmlChild(tcPr, 'tcMar');
  for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
    const margin = wmlChild(margins, edge);
    const value = intAttribute(margin, 'w');
    const type = margin === null ? undefined : attributeValueOf(margin, 'type', WML_NAMESPACE_URI);
    if (value !== null && value >= 0 && type === 'dxa') {
      rules.push(`padding-${edge}:${pointsFromTwips(value)}`);
    }
  }
  return rules.join(';');
}
