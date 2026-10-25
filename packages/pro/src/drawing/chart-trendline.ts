/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Trendlines and error bars of a series, in data units.
//
// A trendline fits the series by least squares (linear, exponential, logarithmic, power,
// polynomial up to order six) or averages it (moving average), over the series' own x range
// extended by `c:forward`/`c:backward`. Error bars span a fixed value, a percentage, standard
// deviations or the standard error, or values cached in the chart part. Both widen the value
// axis, so the scale reads them before layout.

import { type OoxmlElement } from '@docx-editor.dev/core/store';
import { child, childFlag, childVal, type ChartPlot, type ChartSeries } from './chart-model.ts';
import { formatGeneral } from './chart-number-format.ts';

const CURVE_SAMPLES = 64;
const MAX_POLY_ORDER = 6;

export interface DataPoint {
  readonly x: number;
  readonly y: number;
}

export interface Trendline {
  readonly element: OoxmlElement;
  /** Curve samples in data units; x is 1-based for category plots. */
  readonly points: readonly DataPoint[];
  /** Legend text: the authored name, or the type with the series name. */
  readonly name: string;
  /** Equation and R squared lines the file asks to display. */
  readonly label: readonly string[];
}

/** The x value of each point: scatter x values, or 1-based category numbers. */
export function seriesXs(plot: ChartPlot, series: ChartSeries): (number | null)[] {
  const xy = plot.kind === 'scatter' || plot.kind === 'bubble';
  return series.values.map((_, index) =>
    xy && series.xValues ? (series.xValues[index] ?? null) : index + 1
  );
}

function pairs(plot: ChartPlot, series: ChartSeries): DataPoint[] {
  const xs = seriesXs(plot, series);
  const out: DataPoint[] = [];
  for (const [index, y] of series.values.entries()) {
    const x = xs[index];
    if (x === null || x === undefined || y === null || y === undefined) continue;
    if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
  }
  return out;
}

/** Least-squares polynomial coefficients, lowest order first, or null when singular. */
function polyfit(points: readonly DataPoint[], order: number): number[] | null {
  const size = order + 1;
  const matrix: number[][] = Array.from({ length: size }, () => Array(size + 1).fill(0));
  for (const { x, y } of points) {
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) matrix[row]![column]! += x ** (row + column);
      matrix[row]![size]! += y * x ** row;
    }
  }
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(matrix[row]![pivot]!) > Math.abs(matrix[best]![pivot]!)) best = row;
    }
    if (Math.abs(matrix[best]![pivot]!) < 1e-12) return null;
    [matrix[pivot], matrix[best]] = [matrix[best]!, matrix[pivot]!];
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = matrix[row]![pivot]! / matrix[pivot]![pivot]!;
      for (let column = pivot; column <= size; column += 1) {
        matrix[row]![column]! -= factor * matrix[pivot]![column]!;
      }
    }
  }
  return matrix.map((row, index) => row[size]! / row[index]!);
}

function number(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return formatGeneral(Number(value.toPrecision(4)));
}

function term(coefficient: number, first: boolean, body: string): string {
  const sign = coefficient < 0 ? (first ? '-' : ' - ') : first ? '' : ' + ';
  return `${sign}${number(Math.abs(coefficient))}${body}`;
}

const SUPERSCRIPTS = ['', '', '²', '³', '⁴', '⁵', '⁶'];

/** Fit one trendline, or null when the series cannot carry it. */
function fit(element: OoxmlElement, plot: ChartPlot, series: ChartSeries): Trendline | null {
  const type = childVal(element, 'trendlineType') ?? 'linear';
  const points = pairs(plot, series);
  if (points.length < 2) return null;
  const xs = points.map((point) => point.x);
  const forward = Number(childVal(element, 'forward') ?? 0) || 0;
  const backward = Number(childVal(element, 'backward') ?? 0) || 0;
  const low = Math.min(...xs) - Math.max(0, Math.min(backward, 1e6));
  const high = Math.max(...xs) + Math.max(0, Math.min(forward, 1e6));
  const seriesName = series.name ?? `Series${series.index + 1}`;
  const authoredName = child(element, 'name');
  let named = '';
  for (const node of authoredName?.children ?? [])
    if (node.kind === 'textValue') named += node.value;
  let model: ((x: number) => number) | null = null;
  let equation = '';
  let typeName = 'Linear';
  if (type === 'movingAvg') {
    const period = Math.max(
      2,
      Math.min(255, Math.round(Number(childVal(element, 'period') ?? 2) || 2))
    );
    const sorted = [...points].sort((a, b) => a.x - b.x);
    const curve: DataPoint[] = [];
    for (let index = period - 1; index < sorted.length; index += 1) {
      let sum = 0;
      for (let back = 0; back < period; back += 1) sum += sorted[index - back]!.y;
      curve.push({ x: sorted[index]!.x, y: sum / period });
    }
    if (curve.length < 2) return null;
    return {
      element,
      points: curve,
      name: named || `${period} per. Mov. Avg. (${seriesName})`,
      label: [],
    };
  }
  const intercept = childVal(element, 'intercept');
  if (type === 'linear' || type === 'poly') {
    const order =
      type === 'poly'
        ? Math.max(
            2,
            Math.min(MAX_POLY_ORDER, Math.round(Number(childVal(element, 'order') ?? 2) || 2))
          )
        : 1;
    const coefficients = polyfit(points, order);
    if (!coefficients) return null;
    if (intercept !== undefined && order === 1 && Number.isFinite(Number(intercept))) {
      // A set intercept fixes b; the slope fits what is left.
      const b = Number(intercept);
      let numerator = 0;
      let denominator = 0;
      for (const point of points) {
        numerator += point.x * (point.y - b);
        denominator += point.x * point.x;
      }
      coefficients[0] = b;
      coefficients[1] = denominator ? numerator / denominator : 0;
    }
    model = (x) =>
      coefficients.reduce((sum, coefficient, power) => sum + coefficient * x ** power, 0);
    const terms: string[] = [];
    for (let power = order; power >= 0; power -= 1) {
      const coefficient = coefficients[power]!;
      if (power > 0 && Math.abs(coefficient) < 1e-15) continue;
      const body = power === 0 ? '' : power === 1 ? 'x' : `x${SUPERSCRIPTS[power]}`;
      terms.push(term(coefficient, terms.length === 0, body));
    }
    equation = `y = ${terms.join('')}`;
    typeName = type === 'poly' ? 'Poly.' : 'Linear';
  } else if (type === 'exp' || type === 'log' || type === 'power') {
    const usable = points.filter(
      (point) => (type === 'log' || point.y > 0) && (type === 'exp' || point.x > 0)
    );
    const transformed = usable.map((point) => ({
      x: type === 'exp' ? point.x : Math.log(point.x),
      y: type === 'log' ? point.y : Math.log(point.y),
    }));
    const coefficients = transformed.length >= 2 ? polyfit(transformed, 1) : null;
    if (!coefficients) return null;
    const [c0, c1] = coefficients as [number, number];
    if (type === 'exp') {
      model = (x) => Math.exp(c0) * Math.exp(c1 * x);
      equation = `y = ${number(Math.exp(c0))}e^${number(c1)}x`;
      typeName = 'Expon.';
    } else if (type === 'log') {
      model = (x) => (x > 0 ? c0 + c1 * Math.log(x) : NaN);
      equation = `y = ${number(c1)}ln(x)${term(c0, false, '')}`;
      typeName = 'Log.';
    } else {
      model = (x) => (x > 0 ? Math.exp(c0) * x ** c1 : NaN);
      equation = `y = ${number(Math.exp(c0))}x^${number(c1)}`;
      typeName = 'Power';
    }
  } else {
    return null;
  }
  const curve: DataPoint[] = [];
  for (let step = 0; step <= CURVE_SAMPLES; step += 1) {
    const x = low + ((high - low) * step) / CURVE_SAMPLES;
    const y = model(x);
    if (Number.isFinite(y)) curve.push({ x, y });
  }
  const mean = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let residual = 0;
  let totalSquares = 0;
  for (const point of points) {
    residual += (point.y - model(point.x)) ** 2;
    totalSquares += (point.y - mean) ** 2;
  }
  const label: string[] = [];
  if (childFlag(element, 'dispEq', false)) label.push(equation);
  if (childFlag(element, 'dispRSqr', false)) {
    label.push(`R² = ${number(totalSquares ? 1 - residual / totalSquares : 1)}`);
  }
  return { element, points: curve, name: named || `${typeName} (${seriesName})`, label };
}

/** The trendlines of a series that can be fitted. */
export function seriesTrendlines(plot: ChartPlot, series: ChartSeries): Trendline[] {
  const out: Trendline[] = [];
  for (const element of series.trendlines) {
    const line = fit(element, plot, series);
    if (line) out.push(line);
  }
  return out;
}

export interface ErrorBar {
  readonly direction: 'x' | 'y';
  /** The point the bar is drawn through. */
  readonly at: DataPoint;
  readonly from: number;
  readonly to: number;
  readonly caps: boolean;
  readonly element: OoxmlElement;
}

function cachedValues(element: OoxmlElement, name: string): (number | null)[] {
  const source = child(element, name);
  const cache = child(child(source, 'numRef'), 'numCache') ?? child(source, 'numLit');
  const out: (number | null)[] = [];
  for (const point of cache?.children ?? []) {
    if (point.kind === 'textValue' || point.localName !== 'pt') continue;
    const index = Number(
      point.attributes.find((attribute) => attribute.localName === 'idx')?.value
    );
    let text = '';
    for (const node of child(point, 'v')?.children ?? [])
      if (node.kind === 'textValue') text += node.value;
    if (Number.isInteger(index) && index >= 0 && index < 4096) out[index] = Number(text);
  }
  return out;
}

/** The error bars of a series, one per point and direction. */
export function seriesErrorBars(plot: ChartPlot, series: ChartSeries): ErrorBar[] {
  const out: ErrorBar[] = [];
  const xs = seriesXs(plot, series);
  const points = series.values.map((y, index) => ({ y, x: xs[index] }));
  const ys = series.values.filter(
    (value): value is number => value !== null && Number.isFinite(value)
  );
  for (const element of series.errorBars) {
    const direction = childVal(element, 'errDir') === 'x' ? 'x' : 'y';
    const kind = childVal(element, 'errBarType') ?? 'both';
    const valueType = childVal(element, 'errValType') ?? 'fixedVal';
    const amount = Number(childVal(element, 'val') ?? 0) || 0;
    const caps = !childFlag(element, 'noEndCap', false);
    const plus = cachedValues(element, 'plus');
    const minus = cachedValues(element, 'minus');
    const count = ys.length;
    const mean = count ? ys.reduce((sum, value) => sum + value, 0) / count : 0;
    const deviation =
      count > 1
        ? Math.sqrt(ys.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1))
        : 0;
    for (const [index, point] of points.entries()) {
      if (point.y === null || point.x === null || point.x === undefined) continue;
      const base = direction === 'y' ? point.y : point.x;
      let up = 0;
      let down = 0;
      if (valueType === 'percentage') up = down = Math.abs(base) * (amount / 100);
      else if (valueType === 'stdDev') up = down = deviation * amount;
      else if (valueType === 'stdErr') up = down = count ? deviation / Math.sqrt(count) : 0;
      else if (valueType === 'cust') {
        up = plus[index] ?? 0;
        down = minus[index] ?? 0;
      } else up = down = amount;
      if (!Number.isFinite(up) || !Number.isFinite(down)) continue;
      // Standard deviation bars centre on the mean, not on each point.
      const centre = valueType === 'stdDev' && direction === 'y' ? mean : base;
      const from = kind === 'plus' ? base : centre - down;
      const to = kind === 'minus' ? base : centre + up;
      out.push({ direction, at: { x: point.x, y: point.y }, from, to, caps, element });
    }
  }
  return out;
}
