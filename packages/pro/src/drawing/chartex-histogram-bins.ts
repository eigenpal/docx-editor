/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The columns of a histogram and a Pareto chart, computed from the cached raw values.
//
// A chartex histogram caches the raw values only; the bins are computed here.
//
// Bins (`cx:binning`) start at the smallest value and are all one width:
// - `cx:binSize`: that width. `cx:binCount`: the value range split into that many bins, the
//   underflow and overflow bins included in the count.
// - Neither: automatic. Scott's normal reference rule, 3.5 sample standard deviations over
//   the cube root of the value count, rounded to two significant digits but never finer than
//   0.01. A width that rounds to zero (fewer than two values, equal values, a tiny spread)
//   becomes 5.
// - `underflow` and `overflow` (a number; `auto` is none) add a bin for the values at or past
//   the cutoff. A cutoff is used only strictly inside the value range, and an overflow only
//   above the underflow. The bins then run from the underflow, and the last one ends at the
//   overflow.
// - `intervalClosed` (`r` by default) names the closed side of each bin: `(a, b]`, the first
//   bin `[a, b]`; or `[a, b)`, the last bin `[a, b]`. Cutoff bins read `≤ u` and `> o`, or
//   `< u` and `≥ o`. Edges take the number format of the values.
//
// Aggregated columns (`cx:aggregation`) sum the values of each category text, in the order
// each category first appears; a category whose sum is negative is left out. A Pareto chart
// sorts its columns by value, largest first (ties keep their order), and its line shows the
// running total as a share of the whole.

import { formatChartNumber } from './chart-number-format.ts';
import { cxChild, cxNumber, type ChartexSeries } from './chartex-model.ts';
import { schemaAttributeValue, type OoxmlElement } from '@docx-editor.dev/core/store';

/** More bins than this, from a file-supplied count or width, and the chart does not render. */
export const MAX_HISTOGRAM_BINS = 1_000;
/** The width when the automatic rule gives none. */
export const FALLBACK_BIN_WIDTH = 5;

export interface Binning {
  /** The closed side of each bin. */
  readonly closed: 'l' | 'r';
  /** The bin width, or null. */
  readonly size: number | null;
  /** The number of bins, cutoff bins included, or null. */
  readonly count: number | null;
  readonly underflow: number | null;
  readonly overflow: number | null;
}

/** One column: its category text and its height. */
export interface HistogramColumn {
  readonly label: string;
  readonly value: number;
}

const AUTOMATIC: Binning = {
  closed: 'r',
  size: null,
  count: null,
  underflow: null,
  overflow: null,
};

/** The binning a series' `cx:layoutPr` asks for, or null when it has none. */
export function readBinning(layoutPr: OoxmlElement | null): Binning | null {
  const binning = cxChild(layoutPr, 'binning');
  if (!binning) return null;
  const size = cxNumber(cxChild(binning, 'binSize'), 'val');
  const countElement = cxChild(binning, 'binCount');
  const rawCount = countElement ? schemaAttributeValue(countElement.attributes, 'val') : undefined;
  let count: number | null = null;
  if (rawCount !== undefined && /^\d{1,12}$/.test(rawCount.trim())) {
    count = Number(rawCount.trim());
    if (count < 1) count = null;
  }
  return {
    closed: schemaAttributeValue(binning.attributes, 'intervalClosed') === 'l' ? 'l' : 'r',
    size: size !== null && size > 0 ? size : null,
    count: size !== null && size > 0 ? null : count,
    underflow: cxNumber(binning, 'underflow'),
    overflow: cxNumber(binning, 'overflow'),
  };
}

/** True when the series aggregates its values by category (`cx:aggregation`). */
export function aggregates(series: ChartexSeries): boolean {
  return cxChild(series.layoutPr, 'aggregation') !== null;
}

/** `value` without floating noise, so 0.6 + 3 * 0.01 reads 0.63. */
function clean(value: number): number {
  return Number(value.toPrecision(15));
}

/** A raw bin width rounded to two significant digits, never finer than 0.01; 0 when none. */
export function roundBinWidth(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 0;
  const step = Math.max(10 ** (Math.floor(Math.log10(raw)) - 1), 0.01);
  return Number((Math.round(raw / step) * step).toPrecision(12));
}

/** The automatic bin width of `values` (finite numbers). */
export function automaticBinWidth(values: readonly number[]): number {
  const count = values.length;
  if (count < 2) return FALLBACK_BIN_WIDTH;
  let sum = 0;
  for (const value of values) sum += value;
  const mean = sum / count;
  let squares = 0;
  for (const value of values) squares += (value - mean) ** 2;
  const deviation = Math.sqrt(squares / (count - 1));
  const width = roundBinWidth((3.5 * deviation) / Math.cbrt(count));
  return width > 0 ? width : FALLBACK_BIN_WIDTH;
}

/**
 * The histogram columns of `values` under `binning` (automatic when null), labelled in
 * `formatCode`. Values without a number are skipped; no values, no columns. Null when the
 * bins would number more than `MAX_HISTOGRAM_BINS`.
 */
export function histogramColumns(
  values: readonly (number | null)[],
  binning: Binning | null,
  formatCode: string | null
): HistogramColumn[] | null {
  const spec = binning ?? AUTOMATIC;
  const finite: number[] = [];
  for (const value of values) if (value !== null && Number.isFinite(value)) finite.push(value);
  if (finite.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const value of finite) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const under =
    spec.underflow !== null && spec.underflow > min && spec.underflow < max ? spec.underflow : null;
  const over =
    spec.overflow !== null &&
    spec.overflow > min &&
    spec.overflow < max &&
    (under === null || spec.overflow > under)
      ? spec.overflow
      : null;
  const low = under ?? min;
  const high = over ?? max;

  // Values near the number range overflow the span; the bins then have no finite edges.
  if (!Number.isFinite(high - low)) return null;
  let inner: number;
  let width: number;
  if (spec.count !== null) {
    if (spec.count > MAX_HISTOGRAM_BINS) return null;
    inner = Math.max(0, spec.count - (under === null ? 0 : 1) - (over === null ? 0 : 1));
    width = inner > 0 ? (high - low) / inner : 0;
  } else {
    width = spec.size ?? automaticBinWidth(finite);
    const span = (high - low) / width;
    if (!(span <= MAX_HISTOGRAM_BINS)) return null;
    inner = Math.max(1, Math.ceil(span - 1e-9));
  }
  if (!Number.isFinite(width) || !Number.isFinite(low + inner * width)) return null;
  const edges: number[] = [];
  for (let index = 0; index <= inner; index += 1) edges.push(clean(low + index * width));
  // A bin count ends exactly at the range; an overflow cuts the last bin short.
  if (spec.count !== null || over !== null) edges[inner] = high;

  const counts = new Array<number>(inner).fill(0);
  let underCount = 0;
  let overCount = 0;
  const right = spec.closed === 'r';
  for (const value of finite) {
    if (under !== null && (right ? value <= under : value < under)) {
      underCount += 1;
      continue;
    }
    const last = edges[inner]!;
    if (inner === 0 || (over !== null && (right ? value > last : value >= last))) {
      overCount += 1;
      continue;
    }
    counts[binIndex(edges, value, right)]! += 1;
  }

  const text = (value: number) => formatChartNumber(value, formatCode);
  const columns: HistogramColumn[] = [];
  if (under !== null) {
    columns.push({ label: `${right ? '≤' : '<'} ${text(under)}`, value: underCount });
  }
  for (let index = 0; index < inner; index += 1) {
    const from = text(edges[index]!);
    const to = text(edges[index + 1]!);
    const open = right ? index > 0 || under !== null : false;
    const closedEnd = right || (index === inner - 1 && over === null);
    columns.push({
      label: `${open ? '(' : '['}${from}, ${to}${closedEnd ? ']' : ')'}`,
      value: counts[index]!,
    });
  }
  if (over !== null || (inner === 0 && overCount > 0)) {
    columns.push({ label: `${right ? '>' : '≥'} ${text(over ?? low)}`, value: overCount });
  }
  return columns;
}

/** The inner bin of `value`: binary search over the edges, the closed side deciding ties. */
function binIndex(edges: readonly number[], value: number, right: boolean): number {
  const bins = edges.length - 1;
  let lo = 0;
  let hi = bins - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const end = edges[mid + 1]!;
    // Right-closed: the first bin whose end is at or past the value. Left-closed: the first
    // bin whose end is past it.
    if (right ? value <= end : value < end) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Aggregated columns: the values summed per category text, in first-appearance order,
 * without the categories whose sum is negative.
 */
export function aggregateColumns(
  categories: readonly (string | null)[],
  values: readonly (number | null)[]
): HistogramColumn[] {
  const sums = new Map<string, number>();
  for (const [index, value] of values.entries()) {
    if (value === null || !Number.isFinite(value)) continue;
    const label = categories[index] ?? '';
    sums.set(label, (sums.get(label) ?? 0) + value);
  }
  const columns: HistogramColumn[] = [];
  for (const [label, value] of sums) if (value >= 0) columns.push({ label, value: clean(value) });
  return columns;
}

/** Columns largest first; equal columns keep their order. */
export function paretoOrder(columns: readonly HistogramColumn[]): HistogramColumn[] {
  return columns
    .map((column, index) => ({ column, index }))
    .sort((a, b) => b.column.value - a.column.value || a.index - b.index)
    .map((entry) => entry.column);
}

/** The running total of `columns` as a share of their sum, one per column (0 when none). */
export function cumulativeShares(columns: readonly HistogramColumn[]): number[] {
  let total = 0;
  for (const column of columns) total += column.value;
  let running = 0;
  return columns.map((column) => {
    running += column.value;
    return total > 0 ? running / total : 0;
  });
}
