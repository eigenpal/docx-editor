import { WML_NAMESPACE_URI, type OoxmlElement } from '../store/package/ooxml-tree.ts';
import { attributeValueOf } from '../store/store/tree-op-nodes.ts';
import { wordBorderCss } from './clipboard-html-word-elements.ts';
import { wmlChild } from './clipboard-html-write-tree.ts';

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
  rowSpan: number,
  firstGridColumn: boolean,
  lastGridColumn: boolean
): string {
  const rules: string[] = [];
  const tcBorders = wmlChild(tcPr, 'tcBorders');
  const tableEdges = {
    top: rowIndex === 0 ? 'top' : 'insideH',
    bottom: rowIndex + rowSpan >= rowCount ? 'bottom' : 'insideH',
    left: firstGridColumn ? 'left' : 'insideV',
    right: lastGridColumn ? 'right' : 'insideV',
  } as const;
  for (const edge of ['top', 'left', 'bottom', 'right'] as const) {
    // An explicit cell `nil`/`none` SUPPRESSES the edge; only an absent cell border
    // falls back to the table grid.
    const cellEdge = wmlChild(tcBorders, edge);
    const border =
      cellEdge !== null
        ? wordBorderCss(cellEdge)
        : wordBorderCss(wmlChild(tblBorders, tableEdges[edge]));
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
