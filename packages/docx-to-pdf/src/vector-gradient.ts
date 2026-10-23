/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { PDFDict, PDFName, type PDFDocument, type PDFPage } from 'pdf-lib';
import type { VectorGradient } from '@docx-editor.dev/core/layout';
import { number as n } from './context.ts';

const channels = (hex: string): number[] =>
  [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);

/**
 * The stop list as a PDF function over 0..1: one exponential segment per stop pair, joined by
 * a stitching function. Stops before 0 or past 1 are clamped, coincident stops keep the last.
 */
function stopFunction(doc: PDFDocument, gradient: VectorGradient) {
  const stops: { offset: number; color: number[] }[] = [];
  for (const stop of gradient.stops) {
    const offset = Math.max(0, Math.min(1, stop.offset));
    const color = channels(stop.hex);
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
  const shading = doc.context.register(
    doc.context.obj({
      ShadingType: gradient.kind === 'linear' ? 2 : 3,
      ColorSpace: 'DeviceRGB',
      // A linear gradient's coordinates are EMU and scale down to user space here; a radial
      // one lives in the unit square and its matrix carries the box size instead. Either
      // way every printed number keeps its precision.
      Coords:
        gradient.kind === 'linear'
          ? gradient.coords.map((value) => value / unit)
          : [gradient.coords[0]!, gradient.coords[1]!, 0, ...gradient.coords],
      Function: stopFunction(doc, gradient),
      Extend: [true, true],
    })
  );
  const resources = page.node.normalizedEntries().Resources;
  const shadings = resources.lookupMaybe(PDFName.of('Shading'), PDFDict) ?? doc.context.obj({});
  resources.set(PDFName.of('Shading'), shadings);
  const name = `ShapeShade${++nextShading}`;
  shadings.set(PDFName.of(name), shading);
  const [a, b, c, d, e, f] = gradient.matrix;
  const linear = gradient.kind === 'linear' ? 1 : unit;
  const matrix = [a / linear, b / linear, c / linear, d / linear, e / unit, f / unit];
  return `${matrix.map(n).join(' ')} cm /${name} sh`;
}
