/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Automatic value axis scaling.
//
// The axis starts at zero for data of one sign unless the data sits in a narrow band far from
// zero. The far end gets five percent of headroom. The major unit is the smallest 1, 2 or 5
// times a power of ten that divides the data span into at most nine and a half units and
// whose intervals fit the axis length the caller allows; the ends then round out to whole
// units. Fixed `c:min`, `c:max` and `c:majorUnit` win. 3-D axes take no headroom, and only
// the room on the axis limits their ticks.

/** The search for a unit starts near a tenth of the span. */
const MAX_INTERVALS = 10;
const MAX_DATA_UNITS = 9.5;
/** A tick count limit for any axis, whatever the file asks: bounds label and gridline work. */
const MAX_TICKS = 1_000;

export interface ValueScale {
  readonly min: number;
  readonly max: number;
  /** The tick step: added on a linear scale, multiplied on a logarithmic one. */
  readonly major: number;
  readonly ticks: readonly number[];
  /** The base of a logarithmic scale (`c:logBase`); absent for a linear one. */
  readonly logBase?: number;
}

/**
 * Where `value` sits between the scale's ends, as a share of the axis: linear, or by the
 * logarithm on a logarithmic scale, where a value at or below zero sits at the minimum.
 */
export function scaleRatio(scale: ValueScale, value: number): number {
  if (scale.logBase !== undefined) {
    if (!(value > 0)) return 0;
    const span = Math.log(scale.max / scale.min) || 1;
    return Math.log(value / scale.min) / span;
  }
  return (value - scale.min) / (scale.max - scale.min || 1);
}

/**
 * A logarithmic scale: from the power of `base` at or below the smallest positive value to
 * the power at or above the largest, with a tick at each power between. Fixed ends win when
 * positive. Values at or below zero have no place on the axis.
 */
export function logValueScale(
  dataMin: number,
  dataMax: number,
  base: number,
  fixedMin: number | null,
  fixedMax: number | null
): ValueScale {
  const log = (value: number) => Math.log(value) / Math.log(base);
  const low = dataMin > 0 ? dataMin : 1;
  const high = dataMax > 0 ? Math.max(dataMax, low) : low;
  const min = fixedMin !== null && fixedMin > 0 ? fixedMin : base ** Math.floor(log(low) + 1e-9);
  let max = fixedMax !== null && fixedMax > 0 ? fixedMax : base ** Math.ceil(log(high) - 1e-9);
  if (!(max > min)) max = min * base;
  const ticks: number[] = [];
  for (let index = 0; index <= MAX_TICKS; index += 1) {
    const value = Number((min * base ** index).toPrecision(12));
    if (value > max * (1 + 1e-9)) break;
    ticks.push(value);
  }
  return { min, max, major: base, ticks, logBase: base };
}

export interface ScaleRequest {
  readonly dataMin: number;
  readonly dataMax: number;
  /** Axis length in points, and the least room one interval needs. */
  readonly lengthPt: number;
  readonly minIntervalPt: number;
  readonly fixedMin: number | null;
  readonly fixedMax: number | null;
  readonly fixedMajor: number | null;
  /** Radar and 3-D axes end at the data: no headroom past the far end. */
  readonly noHeadroom?: boolean;
  /** 3-D axes: only the room on the axis limits the ticks, not the data span. */
  readonly roomOnly?: boolean;
}

function niceUnits(rough: number): number[] {
  const power = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 5, 10, 20].map((step) => step * power);
}

function roundUnit(value: number, unit: number): number {
  // Strip floating noise so 0.1 * 3 lands on 0.3.
  return Number((Math.round(value / unit) * unit).toPrecision(12));
}

/** The automatic scale for one value axis. */
export function autoValueScale(request: ScaleRequest): ValueScale {
  let dataMin = Number.isFinite(request.dataMin) ? request.dataMin : 0;
  let dataMax = Number.isFinite(request.dataMax) ? request.dataMax : 1;
  if (dataMin > dataMax) [dataMin, dataMax] = [dataMax, dataMin];
  if (request.fixedMin !== null) dataMin = Math.min(dataMin, request.fixedMin);
  if (request.fixedMax !== null) dataMax = Math.max(dataMax, request.fixedMax);
  if (dataMin === dataMax) {
    if (dataMax === 0) dataMax = 1;
    else if (dataMax > 0) dataMin = 0;
    else dataMax = 0;
  }
  // Zero is in range unless every value sits in the top sixth of the span from zero.
  let low = dataMin;
  let high = dataMax;
  if (request.fixedMin === null) {
    if (dataMin >= 0) low = dataMin > (5 / 6) * dataMax ? dataMin - (dataMax - dataMin) / 2 : 0;
  }
  if (request.fixedMax === null) {
    if (dataMax <= 0) high = dataMax < (5 / 6) * dataMin ? dataMax + (dataMax - dataMin) / 2 : 0;
  }
  const headroom = request.noHeadroom ? 0 : 0.05 * (high - low);
  const top = request.fixedMax ?? (high > 0 ? high + headroom : high);
  const bottom = request.fixedMin ?? (low < 0 ? low - headroom : low);
  const span = Math.max(top - bottom, Number.EPSILON);
  const intervals = Math.max(1, Math.floor(request.lengthPt / Math.max(1, request.minIntervalPt)));
  let major = request.fixedMajor ?? 0;
  if (!(major > 0) || span / major > MAX_TICKS) {
    major = 0;
    // The data span, before headroom, holds at most nine and a half units, unless both
    // ends are fixed and only the room on the axis limits the ticks.
    const fixedEnds =
      request.roomOnly === true || (request.fixedMin !== null && request.fixedMax !== null);
    const dataSpan = (request.fixedMax ?? high) - (request.fixedMin ?? low);
    for (const unit of niceUnits(span / MAX_INTERVALS)) {
      const count = Math.ceil(top / unit - 1e-9) - Math.floor(bottom / unit + 1e-9);
      // Axes limited by room alone still take at most ten intervals.
      const limit = request.roomOnly ? Math.min(intervals, MAX_INTERVALS) : intervals;
      if (count <= limit && (fixedEnds || dataSpan / unit <= MAX_DATA_UNITS)) {
        major = unit;
        break;
      }
    }
    if (major === 0) major = niceUnits(span)[2]!;
  }
  const min = request.fixedMin ?? roundUnit(Math.floor(bottom / major + 1e-9) * major, major);
  let max = request.fixedMax ?? roundUnit(Math.ceil(top / major - 1e-9) * major, major);
  if (max <= min) max = min + major;
  const ticks: number[] = [];
  for (let index = 0; index <= MAX_TICKS; index += 1) {
    const value = Number((min + index * major).toPrecision(12));
    if (value > max + major * 1e-9) break;
    ticks.push(value);
  }
  return { min, max, major, ticks };
}
