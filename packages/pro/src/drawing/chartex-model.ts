/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Read a chartex `cx:chartSpace` into the typed model every chartex layout draws from.
//
// Values come only from the caches in the part (`cx:lvl/cx:pt`); formulas, the embedded
// workbook and external data are never read. Every count is file-derived and bounded: a
// level's `ptCount` sizes its point array only within the bounds below, and a point's `idx`
// must fall inside it. A chart past a bound makes the whole model null, so the drawing keeps
// its labelled placeholder rather than painting part of a chart.

import {
  CHARTEX_NAMESPACE_URI,
  findDirectChild,
  isElement,
  schemaAttributeValue,
  type OoxmlElement,
} from '@docx-editor.dev/core/store';
import { formatChartNumber } from './chart-number-format.ts';

const CX = CHARTEX_NAMESPACE_URI;

/** Bounds on one chartex chart. Past them the chart does not render. */
export const CHARTEX_LIMITS = Object.freeze({
  dataBlocks: 16,
  dimensionsPerData: 8,
  levelsPerDimension: 8,
  pointsPerLevel: 4_096,
  totalPoints: 32_768,
  series: 64,
  axes: 8,
  pointOverrides: 4_096,
  textUnits: 1_024,
});

/** One level of a data dimension: its cached points, sparse by `idx`. */
export interface ChartexLevel {
  readonly name: string | null;
  readonly formatCode: string | null;
  /** Numbers (numeric dimensions) or text (string dimensions); null where no point is cached. */
  readonly points: readonly (number | string | null)[];
}

/** A numeric (`cx:numDim`) or string (`cx:strDim`) dimension of a data block. */
export interface ChartexDimension {
  readonly numeric: boolean;
  /** `cat`, `val`, `x`, `y`, `size`, `colorVal`, `colorStr`, `entityId`, ... */
  readonly type: string;
  /** Levels in document order; a hierarchy lists its outermost level last. */
  readonly levels: readonly ChartexLevel[];
}

export interface ChartexData {
  readonly id: string;
  readonly dimensions: readonly ChartexDimension[];
}

/** What a series or point data label shows. */
export interface ChartexLabelVisibility {
  readonly seriesName: boolean;
  readonly categoryName: boolean;
  readonly value: boolean;
}

export interface ChartexDataLabels {
  readonly element: OoxmlElement;
  /** `outEnd`, `inEnd`, `ctr`, `inBase`, `t`, `b`, `l`, `r`, `bestFit`; null when unset. */
  readonly position: string | null;
  /** An unlinked number format; null keeps the data's own format. */
  readonly formatCode: string | null;
  readonly spPr: OoxmlElement | null;
  readonly txPr: OoxmlElement | null;
  readonly visibility: ChartexLabelVisibility;
  readonly separator: string | null;
  /** Points whose label is hidden (`cx:dataLabelHidden`). */
  readonly hidden: ReadonlySet<number>;
  /** Point overrides (`cx:dataLabel`) by index. */
  readonly points: ReadonlyMap<number, OoxmlElement>;
}

export interface ChartexSeries {
  readonly element: OoxmlElement;
  /** Order among the plot area's series. */
  readonly index: number;
  readonly layoutId: string;
  readonly hidden: boolean;
  /** The series this one belongs to (`ownerIdx`), such as the columns of a Pareto line. */
  readonly ownerIndex: number | null;
  /** The colour slot of the series (`formatIdx`), or its index when unset. */
  readonly formatIndex: number;
  readonly name: string | null;
  readonly data: ChartexData | null;
  readonly spPr: OoxmlElement | null;
  /** `cx:dataPt` elements by point index; `pointSpPr` reads their shape properties. */
  readonly points: ReadonlyMap<number, OoxmlElement>;
  readonly dataLabels: ChartexDataLabels | null;
  /** `cx:layoutPr`, which each layout reads for its own settings. */
  readonly layoutPr: OoxmlElement | null;
  /** Axis ids the series plots against (`cx:axisId`), in order. */
  readonly axisIds: readonly string[];
}

export interface ChartexAxis {
  readonly element: OoxmlElement;
  readonly id: string;
  readonly kind: 'category' | 'value';
  readonly hidden: boolean;
  /** Category axes: the gap between bars as a fraction of a bar's width. */
  readonly gapWidth: number | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly majorUnit: number | null;
  readonly minorUnit: number | null;
  readonly title: OoxmlElement | null;
  readonly majorGridlines: OoxmlElement | null;
  readonly minorGridlines: OoxmlElement | null;
  /** `none`, `in`, `out` or `cross`; null when unset. */
  readonly majorTickMarks: string | null;
  readonly tickLabels: boolean;
  /** An unlinked number format; null keeps the data's own format. */
  readonly formatCode: string | null;
  readonly spPr: OoxmlElement | null;
  readonly txPr: OoxmlElement | null;
}

export interface ChartexTitle {
  readonly element: OoxmlElement;
  /** `t`, `b`, `l` or `r`. */
  readonly position: string;
  readonly overlay: boolean;
}

export interface ChartexLegend {
  readonly element: OoxmlElement;
  /** `t`, `b`, `l` or `r`. */
  readonly position: 't' | 'b' | 'l' | 'r';
  readonly overlay: boolean;
  readonly spPr: OoxmlElement | null;
  readonly txPr: OoxmlElement | null;
}

export interface ChartexModel {
  readonly chartSpace: OoxmlElement;
  readonly data: ReadonlyMap<string, ChartexData>;
  readonly title: ChartexTitle | null;
  readonly series: readonly ChartexSeries[];
  readonly axes: readonly ChartexAxis[];
  readonly legend: ChartexLegend | null;
  readonly spPr: OoxmlElement | null;
  readonly txPr: OoxmlElement | null;
  readonly plotSpPr: OoxmlElement | null;
}

/** A direct `cx:` child. */
export function cxChild(
  parent: OoxmlElement | null | undefined,
  localName: string
): OoxmlElement | null {
  return parent ? findDirectChild(parent.children, { namespaceUri: CX, localName }) : null;
}

/** The shape properties a `cx:dataPt` names for point `index` of `series`, or null. */
export function pointSpPr(series: ChartexSeries, index: number): OoxmlElement | null {
  return cxChild(series.points.get(index), 'spPr');
}

/** Direct `cx:` children of one name, at most `limit` (past it: null). */
export function cxChildren(
  parent: OoxmlElement | null | undefined,
  localName: string,
  limit: number
): OoxmlElement[] | null {
  const out: OoxmlElement[] = [];
  for (const node of parent?.children ?? []) {
    if (!isElement(node) || node.namespaceUri !== CX || node.localName !== localName) continue;
    if (out.length >= limit) return null;
    out.push(node);
  }
  return out;
}

/** An `xsd:boolean` attribute, or `absent` when unset or invalid. */
export function cxFlag(element: OoxmlElement | null, name: string, absent: boolean): boolean {
  const raw = element ? schemaAttributeValue(element.attributes, name) : undefined;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return absent;
}

/** A finite decimal attribute, or null. Only plain decimal syntax is accepted. */
export function cxNumber(element: OoxmlElement | null, name: string): number | null {
  const raw = element ? schemaAttributeValue(element.attributes, name) : undefined;
  return parseDecimal(raw);
}

function parseDecimal(raw: string | undefined): number | null {
  if (raw === undefined || raw.length > 64) return null;
  const trimmed = raw.trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d{1,3})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** A non-negative integer attribute below `limit`, or null. */
function index(element: OoxmlElement, name: string, limit: number): number | null {
  const raw = schemaAttributeValue(element.attributes, name);
  if (raw === undefined || !/^\d{1,9}$/.test(raw)) return null;
  const value = Number(raw);
  return value < limit ? value : null;
}

/** The text directly inside `element`, bounded. */
export function cxText(element: OoxmlElement | null): string | null {
  if (!element) return null;
  let text = '';
  for (const node of element.children) {
    if (node.kind !== 'textValue') continue;
    text += node.value;
    if (text.length > CHARTEX_LIMITS.textUnits) break;
  }
  return text.slice(0, CHARTEX_LIMITS.textUnits);
}

/** A `cx:numFmt` whose format is not linked to the data, or null. */
function unlinkedFormat(parent: OoxmlElement | null): string | null {
  const numFmt = cxChild(parent, 'numFmt');
  if (!numFmt || cxFlag(numFmt, 'sourceLinked', false)) return null;
  const code = schemaAttributeValue(numFmt.attributes, 'formatCode');
  return code && code.length <= 255 ? code : null;
}

interface Budget {
  points: number;
}

function readLevel(level: OoxmlElement, numeric: boolean, budget: Budget): ChartexLevel | null {
  const count = index(level, 'ptCount', CHARTEX_LIMITS.pointsPerLevel + 1);
  if (count === null) return null;
  budget.points += count;
  if (budget.points > CHARTEX_LIMITS.totalPoints) return null;
  const points: (number | string | null)[] = new Array<number | string | null>(count).fill(null);
  let seen = 0;
  for (const node of level.children) {
    if (!isElement(node) || node.namespaceUri !== CX || node.localName !== 'pt') continue;
    if (++seen > count) return null;
    const at = index(node, 'idx', count);
    if (at === null) continue;
    const text = cxText(node) ?? '';
    points[at] = numeric ? parseDecimal(text) : text;
  }
  const format = schemaAttributeValue(level.attributes, 'formatCode');
  const name = schemaAttributeValue(level.attributes, 'name');
  return {
    name: name ? name.slice(0, CHARTEX_LIMITS.textUnits) : null,
    formatCode: format && format.length <= 255 ? format : null,
    points,
  };
}

function readData(data: OoxmlElement, budget: Budget): ChartexData | null {
  const dimensions: ChartexDimension[] = [];
  for (const node of data.children) {
    if (!isElement(node) || node.namespaceUri !== CX) continue;
    const numeric = node.localName === 'numDim';
    if (!numeric && node.localName !== 'strDim') continue;
    if (dimensions.length >= CHARTEX_LIMITS.dimensionsPerData) return null;
    const levelElements = cxChildren(node, 'lvl', CHARTEX_LIMITS.levelsPerDimension);
    if (!levelElements) return null;
    const levels: ChartexLevel[] = [];
    for (const element of levelElements) {
      const level = readLevel(element, numeric, budget);
      if (!level) return null;
      levels.push(level);
    }
    dimensions.push({
      numeric,
      type: (schemaAttributeValue(node.attributes, 'type') ?? '').slice(0, 32),
      levels,
    });
  }
  return { id: schemaAttributeValue(data.attributes, 'id') ?? '', dimensions };
}

/** Point elements of one name keyed by their `idx`, bounded. */
function byIndex(parent: OoxmlElement | null, localName: string): Map<number, OoxmlElement> | null {
  const out = new Map<number, OoxmlElement>();
  const elements = cxChildren(parent, localName, CHARTEX_LIMITS.pointOverrides);
  if (!elements) return null;
  for (const element of elements) {
    const at = index(element, 'idx', CHARTEX_LIMITS.pointsPerLevel);
    if (at !== null && !out.has(at)) out.set(at, element);
  }
  return out;
}

function readVisibility(
  element: OoxmlElement | null,
  inherited: ChartexLabelVisibility
): ChartexLabelVisibility {
  const visibility = cxChild(element, 'visibility');
  return {
    seriesName: cxFlag(visibility, 'seriesName', inherited.seriesName),
    categoryName: cxFlag(visibility, 'categoryName', inherited.categoryName),
    value: cxFlag(visibility, 'value', inherited.value),
  };
}

function readDataLabels(element: OoxmlElement | null): ChartexDataLabels | null | 'refused' {
  if (!element) return null;
  const points = byIndex(element, 'dataLabel');
  const hiddenElements = cxChildren(element, 'dataLabelHidden', CHARTEX_LIMITS.pointOverrides);
  if (!points || !hiddenElements) return 'refused';
  const hidden = new Set<number>();
  for (const node of hiddenElements) {
    const at = index(node, 'idx', CHARTEX_LIMITS.pointsPerLevel);
    if (at !== null) hidden.add(at);
  }
  const separator = cxText(cxChild(element, 'separator'));
  return {
    element,
    position: schemaAttributeValue(element.attributes, 'pos')?.slice(0, 16) ?? null,
    formatCode: unlinkedFormat(element),
    spPr: cxChild(element, 'spPr'),
    txPr: cxChild(element, 'txPr'),
    // Without a visibility element a data label shows its value.
    visibility: readVisibility(element, { seriesName: false, categoryName: false, value: true }),
    separator: separator === null ? null : separator.slice(0, 16),
    hidden,
    points,
  };
}

/** The visibility of point `index`'s label: its override over the series labels. */
export function pointLabelVisibility(
  labels: ChartexDataLabels,
  pointIndex: number
): ChartexLabelVisibility | null {
  if (labels.hidden.has(pointIndex)) return null;
  const own = labels.points.get(pointIndex);
  return own ? readVisibility(own, labels.visibility) : labels.visibility;
}

/** The name of a series: its cached `cx:tx/cx:txData/cx:v`. */
function seriesName(series: OoxmlElement): string | null {
  const v = cxChild(cxChild(cxChild(series, 'tx'), 'txData'), 'v');
  const text = cxText(v);
  return text && text.length > 0 ? text : null;
}

function readAxis(element: OoxmlElement): ChartexAxis {
  const catScaling = cxChild(element, 'catScaling');
  const valScaling = cxChild(element, 'valScaling');
  const tickLabels = cxChild(element, 'tickLabels');
  const majorTickMarks = cxChild(element, 'majorTickMarks');
  const gap = catScaling ? schemaAttributeValue(catScaling.attributes, 'gapWidth') : undefined;
  return {
    element,
    id: (schemaAttributeValue(element.attributes, 'id') ?? '').slice(0, 32),
    kind: catScaling ? 'category' : 'value',
    hidden: cxFlag(element, 'hidden', false),
    gapWidth: gap === undefined || gap === 'auto' ? null : parseDecimal(gap),
    min: cxNumber(valScaling, 'min'),
    max: cxNumber(valScaling, 'max'),
    majorUnit: cxNumber(valScaling, 'majorUnit'),
    minorUnit: cxNumber(valScaling, 'minorUnit'),
    title: cxChild(element, 'title'),
    majorGridlines: cxChild(element, 'majorGridlines'),
    minorGridlines: cxChild(element, 'minorGridlines'),
    majorTickMarks: majorTickMarks
      ? (schemaAttributeValue(majorTickMarks.attributes, 'type') ?? 'cross').slice(0, 8)
      : null,
    tickLabels: tickLabels !== null,
    formatCode: unlinkedFormat(element),
    spPr: cxChild(element, 'spPr'),
    txPr: cxChild(element, 'txPr'),
  };
}

const LEGEND_POSITIONS = new Set(['t', 'b', 'l', 'r']);

/** The model of a chartex chart space, or null past the bounds or without a plot area. */
export function readChartexModel(chartSpace: OoxmlElement): ChartexModel | null {
  const chart = cxChild(chartSpace, 'chart');
  const plotArea = cxChild(chart, 'plotArea');
  const region = cxChild(plotArea, 'plotAreaRegion');
  if (!chart || !plotArea || !region) return null;
  const budget: Budget = { points: 0 };
  const data = new Map<string, ChartexData>();
  const dataElements = cxChildren(
    cxChild(chartSpace, 'chartData'),
    'data',
    CHARTEX_LIMITS.dataBlocks
  );
  if (!dataElements) return null;
  for (const element of dataElements) {
    const block = readData(element, budget);
    if (!block) return null;
    if (!data.has(block.id)) data.set(block.id, block);
  }
  const seriesElements = cxChildren(region, 'series', CHARTEX_LIMITS.series);
  if (!seriesElements || seriesElements.length === 0) return null;
  const series: ChartexSeries[] = [];
  for (const [position, element] of seriesElements.entries()) {
    const points = byIndex(element, 'dataPt');
    const labels = readDataLabels(cxChild(element, 'dataLabels'));
    const axisIds = cxChildren(element, 'axisId', CHARTEX_LIMITS.axes);
    if (!points || labels === 'refused' || !axisIds) return null;
    const dataId = schemaAttributeValue(cxChild(element, 'dataId')?.attributes ?? [], 'val');
    const owner = index(element, 'ownerIdx', CHARTEX_LIMITS.series);
    const format = index(element, 'formatIdx', 1_000);
    series.push({
      element,
      index: position,
      layoutId: (schemaAttributeValue(element.attributes, 'layoutId') ?? '').slice(0, 32),
      hidden: cxFlag(element, 'hidden', false),
      ownerIndex: owner,
      formatIndex: format ?? position,
      name: seriesName(element),
      data: dataId === undefined ? null : (data.get(dataId) ?? null),
      spPr: cxChild(element, 'spPr'),
      points,
      dataLabels: labels,
      layoutPr: cxChild(element, 'layoutPr'),
      axisIds: axisIds.map((axis) =>
        (schemaAttributeValue(axis.attributes, 'val') ?? '').slice(0, 32)
      ),
    });
  }
  const axisElements = cxChildren(plotArea, 'axis', CHARTEX_LIMITS.axes);
  if (!axisElements) return null;
  const titleElement = cxChild(chart, 'title');
  const legendElement = cxChild(chart, 'legend');
  const legendPosition = legendElement
    ? (schemaAttributeValue(legendElement.attributes, 'pos') ?? 'r')
    : 'r';
  return {
    chartSpace,
    data,
    title: titleElement
      ? {
          element: titleElement,
          position: schemaAttributeValue(titleElement.attributes, 'pos') ?? 't',
          overlay: cxFlag(titleElement, 'overlay', false),
        }
      : null,
    series,
    axes: axisElements.map(readAxis),
    legend: legendElement
      ? {
          element: legendElement,
          position: (LEGEND_POSITIONS.has(legendPosition) ? legendPosition : 'r') as
            | 't'
            | 'b'
            | 'l'
            | 'r',
          overlay: cxFlag(legendElement, 'overlay', false),
          spPr: cxChild(legendElement, 'spPr'),
          txPr: cxChild(legendElement, 'txPr'),
        }
      : null,
    spPr: cxChild(chartSpace, 'spPr'),
    txPr: cxChild(chartSpace, 'txPr'),
    plotSpPr: cxChild(plotArea, 'spPr'),
  };
}

/** The first dimension of `type` in a series' data, or null. */
export function seriesDimension(series: ChartexSeries, type: string): ChartexDimension | null {
  for (const dimension of series.data?.dimensions ?? []) {
    if (dimension.type === type) return dimension;
  }
  return null;
}

/** The cached numbers of a series' first level of `type` (`val` by default). */
export function seriesValues(
  series: ChartexSeries,
  type = 'val'
): { readonly values: readonly (number | null)[]; readonly formatCode: string | null } | null {
  const level = seriesDimension(series, type)?.levels[0];
  if (!level) return null;
  return {
    values: level.points.map((point) => (typeof point === 'number' ? point : null)),
    formatCode: level.formatCode,
  };
}

/** The category text of a series at its first level, one entry per point; numbers formatted. */
export function seriesCategories(series: ChartexSeries): readonly (string | null)[] | null {
  const level = seriesDimension(series, 'cat')?.levels[0];
  if (!level) return null;
  return level.points.map((point) =>
    typeof point === 'number' ? formatChartNumber(point, level.formatCode) : point
  );
}
