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

/** One `w:tblStylePr` condition's formatting: the cell fill plus the run and
 *  paragraph properties, so a styled header row keeps its bold/white text in the
 *  copied HTML, not just its fill. */
export interface TableConditionalFormat {
  readonly fill: string | null;
  readonly rPr: OoxmlElement | null;
  readonly pPr: OoxmlElement | null;
}

const CONDITION_TYPES = [
  'wholeTable',
  'firstRow',
  'lastRow',
  'firstCol',
  'lastCol',
  'band1Horz',
  'band2Horz',
  'band1Vert',
  'band2Vert',
  'nwCell',
  'neCell',
  'swCell',
  'seCell',
] as const;
type ConditionType = (typeof CONDITION_TYPES)[number];

export interface TableConditionalFormats {
  readonly byType: ReadonlyMap<ConditionType, TableConditionalFormat>;
  readonly firstRowEnabled: boolean;
  readonly lastRowEnabled: boolean;
  readonly firstColumnEnabled: boolean;
  readonly lastColumnEnabled: boolean;
  readonly hBandingEnabled: boolean;
  readonly vBandingEnabled: boolean;
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
 * The `w:tblStylePr` formatting a table style declares for the whole table, the
 * first row/column and the horizontal bands, gated by `w:tblLook` — Word's
 * conditional table formatting, so a styled built-in table does not copy as a
 * plain grid that loses its header's fill, bold and text color.
 */
export function tableConditionalFormats(
  chain: readonly OoxmlElement[],
  tblLook: OoxmlElement | null
): TableConditionalFormats {
  const byType = new Map<ConditionType, TableConditionalFormat>();
  const known = new Set<string>(CONDITION_TYPES);
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
      if (type === undefined || !known.has(type)) continue;
      // Later chain entries (the derived style) override the base's condition.
      byType.set(type as ConditionType, {
        fill: colorAttribute(wmlChild(wmlChild(child, 'tcPr'), 'shd'), 'fill'),
        rPr: wmlChild(child, 'rPr'),
        pPr: wmlChild(child, 'pPr'),
      });
    }
  }
  return {
    byType,
    firstRowEnabled: tblLookFlag(tblLook, 'firstRow', 0x0020) ?? false,
    lastRowEnabled: tblLookFlag(tblLook, 'lastRow', 0x0040) ?? false,
    firstColumnEnabled: tblLookFlag(tblLook, 'firstColumn', 0x0080) ?? false,
    lastColumnEnabled: tblLookFlag(tblLook, 'lastColumn', 0x0100) ?? false,
    hBandingEnabled: !(tblLookFlag(tblLook, 'noHBand', 0x0200) ?? false),
    vBandingEnabled: !(tblLookFlag(tblLook, 'noVBand', 0x0400) ?? false),
  };
}

/** The strongest applicable condition for one cell, or null. §17.7.6.6 order,
 *  weakest to strongest: vertical bands, horizontal bands, firstCol, lastCol,
 *  firstRow, lastRow, corners — resolved strongest-first below. `wholeTable` is
 *  NOT resolved here; it layers under the result. */
export function conditionalCellFormat(
  formats: TableConditionalFormats,
  rowIndex: number,
  rowCount: number,
  firstGridColumn: boolean,
  lastGridColumn: boolean,
  gridColumn: number
): TableConditionalFormat | null {
  const firstRow = formats.firstRowEnabled && rowIndex === 0;
  const lastRow = formats.lastRowEnabled && rowIndex === rowCount - 1;
  const firstCol = formats.firstColumnEnabled && firstGridColumn;
  const lastCol = formats.lastColumnEnabled && lastGridColumn;
  const pick = (type: ConditionType): TableConditionalFormat | null =>
    formats.byType.get(type) ?? null;
  if (lastRow && firstCol && pick('swCell')) return pick('swCell');
  if (lastRow && lastCol && pick('seCell')) return pick('seCell');
  if (firstRow && firstCol && pick('nwCell')) return pick('nwCell');
  if (firstRow && lastCol && pick('neCell')) return pick('neCell');
  if (lastRow && pick('lastRow')) return pick('lastRow');
  if (firstRow && pick('firstRow')) return pick('firstRow');
  if (lastCol && pick('lastCol')) return pick('lastCol');
  if (firstCol && pick('firstCol')) return pick('firstCol');
  if (formats.hBandingEnabled) {
    // A header row without its own firstRow format is NOT part of the banding.
    const bandIndex = rowIndex - (formats.firstRowEnabled ? 1 : 0);
    if (bandIndex >= 0) {
      const band = pick(bandIndex % 2 === 0 ? 'band1Horz' : 'band2Horz');
      if (band) return band;
    }
  }
  if (formats.vBandingEnabled) {
    const bandIndex = gridColumn - (formats.firstColumnEnabled ? 1 : 0);
    if (bandIndex >= 0) {
      const band = pick(bandIndex % 2 === 0 ? 'band1Vert' : 'band2Vert');
      if (band) return band;
    }
  }
  return null;
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
