/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Chart text content: titles, data label text and text styles per chart element.

import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  findDirectChild,
  isElement,
  schemaAttributeValue,
  type ChartThemeFaces,
  type OoxmlElement,
  type ShapeSchemeColorResolver,
} from '@docx-editor.dev/core/store';
import {
  child,
  children,
  childFlag,
  childVal,
  type ChartModel,
  type ChartPlot,
  type ChartSeries,
} from './chart-model.ts';
import { formatChartNumber } from './chart-number-format.ts';
import {
  applyRunLayer,
  bodyDefaultRun,
  type ChartTextRun,
  type ChartTextStyle,
} from './chart-text.ts';

const A = DRAWINGML_MAIN_NAMESPACE_URI;
const MAX_TITLE_PARAGRAPHS = 16;
const MAX_TITLE_RUNS = 128;

/** Chart text with nothing authored: 10 pt black in the theme's body font. */
export const DEFAULT_CHART_TEXT: ChartTextStyle = {
  sizePt: 10,
  bold: false,
  italic: false,
  underline: false,
  colorHex: '000000',
  latin: '+mn-lt',
  eastAsian: '+mn-ea',
  complex: '+mn-cs',
};

/** The chart-wide text style: the chart space `c:txPr` over the defaults. */
export function chartBaseText(
  model: ChartModel,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  themeFaces?: ChartThemeFaces
): ChartTextStyle {
  const base = themeFaces ? { ...DEFAULT_CHART_TEXT, themeFaces } : DEFAULT_CHART_TEXT;
  return applyRunLayer(base, bodyDefaultRun(model.txPr), resolveSchemeColor);
}

/** An element's text style: its `c:txPr` over the chart-wide style and element defaults. */
export function elementText(
  base: ChartTextStyle,
  txPr: OoxmlElement | null,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  defaults: Partial<ChartTextStyle> = {}
): ChartTextStyle {
  return applyRunLayer({ ...base, ...defaults }, bodyDefaultRun(txPr), resolveSchemeColor);
}

/**
 * The paragraphs of a title (`c:title`) or data label (`c:dLbl`): its rich text, its cached
 * reference text, or `fallback` when it holds neither. `field` gives a field's (`a:fld`) text
 * from its type and saved text.
 */
export function titleParagraphs(
  title: OoxmlElement,
  style: ChartTextStyle,
  fallback: string | null,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  field?: (type: string | undefined, saved: string) => string
): ChartTextRun[][] {
  const tx = child(title, 'tx');
  const rich = child(tx, 'rich');
  if (rich) {
    const paragraphs: ChartTextRun[][] = [];
    let runs = 0;
    for (const paragraph of rich.children) {
      if (!isElement(paragraph) || paragraph.namespaceUri !== A || paragraph.localName !== 'p')
        continue;
      if (paragraphs.length >= MAX_TITLE_PARAGRAPHS) break;
      const pPr = findDirectChild(paragraph.children, { namespaceUri: A, localName: 'pPr' });
      const defRPr = pPr
        ? findDirectChild(pPr.children, { namespaceUri: A, localName: 'defRPr' })
        : null;
      const paragraphStyle = applyRunLayer(style, defRPr, resolveSchemeColor);
      let current: ChartTextRun[] = [];
      for (const run of paragraph.children) {
        if (!isElement(run) || run.namespaceUri !== A) continue;
        if (++runs > MAX_TITLE_RUNS) break;
        if (run.localName === 'br') {
          paragraphs.push(current);
          current = [];
          continue;
        }
        if (run.localName !== 'r' && run.localName !== 'fld') continue;
        const rPr = findDirectChild(run.children, { namespaceUri: A, localName: 'rPr' });
        const t = findDirectChild(run.children, { namespaceUri: A, localName: 't' });
        let text = '';
        for (const node of t?.children ?? []) if (node.kind === 'textValue') text += node.value;
        if (run.localName === 'fld' && field) {
          text = field(schemaAttributeValue(run.attributes, 'type'), text);
        }
        current.push({ text, style: applyRunLayer(paragraphStyle, rPr, resolveSchemeColor) });
      }
      paragraphs.push(current);
    }
    if (paragraphs.some((paragraph) => paragraph.some((run) => run.text.trim() !== ''))) {
      return paragraphs;
    }
  }
  const cache = child(child(tx, 'strRef'), 'strCache');
  if (cache) {
    const point = children(cache, 'pt')[0];
    let text = '';
    for (const node of child(point, 'v')?.children ?? [])
      if (node.kind === 'textValue') text += node.value;
    if (text.trim() !== '') return [[{ text, style }]];
  }
  return fallback ? [[{ text: fallback, style }]] : [];
}

/** What a data label shows, after point overrides. */
export interface DataLabelSpec {
  readonly showValue: boolean;
  readonly showPercent: boolean;
  readonly showCategory: boolean;
  readonly showSeries: boolean;
  /** Text between the label parts; null until the plot type supplies its default. */
  readonly separator: string | null;
  readonly position: string | null;
  readonly formatCode: string | null;
  readonly txPr: OoxmlElement | null;
  readonly spPr: OoxmlElement | null;
  /** A point label's own `c:dLbl` when it carries its own text (`c:tx`), shown as written. */
  readonly custom: OoxmlElement | null;
  /** A point label moved by hand, as shares of the chart's width and height. */
  readonly moved: DataLabelMove | null;
}

/**
 * A point label's manual layout, per axis: by default an offset from where the label would sit,
 * or in edge mode the position of its left or top side.
 */
export interface DataLabelMove {
  readonly x: number;
  readonly y: number;
  readonly xEdge: boolean;
  readonly yEdge: boolean;
}

function readMove(element: OoxmlElement): DataLabelMove | null {
  const manual = child(child(element, 'layout'), 'manualLayout');
  const share = (name: string) => {
    const raw = childVal(manual, name);
    const value = raw !== undefined && raw.length <= 32 ? Number(raw) : NaN;
    return Number.isFinite(value) && Math.abs(value) <= 10 ? value : null;
  };
  const x = share('x');
  const y = share('y');
  if (x === null && y === null) return null;
  // An edge position needs its value; a missing offset is no offset.
  const xEdge = childVal(manual, 'xMode') === 'edge' && x !== null;
  const yEdge = childVal(manual, 'yMode') === 'edge' && y !== null;
  return { x: x ?? 0, y: y ?? 0, xEdge, yEdge };
}

function labelFlags(element: OoxmlElement, inherited: DataLabelSpec | null): DataLabelSpec | null {
  if (childFlag(element, 'delete', false)) return null;
  const numFmt = child(element, 'numFmt');
  const linked = numFmt ? schemaAttributeValue(numFmt.attributes, 'sourceLinked') === '1' : true;
  let separator = inherited?.separator ?? null;
  const separatorElement = child(element, 'separator');
  if (separatorElement) {
    let text = '';
    for (const node of separatorElement.children) if (node.kind === 'textValue') text += node.value;
    separator = text.slice(0, 16);
  }
  return {
    showValue: childFlag(element, 'showVal', inherited?.showValue ?? false),
    showPercent: childFlag(element, 'showPercent', inherited?.showPercent ?? false),
    showCategory: childFlag(element, 'showCatName', inherited?.showCategory ?? false),
    showSeries: childFlag(element, 'showSerName', inherited?.showSeries ?? false),
    separator,
    position: childVal(element, 'dLblPos') ?? inherited?.position ?? null,
    formatCode:
      numFmt && !linked
        ? (schemaAttributeValue(numFmt.attributes, 'formatCode') ?? null)
        : (inherited?.formatCode ?? null),
    txPr: child(element, 'txPr') ?? inherited?.txPr ?? null,
    spPr: child(element, 'spPr') ?? inherited?.spPr ?? null,
    custom: null,
    moved: null,
  };
}

/** The data label settings of one point, or null when it shows none. */
export function dataLabelFor(
  plot: ChartPlot,
  series: ChartSeries,
  index: number
): DataLabelSpec | null {
  const group = plot.dLbls ? labelFlags(plot.dLbls, null) : null;
  const own = series.dLbls ? labelFlags(series.dLbls, group) : group;
  let spec = own;
  for (const point of children(series.dLbls, 'dLbl')) {
    if (childVal(point, 'idx') !== String(index)) continue;
    const flags = labelFlags(point, own ?? group);
    spec = flags && {
      ...flags,
      custom: child(point, 'tx') ? point : null,
      moved: readMove(point),
    };
    break;
  }
  if (!spec) return null;
  const shows = spec.showValue || spec.showPercent || spec.showCategory || spec.showSeries;
  if (!shows && !spec.custom) return null;
  // Pie labels put each part on its own line unless the file names a separator.
  const round = plot.kind === 'pie' || plot.kind === 'doughnut' || plot.kind === 'ofPie';
  return spec.separator === null ? { ...spec, separator: round ? '\n' : ', ' } : spec;
}

/** What one point's data label can show, before formatting. */
export interface DataLabelValues {
  readonly value: number;
  /** The point's share of its series, or null where shares do not apply. */
  readonly percent: number | null;
  readonly category: string | null;
  readonly seriesName: string | null;
  readonly seriesFormat: string | null;
  readonly date1904: boolean;
  /** The cached cell text the label range extension gives this point. */
  readonly cell?: string | null;
}

/**
 * The text a data label field (`a:fld` type) stands for, or null for a type with no generated
 * text, which keeps the text saved in the field.
 */
export function dataLabelField(
  spec: DataLabelSpec,
  values: DataLabelValues,
  type: string | undefined
): string | null {
  switch (type) {
    case 'VALUE':
      return formatChartNumber(
        values.value,
        spec.formatCode ?? values.seriesFormat,
        values.date1904
      );
    case 'PERCENTAGE':
      return values.percent === null
        ? ''
        : formatChartNumber(
            values.percent,
            spec.formatCode && spec.formatCode.includes('%') ? spec.formatCode : '0%',
            values.date1904
          );
    case 'CATEGORYNAME':
      return values.category ?? '';
    case 'SERIESNAME':
      return values.seriesName ?? '';
    case 'CELLRANGE':
      return values.cell ?? '';
    default:
      return null;
  }
}

/** The text of one data label: the parts it shows, joined by its separator. */
export function dataLabelText(spec: DataLabelSpec, values: DataLabelValues): string {
  const parts: string[] = [];
  if (spec.showSeries && values.seriesName) parts.push(values.seriesName);
  if (spec.showCategory && values.category) parts.push(values.category);
  if (spec.showValue) parts.push(dataLabelField(spec, values, 'VALUE')!);
  if (spec.showPercent && values.percent !== null) {
    parts.push(dataLabelField(spec, values, 'PERCENTAGE')!);
  }
  return parts.join(spec.separator ?? ', ');
}
