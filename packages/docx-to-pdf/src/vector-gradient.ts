/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { PDFDict, PDFName, type PDFDocument, type PDFPage } from 'pdf-lib';
import type { VectorGradient } from '@docx-editor.dev/core/layout';
import { number as n } from './context.ts';

type Stop = VectorGradient['stops'][number];

const channels = (stop: Stop): number[] =>
  [0, 2, 4].map((offset) => Number.parseInt(stop.hex.slice(offset, offset + 2), 16) / 255);
const opacity = (stop: Stop): number[] => [Math.max(0, Math.min(1, stop.alpha))];

/**
 * The stop list as a PDF function over 0..1: one exponential segment per stop pair, joined by
 * a stitching function. Stops before 0 or past 1 are clamped, coincident stops keep the last.
 * `value` gives each stop's colour components: its RGB channels, or its opacity for a mask.
 */
function stopFunction(doc: PDFDocument, gradient: VectorGradient, value: (stop: Stop) => number[]) {
  const stops: { offset: number; color: number[] }[] = [];
  for (const stop of gradient.stops) {
    const offset = Math.max(0, Math.min(1, stop.offset));
    const color = value(stop);
    if (stops.length && offset <= stops[stops.length - 1]!.offset) {
      stops[stops.length - 1] = { offset: stops[stops.length - 1]!.offset, color };
    } else stops.push({ offset, color });
  }
  if (stops[0]!.offset > 0) stops.unshift({ offset: 0, color: stops[0]!.color });
  if (stops[stops.length - 1]!.offset < 1) {
    stops.push({ offset: 1, color: stops[stops.length - 1]!.color });
  }
  const segment = (from: number[], to: number[]) =>
    doc.context.obj({ FunctionType: 2, Domain: [0, 1], C0: from, C1: to, N: 1 });
  if (stops.length === 2) return segment(stops[0]!.color, stops[1]!.color);
  const functions = [];
  const bounds: number[] = [];
  const encode: number[] = [];
  for (let index = 0; index < stops.length - 1; index += 1) {
    functions.push(segment(stops[index]!.color, stops[index + 1]!.color));
    if (index > 0) bounds.push(stops[index]!.offset);
    encode.push(0, 1);
  }
  return doc.context.obj({
    FunctionType: 3,
    Domain: [0, 1],
    Functions: functions,
    Bounds: bounds,
    Encode: encode,
  });
}

let nextShading = 0;

/**
 * Register `gradient` as a page shading and return the operators that paint it inside the
 * current clip. `unit` converts the component's EMU space to the painter's user space.
 */
export function gradientShading(
  doc: PDFDocument,
  page: PDFPage,
  gradient: VectorGradient,
  unit: number
): string {
  const shadingOf = (colorSpace: 'DeviceRGB' | 'DeviceGray', value: (stop: Stop) => number[]) =>
    doc.context.register(
      doc.context.obj({
        ShadingType: gradient.kind === 'linear' ? 2 : 3,
        ColorSpace: colorSpace,
        // A linear gradient's coordinates are EMU and scale down to user space here; a radial
        // one lives in the unit square and its matrix carries the box size instead. Either
        // way every printed number keeps its precision.
        Coords:
          gradient.kind === 'linear'
            ? gradient.coords.map((value) => value / unit)
            : [gradient.coords[0]!, gradient.coords[1]!, 0, ...gradient.coords],
        Function: stopFunction(doc, gradient, value),
        Extend: [true, true],
      })
    );
  const resources = page.node.normalizedEntries().Resources;
  const shadings = resources.lookupMaybe(PDFName.of('Shading'), PDFDict) ?? doc.context.obj({});
  resources.set(PDFName.of('Shading'), shadings);
  const name = `ShapeShade${++nextShading}`;
  shadings.set(PDFName.of(name), shadingOf('DeviceRGB', channels));
  const [a, b, c, d, e, f] = gradient.matrix;
  const linear = gradient.kind === 'linear' ? 1 : unit;
  const matrix = [a / linear, b / linear, c / linear, d / linear, e / unit, f / unit];
  const paint = `${matrix.map(n).join(' ')} cm /${name} sh`;
  // Stops of one opacity paint through the component's constant alpha. Stops that differ
  // paint through a luminosity soft mask: the same gradient over their opacities in grey.
  const first = gradient.stops[0]?.alpha ?? 1;
  if (gradient.stops.every((stop) => Math.abs(stop.alpha - first) < 1e-6)) return paint;
  const mask = doc.context.register(
    doc.context.stream(`${matrix.map(n).join(' ')} cm /Mask sh`, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [-1e6, -1e6, 1e6, 1e6],
      Group: { S: 'Transparency', CS: 'DeviceGray' },
      Resources: { Shading: { Mask: shadingOf('DeviceGray', opacity) } },
    })
  );
  const states = resources.lookupMaybe(PDFName.of('ExtGState'), PDFDict) ?? doc.context.obj({});
  resources.set(PDFName.of('ExtGState'), states);
  const state = `ShapeShadeMask${nextShading}`;
  states.set(
    PDFName.of(state),
    doc.context.obj({ Type: 'ExtGState', ca: 1, SMask: { Type: 'Mask', S: 'Luminosity', G: mask } })
  );
  return `/${state} gs ${paint}`;
}
