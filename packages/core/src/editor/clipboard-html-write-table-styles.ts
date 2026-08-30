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

export interface TableConditionalFormats {
  readonly firstRowFill: string | null;
  readonly firstColumnFill: string | null;
  readonly band1Fill: string | null;
  readonly band2Fill: string | null;
  readonly firstRowEnabled: boolean;
  readonly firstColumnEnabled: boolean;
  readonly bandingEnabled: boolean;
}

/** `w:tblLook` flags: modern boolean attributes, or the legacy `w:val` bitmask. */
function tblLookFlag(tblLook: OoxmlElement | null, name: string, bit: number): boolean | null {
  if (tblLook === null) return null;
  const attr = attributeValueOf(tblLook, name, WML_NAMESPACE_URI);
  // ST_OnOff: anything except an explicit off value is on, like the painter reads it.
  if (attr !== undefined) return !(attr === '0' || attr === 'false' || attr === 'off');
  // The legacy bitmask is ST_ShortHexNumber: at most 4 hex digits, like the painter.
  const raw = attributeValueOf(tblLook, 'val', WML_NAMESPACE_URI);
  if (raw === undefined || !/^[0-9A-Fa-f]{1,4}$/.test(raw)) return null;
  return (Number.parseInt(raw, 16) & bit) !== 0;
}

/**
 * The `w:tblStylePr` shading a table style declares for the first row and the
 * horizontal bands, gated by `w:tblLook` — the visible half of Word's conditional
 * table formatting, so a banded built-in style does not copy as a plain grid.
 */
export function tableConditionalFormats(
  chain: readonly OoxmlElement[],
  tblLook: OoxmlElement | null
): TableConditionalFormats {
  let firstRowFill: string | null = null;
  let firstColumnFill: string | null = null;
  let band1Fill: string | null = null;
  let band2Fill: string | null = null;
  for (const style of chain) {
    for (const child of style.children) {
      if (
        child.kind === 'textValue' ||
        child.localName !== 'tblStylePr' ||
        child.namespaceUri !== WML_NAMESPACE_URI
      ) {
        continue;
      }
      const type = attributeValueOf(child, 'type', WML_NAMESPACE_URI);
      const fill = colorAttribute(wmlChild(wmlChild(child, 'tcPr'), 'shd'), 'fill');
      if (fill === null) continue;
      if (type === 'firstRow') firstRowFill = fill;
      else if (type === 'firstCol') firstColumnFill = fill;
      else if (type === 'band1Horz') band1Fill = fill;
      else if (type === 'band2Horz') band2Fill = fill;
    }
  }
  return {
    firstRowFill,
    firstColumnFill,
    band1Fill,
    band2Fill,
    firstRowEnabled: tblLookFlag(tblLook, 'firstRow', 0x0020) ?? false,
    firstColumnEnabled: tblLookFlag(tblLook, 'firstColumn', 0x0080) ?? false,
    bandingEnabled: !(tblLookFlag(tblLook, 'noHBand', 0x0200) ?? false),
  };
}

/** The style-conditional fill for one cell, or null when nothing applies. Word's
 *  precedence puts the first row over the first column over the row bands. */
export function conditionalCellFill(
  formats: TableConditionalFormats,
  rowIndex: number,
  firstGridColumn: boolean
): string | null {
  if (formats.firstRowEnabled && rowIndex === 0 && formats.firstRowFill !== null) {
    return formats.firstRowFill;
  }
  if (formats.firstColumnEnabled && firstGridColumn && formats.firstColumnFill !== null) {
    return formats.firstColumnFill;
  }
  if (!formats.bandingEnabled) return null;
  const bandIndex = rowIndex - (formats.firstRowEnabled ? 1 : 0);
  // A header row without its own firstRow fill is NOT part of the banding.
  if (bandIndex < 0) return null;
  return bandIndex % 2 === 0 ? formats.band1Fill : formats.band2Fill;
}

export function wordTableCellCss(
  tcPr: OoxmlElement | null,
  tblBorders: OoxmlElement | null,
  rowIndex: number,
  rowCount: number,
  rowSpan: number,
  firstGridColumn: boolean,
  lastGridColumn: boolean,
  conditionalFill: string | null
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
  const fill = colorAttribute(wmlChild(tcPr, 'shd'), 'fill') ?? conditionalFill;
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
