/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// One border band as PDF operators: paragraph, page and table rules (ECMA-376 §17.18.2).
//
// Layout publishes the band; this module only fills it with the marks of its line style.

import {
  borderDashPatternPt,
  borderLineStrokesForExtentPt,
  DASH_DOT_STROKED_HATCH,
  type LayoutBox,
  type TableBorderStrokeRecord,
} from '@docx-editor.dev/core/layout';
import { color, number as n, rect } from './context.ts';

/** Border styles `rule()` draws as authored; any other style is drawn as an approximation. */
export const FAITHFUL_RULES: ReadonlySet<string> = new Set([
  'single',
  'thick',
  'dashed',
  'dotted',
  'dotDash',
  'dotDotDash',
  'dashSmallGap',
  'dashDotStroked',
  'double',
  'triple',
  'thinThickSmallGap',
  'thickThinSmallGap',
  'thinThickThinSmallGap',
  'thinThickMediumGap',
  'thickThinMediumGap',
  'thinThickThinMediumGap',
  'thinThickLargeGap',
  'thickThinLargeGap',
  'thinThickThinLargeGap',
  'threeDEmboss',
  'threeDEngrave',
]);

/** Most hatch lines one band draws; a longer band is filled solid instead. */
const MAX_HATCH_LINES = 20_000;

/**
 * The band `box` broken by `dashPt` (ink first) along its length. The pattern is anchored to
 * the page origin, so adjacent bands continue one pattern.
 */
function dashedBand(
  box: LayoutBox,
  colorHex: string | null,
  dashPt: readonly number[],
  x: number,
  y: number,
  height: number
): string {
  const horizontal = box.width >= box.height;
  const across = horizontal ? box.height : box.width;
  const period = dashPt.reduce((sum, length) => sum + length, 0);
  if (!(period > 0) || !(across > 0)) return `${color(colorHex)} rg ${rect(box, x, y, height)} f`;
  const start = horizontal ? box.x + x : box.y + y;
  const phase = ((start % period) + period) % period;
  const sx = box.x + x + (horizontal ? 0 : across / 2);
  const sy = height - box.y - y - (horizontal ? across / 2 : 0);
  const ex = sx + (horizontal ? box.width : 0);
  const ey = sy - (horizontal ? 0 : box.height);
  return `${color(colorHex)} RG ${n(across)} w 0 J [${dashPt.map(n).join(' ')}] ${n(phase)} d ${n(sx)} ${n(sy)} m ${n(ex)} ${n(ey)} l S [] 0 d`;
}

/**
 * The `dashDotStroked` hatch across `box`: hairlines along `x + y = c` in page space, at the
 * hatch pitch, drawn where the slot pattern says.
 */
function hatchedBand(
  box: LayoutBox,
  colorHex: string | null,
  x: number,
  y: number,
  height: number
): string {
  const { pitchPt, lineWidthPt, slots } = DASH_DOT_STROKED_HATCH;
  const x0 = box.x + x;
  const y0 = box.y + y;
  const x1 = x0 + box.width;
  const y1 = y0 + box.height;
  const first = Math.ceil((x0 + y0) / pitchPt);
  const last = Math.floor((x1 + y1) / pitchPt);
  if (last - first > MAX_HATCH_LINES) return `${color(colorHex)} rg ${rect(box, x, y, height)} f`;
  const lines: string[] = [];
  for (let k = first; k <= last; k += 1) {
    if (!slots[((k % slots.length) + slots.length) % slots.length]) continue;
    const c = k * pitchPt;
    const from = Math.max(x0, c - y1);
    const to = Math.min(x1, c - y0);
    if (!(to > from)) continue;
    lines.push(`${n(from)} ${n(height - (c - from))} m ${n(to)} ${n(height - (c - to))} l`);
  }
  if (lines.length === 0) return '';
  return `q ${rect(box, x, y, height)} W n ${color(colorHex)} RG ${n(lineWidthPt)} w 0 J ${lines.join(' ')} S Q`;
}

/** Parallel bands of `box`, each `{offset, width, color}` across it. */
function parallelBands(
  box: LayoutBox,
  parts: readonly { offsetPt: number; widthPt: number; color: string | null }[],
  x: number,
  y: number,
  height: number
): string {
  const horizontal = box.width >= box.height;
  return parts
    .map((part) => {
      const band = horizontal
        ? { ...box, y: box.y + part.offsetPt, height: part.widthPt }
        : { ...box, x: box.x + part.offsetPt, width: part.widthPt };
      return `${color(part.color)} rg ${rect(band, x, y, height, true)} f`;
    })
    .join('\n');
}

/**
 * One border band in line style `style`. `x`, `y` place the band's coordinates on the page
 * and `height` is the page height.
 */
export function rule(
  box: LayoutBox,
  colorHex: string | null,
  style: string,
  x: number,
  y: number,
  height: number
): string {
  const horizontal = box.width >= box.height;
  const across = horizontal ? box.height : box.width;
  // A triple rule draws three equal strokes in its five-stroke band.
  if (style === 'triple') {
    const fifth = across / 5;
    return parallelBands(
      box,
      [0, 2, 4].map((index) => ({ offsetPt: index * fifth, widthPt: fifth, color: colorHex })),
      x,
      y,
      height
    );
  }
  // A double rule fills its published band as two equal strokes, as on screen.
  if (style === 'double' || style === 'doubleWave') {
    const third = across / 3;
    return parallelBands(
      box,
      [0, 2].map((index) => ({ offsetPt: index * third, widthPt: third, color: colorHex })),
      x,
      y,
      height
    );
  }
  const strokes = borderLineStrokesForExtentPt(style, across, colorHex);
  if (strokes) return parallelBands(box, strokes, x, y, height);
  if (style === 'dashDotStroked') return hatchedBand(box, colorHex, x, y, height);
  // The dash family breaks the band by its measured pattern; any other style fills it.
  const dashes = borderDashPatternPt(style, across);
  if (dashes) return dashedBand(box, colorHex, dashes, x, y, height);
  return `${color(colorHex)} rg ${rect(box, x, y, height, true)} f`;
}

/** One published table stroke: its pattern or hatch when it has one, else its CSS style. */
export function strokeRule(
  stroke: TableBorderStrokeRecord,
  x: number,
  y: number,
  height: number
): string {
  if (stroke.hatch) return hatchedBand(stroke, stroke.color, x, y, height);
  if (stroke.dashPt) return dashedBand(stroke, stroke.color, stroke.dashPt, x, y, height);
  return rule(stroke, stroke.color, stroke.cssStyle, x, y, height);
}
