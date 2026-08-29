import {
  parseCssColor,
  parseCssLengthPt,
  parseInlineStyle,
  solidBackground,
  tagOf,
} from './clipboard-html-styles.ts';

const MAX_TABLE_TWIPS = 31_680;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function widthPointsOf(element: Element): number | null {
  const styled = parseCssLengthPt(parseInlineStyle(element).get('width') ?? '');
  if (styled !== null && styled > 0) return styled;
  const attribute = element.getAttribute('width')?.trim();
  if (attribute === undefined || !/^\d{1,6}(\.\d+)?$/.test(attribute)) return null;
  const pixels = Number.parseFloat(attribute);
  return Number.isFinite(pixels) && pixels > 0 ? pixels * 0.75 : null;
}

function cellSpanOf(cell: Element): number {
  const raw = cell.getAttribute('colspan')?.trim();
  if (raw === undefined || !/^\d{1,2}$/.test(raw)) return 1;
  return clamp(Number.parseInt(raw, 10), 1, 63);
}

export function tableRowsOf(table: Element): Element[] {
  return Array.from(table.children).flatMap((child) => {
    const tag = tagOf(child);
    if (tag === 'tr') return [child];
    if (tag !== 'thead' && tag !== 'tbody' && tag !== 'tfoot') return [];
    return Array.from(child.children).filter((inner) => tagOf(inner) === 'tr');
  });
}

export function htmlSpanOf(cell: Element, attribute: 'colspan' | 'rowspan', max: number): number {
  const raw = cell.getAttribute(attribute);
  if (raw === null || !/^\d{1,4}$/.test(raw.trim())) return 1;
  return clamp(Number.parseInt(raw, 10), 1, max);
}

/** Read a bounded Word HTML table width, with the document content width as fallback. */
export function tableWidthTwips(table: Element, fallback: number): number {
  const points = widthPointsOf(table);
  return points === null ? fallback : clamp(Math.round(points * 20), 1, MAX_TABLE_TWIPS);
}

/** Map HTML table alignment to OOXML table justification. */
export function tableJustification(table: Element): 'left' | 'center' | 'right' | undefined {
  const style = parseInlineStyle(table);
  const positioned = style.get('mso-table-left')?.trim().toLowerCase();
  const value =
    (positioned === 'left' || positioned === 'center' || positioned === 'right'
      ? positioned
      : undefined) ??
    table.getAttribute('align')?.trim().toLowerCase() ??
    style.get('text-align')?.trim().toLowerCase();
  return value === 'left' || value === 'center' || value === 'right' ? value : undefined;
}

/** Map Word's positioned-table CSS to bounded `w:tblpPr` attributes. */
export function tablePositionXml(table: Element): string {
  const style = parseInlineStyle(table);
  const horizontal = style.get('mso-table-anchor-horizontal')?.trim().toLowerCase();
  const vertical = style.get('mso-table-anchor-vertical')?.trim().toLowerCase();
  if (horizontal === undefined && vertical === undefined) return '';
  const anchor = (value: string | undefined): 'text' | 'margin' | 'page' =>
    value === 'margin' || value === 'page' ? value : 'text';
  let attributes = ` w:horzAnchor="${anchor(horizontal)}"` + ` w:vertAnchor="${anchor(vertical)}"`;
  const left = style.get('mso-table-left')?.trim().toLowerCase();
  if (left === 'left' || left === 'center' || left === 'right') {
    attributes += ` w:tblpXSpec="${left}"`;
  } else {
    const x = parseCssLengthPt(left ?? '');
    if (x !== null)
      attributes += ` w:tblpX="${clamp(Math.round(x * 20), -MAX_TABLE_TWIPS, MAX_TABLE_TWIPS)}"`;
  }
  const top = parseCssLengthPt(style.get('mso-table-top') ?? '');
  if (top !== null) {
    attributes += ` w:tblpY="${clamp(Math.round(top * 20), -MAX_TABLE_TWIPS, MAX_TABLE_TWIPS)}"`;
  }
  return `<w:tblpPr${attributes}/>`;
}

/**
 * Infer a fixed table grid from the row with the most explicit cell-width coverage.
 * Word writes matching `width` CSS and attributes, including on colspan cells.
 */
export function tableColumnWidths(
  rows: readonly Element[],
  columns: number,
  totalTwips: number
): readonly number[] {
  const equal = Math.max(1, Math.floor(totalTwips / columns));
  let bestScore = -1;
  let best = Array.from({ length: columns }, () => equal);
  for (const row of rows) {
    const candidate = Array.from({ length: columns }, () => equal);
    let score = 0;
    let column = 0;
    for (const cell of Array.from(row.children)) {
      if (!/^t[dh]$/.test(tagOf(cell)) || column >= columns) continue;
      const span = Math.min(cellSpanOf(cell), columns - column);
      const points = widthPointsOf(cell);
      if (points !== null) {
        const each = Math.max(1, Math.round((points * 20) / span));
        for (let offset = 0; offset < span; offset += 1) candidate[column + offset] = each;
        score += span;
      }
      column += span;
    }
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  const sourceTotal = best.reduce((sum, width) => sum + width, 0);
  if (sourceTotal <= 0) return best;
  const normalized = best.map((width) =>
    Math.max(1, Math.round((width * totalTwips) / sourceTotal))
  );
  const correction = totalTwips - normalized.reduce((sum, width) => sum + width, 0);
  normalized[normalized.length - 1] = Math.max(1, normalized[normalized.length - 1]! + correction);
  return normalized;
}

/** Sum the inferred grid columns covered by one table cell. */
export function tableSpanWidth(widths: readonly number[], column: number, span: number): number {
  let total = 0;
  for (let offset = 0; offset < span; offset += 1) total += widths[column + offset] ?? 0;
  return Math.max(1, total);
}

type BorderValue = {
  readonly val: 'single' | 'double' | 'dotted' | 'dashed' | 'nil';
  readonly size: number;
  readonly color: string;
};

const BORDER_VALUES: ReadonlyMap<string, BorderValue['val']> = new Map([
  ['solid', 'single'],
  ['double', 'double'],
  ['dotted', 'dotted'],
  ['dashed', 'dashed'],
  ['none', 'nil'],
  ['hidden', 'nil'],
]);

function borderValueOf(value: string | undefined): BorderValue | undefined {
  if (value === undefined || value.length === 0 || value.length > 128) return undefined;
  let val: BorderValue['val'] | undefined;
  let points: number | undefined;
  let color: string | undefined;
  for (const token of value.trim().split(/\s+/)) {
    const mapped = BORDER_VALUES.get(token.toLowerCase());
    if (mapped !== undefined) {
      val = mapped;
      continue;
    }
    const length = parseCssLengthPt(token);
    if (length !== null) {
      points = length;
      continue;
    }
    const parsedColor = parseCssColor(token);
    if (parsedColor !== null) {
      color = parsedColor;
      continue;
    }
    return undefined;
  }
  if (val === undefined) return undefined;
  if (val === 'nil') return { val, size: 0, color: color ?? 'auto' };
  if (points === undefined || points <= 0) return undefined;
  return {
    val,
    size: clamp(Math.round(points * 8), 2, 96),
    color: color ?? '000000',
  };
}

function borderElementXml(name: string, border: BorderValue): string {
  return (
    `<w:${name} w:val="${border.val}" w:sz="${border.size}" ` +
    `w:space="0" w:color="${border.color}"/>`
  );
}

/** Preserve Word's table border styles instead of replacing them with generic black lines. */
export function tableBordersXml(table: Element): string {
  const style = parseInlineStyle(table);
  const common = borderValueOf(style.get('mso-border-alt') ?? style.get('border'));
  const fallback =
    common ??
    (table.getAttribute('border')?.trim() && table.getAttribute('border')?.trim() !== '0'
      ? { val: 'single' as const, size: 4, color: 'auto' }
      : undefined);
  const names = [
    ['top', 'top'],
    ['left', 'left'],
    ['bottom', 'bottom'],
    ['right', 'right'],
    ['insideH', 'insideh'],
    ['insideV', 'insidev'],
  ] as const;
  let inner = '';
  for (const [xmlName, cssName] of names) {
    const border =
      borderValueOf(style.get(`mso-border-${cssName}-alt`)) ??
      borderValueOf(style.get(`mso-border-${cssName}`)) ??
      borderValueOf(style.get(`border-${cssName}`)) ??
      fallback;
    if (border !== undefined) inner += borderElementXml(xmlName, border);
  }
  return inner.length > 0 ? `<w:tblBorders>${inner}</w:tblBorders>` : '';
}

/** Preserve a bounded Word row height and its exact/at-least rule. */
export function tableRowPropertiesXml(row: Element): string {
  const style = parseInlineStyle(row);
  const points = parseCssLengthPt(style.get('height') ?? '');
  if (points === null || points <= 0) return '';
  const height = clamp(Math.round(points * 20), 1, MAX_TABLE_TWIPS);
  const rule = style.get('mso-height-rule')?.trim().toLowerCase();
  const hRule = rule === 'exactly' ? 'exact' : 'atLeast';
  return `<w:trPr><w:trHeight w:val="${height}" w:hRule="${hRule}"/></w:trPr>`;
}

function cellMarginsXml(style: ReadonlyMap<string, string>): string {
  const value = style.get('padding');
  if (value === undefined || value.length > 128) return '';
  const parsed = value
    .trim()
    .split(/\s+/)
    .map((token) => parseCssLengthPt(token));
  if (parsed.length < 1 || parsed.length > 4 || parsed.some((item) => item === null || item < 0)) {
    return '';
  }
  const [top, right = top, bottom = top, left = right] =
    parsed.length === 2
      ? [parsed[0], parsed[1], parsed[0], parsed[1]]
      : parsed.length === 3
        ? [parsed[0], parsed[1], parsed[2], parsed[1]]
        : parsed;
  const edge = (name: string, points: number | null | undefined): string =>
    `<w:${name} w:w="${clamp(Math.round((points ?? 0) * 20), 0, MAX_TABLE_TWIPS)}" w:type="dxa"/>`;
  return `<w:tcMar>${edge('top', top)}${edge('left', left)}${edge('bottom', bottom)}${edge('right', right)}</w:tcMar>`;
}

/** Emit cell borders, shading, margins, and vertical alignment in CT_TcPr order. */
export function cellCssPropertiesXml(cell: Element): string {
  const style = parseInlineStyle(cell);
  const common = borderValueOf(style.get('mso-border-alt') ?? style.get('border'));
  let borders = '';
  for (const edge of ['top', 'left', 'bottom', 'right'] as const) {
    const border =
      borderValueOf(style.get(`mso-border-${edge}-alt`)) ??
      borderValueOf(style.get(`border-${edge}`)) ??
      common;
    if (border !== undefined) borders += borderElementXml(edge, border);
  }
  let xml = borders.length > 0 ? `<w:tcBorders>${borders}</w:tcBorders>` : '';
  const fill =
    solidBackground(style.get('background')) ?? solidBackground(style.get('background-color'));
  if (fill) xml += `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`;
  xml += cellMarginsXml(style);
  const vertical =
    style.get('vertical-align')?.toLowerCase() ?? cell.getAttribute('valign')?.toLowerCase();
  if (vertical === 'top') xml += '<w:vAlign w:val="top"/>';
  else if (vertical === 'middle' || vertical === 'center') {
    xml += '<w:vAlign w:val="center"/>';
  } else if (vertical === 'bottom') xml += '<w:vAlign w:val="bottom"/>';
  return xml;
}
