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
 * The paragraphs of a title (`c:title`): its rich text, its cached reference text, or
 * `fallback` when it holds neither.
 */
export function titleParagraphs(
  title: OoxmlElement,
  style: ChartTextStyle,
  fallback: string | null,
  resolveSchemeColor?: ShapeSchemeColorResolver
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
    spec = labelFlags(point, own ?? group);
    break;
  }
  if (!spec) return null;
  if (!(spec.showValue || spec.showPercent || spec.showCategory || spec.showSeries)) return null;
  // Pie labels put each part on its own line unless the file names a separator.
  const round = plot.kind === 'pie' || plot.kind === 'doughnut' || plot.kind === 'ofPie';
  return spec.separator === null ? { ...spec, separator: round ? '\n' : ', ' } : spec;
}

/** The text of one data label. */
export function dataLabelText(
  spec: DataLabelSpec,
  value: number,
  percent: number | null,
  category: string | null,
  seriesName: string | null,
  seriesFormat: string | null,
  date1904: boolean
): string {
  const parts: string[] = [];
  if (spec.showSeries && seriesName) parts.push(seriesName);
  if (spec.showCategory && category) parts.push(category);
  if (spec.showValue)
    parts.push(formatChartNumber(value, spec.formatCode ?? seriesFormat, date1904));
  if (spec.showPercent && percent !== null) {
    parts.push(
      formatChartNumber(
        percent,
        spec.formatCode && spec.formatCode.includes('%') ? spec.formatCode : '0%',
        date1904
      )
    );
  }
  return parts.join(spec.separator ?? ', ');
}
