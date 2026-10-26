/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Read a `c:chartSpace` into the typed model the chart layout draws from.
//
// Values come only from the caches in the chart part (`c:numCache`, `c:strCache`, and the
// literal `c:numLit`/`c:strLit`); formulas and workbooks are never evaluated. Every count is
// file-derived and bounded. A chart past the bounds makes the whole model null, so the drawing
// keeps its labelled placeholder rather than painting part of a chart.

import {
  CHART_NAMESPACE_URI,
  findDirectChild,
  isElement,
  schemaAttributeValue,
  type OoxmlElement,
} from '@docx-editor.dev/core/store';

const C = CHART_NAMESPACE_URI;

/** Bounds on one chart. Past them the chart does not render. */
const MAX_PLOTS = 8;
const MAX_SERIES = 255;
const MAX_POINTS_PER_SERIES = 4_096;
const MAX_TOTAL_POINTS = 32_768;
const MAX_TEXT_UNITS = 1_024;

export type ChartPlotKind =
  | 'bar'
  | 'line'
  | 'area'
  | 'pie'
  | 'doughnut'
  | 'scatter'
  | 'radar'
  | 'bubble'
  | 'ofPie'
  | 'surface';

const PLOT_KINDS: ReadonlyMap<string, { kind: ChartPlotKind; threeD: boolean }> = new Map([
  ['barChart', { kind: 'bar', threeD: false }],
  ['bar3DChart', { kind: 'bar', threeD: true }],
  ['lineChart', { kind: 'line', threeD: false }],
  ['line3DChart', { kind: 'line', threeD: true }],
  ['areaChart', { kind: 'area', threeD: false }],
  ['area3DChart', { kind: 'area', threeD: true }],
  ['pieChart', { kind: 'pie', threeD: false }],
  ['pie3DChart', { kind: 'pie', threeD: true }],
  ['doughnutChart', { kind: 'doughnut', threeD: false }],
  ['scatterChart', { kind: 'scatter', threeD: false }],
  ['radarChart', { kind: 'radar', threeD: false }],
  ['bubbleChart', { kind: 'bubble', threeD: false }],
  // A stock chart is line series drawn without lines, joined by high-low lines and bars.
  ['stockChart', { kind: 'line', threeD: false }],
  ['ofPieChart', { kind: 'ofPie', threeD: false }],
  // A surface chart without depth is the contour chart: the surface seen from above.
  ['surfaceChart', { kind: 'surface', threeD: false }],
  ['surface3DChart', { kind: 'surface', threeD: true }],
]);

export interface ChartMarker {
  /** `none`, `circle`, `square`, …; null when the series takes the automatic marker. */
  readonly symbol: string | null;
  /** Points; 2..72. */
  readonly size: number | null;
  readonly spPr: OoxmlElement | null;
}

export interface ChartSeries {
  readonly index: number;
  readonly order: number;
  readonly name: string | null;
  /** Category labels as cached, or null when the series names none. */
  readonly categories: readonly (string | null)[] | null;
  /** Numeric category values (dates or numbers), when the categories are a number cache. */
  readonly categoryNumbers: readonly (number | null)[] | null;
  readonly categoryFormat: string | null;
  /** Scatter x values; null elsewhere. */
  readonly xValues: readonly (number | null)[] | null;
  readonly values: readonly (number | null)[];
  readonly formatCode: string | null;
  readonly spPr: OoxmlElement | null;
  readonly marker: ChartMarker | null;
  readonly dLbls: OoxmlElement | null;
  /** `c:dPt` overrides by point index. */
  readonly points: ReadonlyMap<number, OoxmlElement>;
  readonly smooth: boolean;
  /** Pie slice offset, percent of the radius. */
  readonly explosion: number;
  readonly invertIfNegative: boolean;
  /** Bubble sizes; null outside bubble plots. */
  readonly bubbleSizes: readonly (number | null)[] | null;
  /** `c:trendline` elements, in order. */
  readonly trendlines: readonly OoxmlElement[];
  /** `c:errBars` elements, in order. */
  readonly errorBars: readonly OoxmlElement[];
  /** Cached text of the cells the data labels show (the 2012 label range extension). */
  readonly labelRange: readonly (string | null)[] | null;
}

export interface ChartPlot {
  readonly kind: ChartPlotKind;
  readonly threeD: boolean;
  readonly element: OoxmlElement;
  readonly horizontal: boolean;
  readonly grouping: 'clustered' | 'stacked' | 'percentStacked' | 'standard';
  readonly varyColors: boolean;
  readonly gapWidth: number;
  readonly overlap: number;
  /** 3-D plots: the gap between series rows, percent of the bar depth. */
  readonly gapDepth: number;
  readonly series: readonly ChartSeries[];
  readonly axisIds: readonly string[];
  readonly dLbls: OoxmlElement | null;
  readonly firstSliceAngle: number;
  readonly holeSize: number;
  /** Line plots: whether series show markers by default (`c:marker val`). */
  readonly markers: boolean;
  /** Scatter: `lineMarker`, `line`, `marker`, `smooth`, `smoothMarker`, `none`. */
  readonly scatterStyle: string | null;
  /** Radar: `standard`, `marker` or `filled`. */
  readonly radarStyle: string | null;
  /** Stock and line plots: lines from each category's lowest to highest value. */
  readonly hiLowLines: OoxmlElement | null;
  /** Bars from the first series to the last, coloured by direction. */
  readonly upDownBars: OoxmlElement | null;
  /** Bubble plots: largest bubble size, percent of the default. */
  readonly bubbleScale: number;
  /** Bubble plots: bubble size is its area (true) or its width. */
  readonly bubbleArea: boolean;
  /** Of-pie plots: the second plot and how points split into it. */
  readonly ofPie: {
    readonly type: 'pie' | 'bar';
    readonly splitType: string;
    readonly splitPos: number | null;
    readonly secondSize: number;
    readonly serLines: OoxmlElement | null;
  } | null;
  /** Surface plots: lines only, no filled bands. */
  readonly wireframe: boolean;
  /** Surface plots: `c:bandFmt` shape properties by band index. */
  readonly bandFormats: ReadonlyMap<number, OoxmlElement>;
}

export type ChartAxisKind = 'category' | 'value' | 'date' | 'series';

export interface ChartAxis {
  readonly id: string;
  readonly kind: ChartAxisKind;
  readonly element: OoxmlElement;
  readonly deleted: boolean;
  readonly position: 'b' | 't' | 'l' | 'r';
  readonly crossAxisId: string | null;
  readonly reversed: boolean;
  readonly min: number | null;
  readonly max: number | null;
  readonly majorUnit: number | null;
  readonly logBase: number | null;
  readonly formatCode: string | null;
  readonly sourceLinked: boolean;
  readonly majorGridlines: OoxmlElement | null;
  readonly minorGridlines: OoxmlElement | null;
  readonly majorTickMark: 'none' | 'in' | 'out' | 'cross';
  readonly tickLabelPosition: 'nextTo' | 'low' | 'high' | 'none';
  readonly spPr: OoxmlElement | null;
  readonly txPr: OoxmlElement | null;
  readonly title: OoxmlElement | null;
  /** `autoZero`, `min`, `max`, or a number from `c:crossesAt`. */
  readonly crosses: 'autoZero' | 'min' | 'max' | number;
  /** Value axes: whether points sit between tick marks (`between`) or on them (`midCat`). */
  readonly crossBetween: 'between' | 'midCat' | null;
  readonly tickLabelSkip: number | null;
  /** Date axes: the step of one category (`c:baseTimeUnit`); null picks it from the data. */
  readonly baseTimeUnit: 'days' | 'months' | 'years' | null;
}

export interface ChartManualLayout {
  readonly inner: boolean;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ChartLegend {
  readonly element: OoxmlElement;
  readonly position: 'b' | 't' | 'l' | 'r' | 'tr';
  readonly overlay: boolean;
  readonly txPr: OoxmlElement | null;
  readonly spPr: OoxmlElement | null;
  readonly layout: ChartManualLayout | null;
  /** Legend entries the file deleted, by entry index. */
  readonly deleted: ReadonlySet<number>;
}

export interface ChartModel {
  readonly chartSpace: OoxmlElement;
  readonly date1904: boolean;
  /** Office chart style number (1..48); 2 when absent. */
  readonly style: number;
  readonly roundedCorners: boolean;
  readonly spPr: OoxmlElement | null;
  readonly txPr: OoxmlElement | null;
  readonly title: OoxmlElement | null;
  readonly autoTitleDeleted: boolean;
  readonly plotSpPr: OoxmlElement | null;
  readonly plotLayout: ChartManualLayout | null;
  readonly plots: readonly ChartPlot[];
  readonly axes: ReadonlyMap<string, ChartAxis>;
  readonly legend: ChartLegend | null;
  /** `c:view3D`, the floor and the walls; null elements when the chart names none. */
  readonly view3D: OoxmlElement | null;
  readonly floor: OoxmlElement | null;
  readonly sideWall: OoxmlElement | null;
  readonly backWall: OoxmlElement | null;
}

export function child(
  parent: OoxmlElement | null | undefined,
  localName: string
): OoxmlElement | null {
  return parent ? findDirectChild(parent.children, { namespaceUri: C, localName }) : null;
}

export function children(
  parent: OoxmlElement | null | undefined,
  localName: string
): OoxmlElement[] {
  const out: OoxmlElement[] = [];
  for (const node of parent?.children ?? []) {
    if (isElement(node) && node.namespaceUri === C && node.localName === localName) out.push(node);
  }
  return out;
}

/** `@val` of a direct `c:` child. */
export function childVal(
  parent: OoxmlElement | null | undefined,
  localName: string
): string | undefined {
  const element = child(parent, localName);
  return element ? schemaAttributeValue(element.attributes, 'val') : undefined;
}

/** An `xsd:boolean` `@val`, which defaults to true when the element is present without it. */
export function childFlag(
  parent: OoxmlElement | null | undefined,
  localName: string,
  absent: boolean
): boolean {
  const element = child(parent, localName);
  if (!element) return absent;
  const raw = schemaAttributeValue(element.attributes, 'val');
  if (raw === undefined) return true;
  return raw === '1' || raw === 'true';
}

function childNumber(
  parent: OoxmlElement | null | undefined,
  localName: string,
  min: number,
  max: number
): number | null {
  const raw = childVal(parent, localName);
  if (raw === undefined || raw.length > 40) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function textOf(element: OoxmlElement | null): string {
  let out = '';
  for (const node of element?.children ?? []) {
    if (node.kind === 'textValue') out += node.value;
  }
  return out.length > MAX_TEXT_UNITS ? out.slice(0, MAX_TEXT_UNITS) : out;
}

interface Budget {
  remaining: number;
}

/** An authored count must fit the limit; only an absent count is inferred from points. */
function cacheCount(cache: OoxmlElement, budget: Budget): number | null {
  const raw = childVal(cache, 'ptCount')?.trim();
  const count = childNumber(cache, 'ptCount', 0, MAX_POINTS_PER_SERIES);
  if (child(cache, 'ptCount') && (!raw || !/^\+?\d+$/.test(raw) || count === null)) {
    budget.remaining = -1;
    return null;
  }
  return count;
}

/** The points of a cache (`c:strCache`, `c:numCache`, or a literal), placed by `@idx`. */
function cachePoints(cache: OoxmlElement | null, budget: Budget): (string | null)[] | null {
  if (!cache) return null;
  const count = cacheCount(cache, budget);
  if (budget.remaining < 0) return null;
  const points = children(cache, 'pt');
  let length = count ?? 0;
  const indexed: [number, string][] = [];
  for (const point of points) {
    const raw = schemaAttributeValue(point.attributes, 'idx');
    const index = raw !== undefined && /^\d{1,6}$/.test(raw) ? Number(raw) : -1;
    if (index < 0 || index >= MAX_POINTS_PER_SERIES || (count !== null && index >= count)) {
      budget.remaining = -1;
      return null;
    }
    indexed.push([index, textOf(child(point, 'v'))]);
    if (count === null) length = Math.max(length, index + 1);
  }
  if (length > MAX_POINTS_PER_SERIES) return null;
  budget.remaining -= length;
  if (budget.remaining < 0) return null;
  const out: (string | null)[] = Array.from({ length }, () => null);
  for (const [index, value] of indexed) out[index] = value;
  return out;
}

interface DataReference {
  readonly text: (string | null)[] | null;
  readonly numbers: (number | null)[] | null;
  readonly formatCode: string | null;
}

/** A data source (`c:tx`, `c:cat`, `c:val`, `c:xVal`, `c:yVal`) read from its cache. */
function readData(source: OoxmlElement | null, budget: Budget): DataReference {
  const empty = { text: null, numbers: null, formatCode: null };
  if (!source) return empty;
  const numRef = child(source, 'numRef');
  const numeric = child(numRef, 'numCache') ?? child(source, 'numLit');
  if (numeric) {
    const text = cachePoints(numeric, budget);
    const formatCode = textOf(child(numeric, 'formatCode')) || null;
    return {
      text,
      numbers: text?.map((value) => parseNumber(value)) ?? null,
      formatCode,
    };
  }
  const strRef = child(source, 'strRef');
  const strings = child(strRef, 'strCache') ?? child(source, 'strLit');
  if (strings) return { text: cachePoints(strings, budget), numbers: null, formatCode: null };
  // Multi-level categories label each point by their innermost level.
  const multi = child(child(source, 'multiLvlStrRef'), 'multiLvlStrCache');
  if (multi) {
    const level = children(multi, 'lvl')[0] ?? null;
    if (level) {
      const count = cacheCount(multi, budget);
      const points = cachePoints(level, budget) ?? [];
      const length = count ?? points.length;
      if (length < points.length) {
        budget.remaining = -1;
        return empty;
      }
      // cachePoints charged the populated level; include any declared empty positions too.
      budget.remaining -= Math.max(0, length - points.length);
      if (budget.remaining < 0) return empty;
      return {
        text: Array.from({ length }, (_, index) => points[index] ?? null),
        numbers: null,
        formatCode: null,
      };
    }
  }
  // A bare `c:v` (series names may be literal).
  const literal = child(source, 'v');
  if (literal) return { text: [textOf(literal)], numbers: null, formatCode: null };
  return empty;
}

function parseNumber(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > 40) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function readMarker(element: OoxmlElement | null): ChartMarker | null {
  if (!element) return null;
  return {
    symbol: childVal(element, 'symbol') ?? null,
    size: childNumber(element, 'size', 2, 72),
    spPr: child(element, 'spPr'),
  };
}

function readSeries(ser: OoxmlElement, kind: ChartPlotKind, budget: Budget): ChartSeries | null {
  const name = readData(child(ser, 'tx'), budget).text?.[0] ?? null;
  const scatter = kind === 'scatter' || kind === 'bubble';
  const categories = readData(child(ser, scatter ? 'xVal' : 'cat'), budget);
  const values = readData(child(ser, scatter ? 'yVal' : 'val'), budget);
  if (budget.remaining < 0) return null;
  const points = new Map<number, OoxmlElement>();
  for (const point of children(ser, 'dPt')) {
    const index = childNumber(point, 'idx', 0, MAX_POINTS_PER_SERIES - 1);
    if (index !== null) points.set(index, point);
  }
  return {
    index: childNumber(ser, 'idx', 0, 2 ** 31) ?? 0,
    order: childNumber(ser, 'order', 0, 2 ** 31) ?? 0,
    name,
    categories: scatter ? null : categories.text,
    categoryNumbers: scatter ? null : categories.numbers,
    categoryFormat: categories.formatCode,
    xValues: scatter ? categories.numbers : null,
    values: values.numbers ?? (values.text ?? []).map(parseNumber),
    formatCode: values.formatCode,
    spPr: child(ser, 'spPr'),
    marker: readMarker(child(ser, 'marker')),
    dLbls: child(ser, 'dLbls'),
    points,
    smooth: childFlag(ser, 'smooth', false),
    explosion: childNumber(ser, 'explosion', 0, 400) ?? 0,
    invertIfNegative: childFlag(ser, 'invertIfNegative', false),
    bubbleSizes:
      kind === 'bubble' ? (readData(child(ser, 'bubbleSize'), budget).numbers ?? null) : null,
    trendlines: children(ser, 'trendline').slice(0, 8),
    errorBars: children(ser, 'errBars').slice(0, 2),
    labelRange: cachePoints(labelRangeCache(ser), budget),
  };
}

/** The element of `parent` named `localName` in any namespace: extension elements. */
function anyChild(parent: OoxmlElement | null | undefined, localName: string): OoxmlElement | null {
  for (const node of parent?.children ?? []) {
    if (isElement(node) && node.localName === localName) return node;
  }
  return null;
}

/** `c15:dlblRangeCache` of a series: the cached cells its data labels show. */
function labelRangeCache(ser: OoxmlElement): OoxmlElement | null {
  for (const ext of children(child(ser, 'extLst'), 'ext')) {
    const cache = anyChild(anyChild(ext, 'datalabelsRange'), 'dlblRangeCache');
    if (cache) return cache;
  }
  return null;
}

const GROUPINGS = new Set(['clustered', 'stacked', 'percentStacked', 'standard']);

function readPlot(element: OoxmlElement, budget: Budget): ChartPlot | null {
  const known = PLOT_KINDS.get(element.localName);
  if (!known) return null;
  const series: ChartSeries[] = [];
  for (const ser of children(element, 'ser')) {
    if (series.length >= MAX_SERIES) return null;
    const read = readSeries(ser, known.kind, budget);
    if (!read || budget.remaining < 0) return null;
    series.push(read);
  }
  series.sort((a, b) => a.order - b.order);
  const grouping = childVal(element, 'grouping');
  const kind = known.kind;
  return {
    kind,
    threeD: known.threeD,
    element,
    horizontal: kind === 'bar' && childVal(element, 'barDir') === 'bar',
    grouping:
      grouping && GROUPINGS.has(grouping)
        ? (grouping as ChartPlot['grouping'])
        : kind === 'bar'
          ? 'clustered'
          : 'standard',
    varyColors: childFlag(element, 'varyColors', kind === 'pie' || kind === 'doughnut'),
    gapWidth: childNumber(element, 'gapWidth', 0, 500) ?? 150,
    overlap: childNumber(element, 'overlap', -100, 100) ?? 0,
    gapDepth: childNumber(element, 'gapDepth', 0, 500) ?? 150,
    series,
    axisIds: children(element, 'axId').map(
      (axis) => schemaAttributeValue(axis.attributes, 'val') ?? ''
    ),
    dLbls: child(element, 'dLbls'),
    firstSliceAngle: childNumber(element, 'firstSliceAng', 0, 360) ?? 0,
    holeSize: childNumber(element, 'holeSize', 1, 90) ?? 50,
    markers: childFlag(element, 'marker', true),
    scatterStyle: childVal(element, 'scatterStyle') ?? null,
    radarStyle: childVal(element, 'radarStyle') ?? null,
    hiLowLines: child(element, 'hiLowLines'),
    upDownBars: child(element, 'upDownBars'),
    bubbleScale: childNumber(element, 'bubbleScale', 0, 300) ?? 100,
    bubbleArea: childVal(element, 'sizeRepresents') !== 'w',
    ofPie:
      kind === 'ofPie'
        ? {
            type: childVal(element, 'ofPieType') === 'bar' ? 'bar' : 'pie',
            splitType: childVal(element, 'splitType') ?? 'auto',
            splitPos: childNumber(element, 'splitPos', -1e300, 1e300),
            secondSize: childNumber(element, 'secondPieSize', 5, 200) ?? 75,
            serLines: child(element, 'serLines'),
          }
        : null,
    wireframe: kind === 'surface' && childFlag(element, 'wireframe', false),
    bandFormats: kind === 'surface' ? readBandFormats(element) : new Map(),
  };
}

/** `c:bandFmts/c:bandFmt` shape properties by band index. */
function readBandFormats(element: OoxmlElement): Map<number, OoxmlElement> {
  const out = new Map<number, OoxmlElement>();
  for (const format of children(child(element, 'bandFmts'), 'bandFmt').slice(0, MAX_SERIES)) {
    const index = childNumber(format, 'idx', 0, MAX_SERIES);
    const spPr = child(format, 'spPr');
    if (index !== null && spPr) out.set(index, spPr);
  }
  return out;
}

const POSITIONS = new Set(['b', 't', 'l', 'r']);

function readAxis(element: OoxmlElement): ChartAxis | null {
  const kind: ChartAxisKind | null =
    element.localName === 'catAx'
      ? 'category'
      : element.localName === 'valAx'
        ? 'value'
        : element.localName === 'dateAx'
          ? 'date'
          : element.localName === 'serAx'
            ? 'series'
            : null;
  if (!kind) return null;
  const id = childVal(element, 'axId');
  if (!id) return null;
  const scaling = child(element, 'scaling');
  const numFmt = child(element, 'numFmt');
  const position = childVal(element, 'axPos');
  const crossesAt = childNumber(element, 'crossesAt', -1e300, 1e300);
  const crosses = childVal(element, 'crosses');
  const tickMark = childVal(element, 'majorTickMark');
  const labelPosition = childVal(element, 'tickLblPos');
  const crossBetween = childVal(element, 'crossBetween');
  const timeUnit = childVal(element, 'baseTimeUnit');
  return {
    id,
    kind,
    element,
    deleted: childFlag(element, 'delete', false),
    position: position && POSITIONS.has(position) ? (position as ChartAxis['position']) : 'b',
    crossAxisId: childVal(element, 'crossAx') ?? null,
    reversed: childVal(scaling, 'orientation') === 'maxMin',
    min: childNumber(scaling, 'min', -1e300, 1e300),
    max: childNumber(scaling, 'max', -1e300, 1e300),
    majorUnit: childNumber(element, 'majorUnit', 1e-300, 1e300),
    logBase: childNumber(scaling, 'logBase', 2, 1000),
    formatCode: numFmt ? (schemaAttributeValue(numFmt.attributes, 'formatCode') ?? null) : null,
    sourceLinked: numFmt ? schemaAttributeValue(numFmt.attributes, 'sourceLinked') === '1' : true,
    majorGridlines: child(element, 'majorGridlines'),
    minorGridlines: child(element, 'minorGridlines'),
    majorTickMark:
      tickMark === 'none' || tickMark === 'in' || tickMark === 'out' || tickMark === 'cross'
        ? tickMark
        : 'cross',
    tickLabelPosition:
      labelPosition === 'low' || labelPosition === 'high' || labelPosition === 'none'
        ? labelPosition
        : 'nextTo',
    spPr: child(element, 'spPr'),
    txPr: child(element, 'txPr'),
    title: child(element, 'title'),
    crosses:
      crossesAt !== null
        ? crossesAt
        : crosses === 'min' || crosses === 'max'
          ? crosses
          : 'autoZero',
    crossBetween: crossBetween === 'between' || crossBetween === 'midCat' ? crossBetween : null,
    tickLabelSkip: childNumber(element, 'tickLblSkip', 1, 32_000),
    baseTimeUnit:
      timeUnit === 'days' || timeUnit === 'months' || timeUnit === 'years' ? timeUnit : null,
  };
}

export function readManualLayout(layout: OoxmlElement | null): ChartManualLayout | null {
  const manual = child(layout, 'manualLayout');
  if (!manual) return null;
  const fraction = (name: string) => childNumber(manual, name, -10, 10);
  const x = fraction('x');
  const y = fraction('y');
  const w = fraction('w');
  const h = fraction('h');
  if (x === null || y === null) return null;
  // Edge mode places the box by its corner; factor mode moves it from where auto layout put
  // it, which the model cannot know, so only edge positions are honoured.
  if (childVal(manual, 'xMode') === 'factor' || childVal(manual, 'yMode') === 'factor') return null;
  return {
    inner: childVal(manual, 'layoutTarget') !== 'outer',
    x,
    y,
    w: w ?? 0,
    h: h ?? 0,
  };
}

function readLegend(element: OoxmlElement | null): ChartLegend | null {
  if (!element) return null;
  const position = childVal(element, 'legendPos');
  const deleted = new Set<number>();
  for (const entry of children(element, 'legendEntry')) {
    const index = childNumber(entry, 'idx', 0, 100_000);
    if (index !== null && childFlag(entry, 'delete', false)) deleted.add(index);
  }
  return {
    element,
    position:
      position === 'b' || position === 't' || position === 'l' || position === 'tr'
        ? position
        : 'r',
    overlay: childFlag(element, 'overlay', false),
    txPr: child(element, 'txPr'),
    spPr: child(element, 'spPr'),
    layout: readManualLayout(child(element, 'layout')),
    deleted,
  };
}

/** The chart style: `c:style`, or the fallback of an `mc:AlternateContent` around it. */
function readStyle(chartSpace: OoxmlElement): number {
  const direct = childNumber(chartSpace, 'style', 1, 48);
  if (direct !== null) return direct;
  for (const node of chartSpace.children) {
    if (!isElement(node) || node.localName !== 'AlternateContent') continue;
    for (const branch of node.children) {
      if (!isElement(branch) || branch.localName !== 'Fallback') continue;
      const style = childNumber(branch, 'style', 1, 48);
      if (style !== null) return style;
    }
  }
  return 2;
}

/** The model of a chart part, or null when it holds a chart outside the supported set. */
export function readChartModel(chartSpace: OoxmlElement): ChartModel | null {
  const chart = child(chartSpace, 'chart');
  const plotArea = child(chart, 'plotArea');
  if (!chart || !plotArea) return null;
  const budget: Budget = { remaining: MAX_TOTAL_POINTS };
  const plots: ChartPlot[] = [];
  const axes = new Map<string, ChartAxis>();
  for (const node of plotArea.children) {
    if (!isElement(node) || node.namespaceUri !== C) continue;
    if (PLOT_KINDS.has(node.localName)) {
      if (plots.length >= MAX_PLOTS) return null;
      const plot = readPlot(node, budget);
      if (!plot) return null;
      plots.push(plot);
      continue;
    }
    const axis = readAxis(node);
    if (axis) axes.set(axis.id, axis);
  }
  if (plots.length === 0) return null;
  return {
    chartSpace,
    date1904: childFlag(chartSpace, 'date1904', false),
    style: readStyle(chartSpace),
    roundedCorners: childFlag(chartSpace, 'roundedCorners', true),
    spPr: child(chartSpace, 'spPr'),
    txPr: child(chartSpace, 'txPr'),
    title: child(chart, 'title'),
    autoTitleDeleted: childFlag(chart, 'autoTitleDeleted', false),
    plotSpPr: child(plotArea, 'spPr'),
    plotLayout: readManualLayout(child(plotArea, 'layout')),
    plots,
    axes,
    legend: readLegend(child(chart, 'legend')),
    view3D: child(chart, 'view3D'),
    floor: child(chart, 'floor'),
    sideWall: child(chart, 'sideWall'),
    backWall: child(chart, 'backWall'),
  };
}
