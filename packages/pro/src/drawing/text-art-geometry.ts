/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The text path of a VML text path shape: the guide lines its text is laid between or along,
// in the unit square of the shape box.
//
// A text path shape's geometry is its template's `path`, evaluated with the template's
// formulas over the adjust values (`adj`), the shape's own values replacing the template's
// slot by slot. A shape whose drawing holds no template reads the standard one of its type,
// when the type has one here.

import { vmlFormulaValues } from '@docx-editor.dev/core/store';
import type { LegacyTextArtModel, TextArtTemplateModel } from './text-art-model.ts';
import { traceVmlPath, type PathPoint } from './text-art-vml-path.ts';

/** The standard templates of the text path types this module knows without the file's. */
const STANDARD: ReadonlyMap<
  number,
  Pick<TextArtTemplateModel, 'adj' | 'path' | 'formulas'>
> = new Map([
  [
    136,
    {
      adj: '10800',
      path: 'm@7,l@8,m@5,21600l@6,21600e',
      formulas: [
        'sum #0 0 10800',
        'prod #0 2 1',
        'sum 21600 0 @1',
        'sum 0 0 @2',
        'sum 21600 0 @3',
        'if @0 @3 0',
        'if @0 21600 @1',
        'if @0 0 @2',
        'if @0 @4 21600',
        'mid @5 @6',
        'mid @8 @5',
        'mid @7 @8',
        'mid @6 @7',
        'sum @6 0 @5',
      ],
    },
  ],
  [
    138,
    {
      adj: '10800',
      path: 'm0@0l10800,,21600@0m,21600r10800,l21600,21600e',
      formulas: ['val #0', 'prod #0 1 2', 'sum @1 10800 0', 'sum 21600 0 @1'],
    },
  ],
  [
    144,
    {
      adj: '11796480',
      path: 'al10800,10800,10800,10800@2@14e',
      formulas: [
        'val #1',
        'val #0',
        'sum 0 0 #0',
        'sumangle #0 0 180',
        'sumangle #0 0 90',
        'prod @4 2 1',
        'sumangle #0 90 0',
        'prod @6 2 1',
        'abs #0',
        'sumangle @8 0 90',
        'if @9 @7 @5',
        'sumangle @10 0 360',
        'if @10 @11 @10',
        'sumangle @12 0 360',
        'if @12 @13 @12',
        'sum 0 0 @14',
        'val 10800',
        'cos 10800 #0',
        'sin 10800 #0',
        'sum @17 10800 0',
        'sum @18 10800 0',
        'sum 10800 0 @17',
        'if @9 0 21600',
        'sum 10800 0 @18',
      ],
    },
  ],
]);

const MAX_ADJUST = 8;

/** A comma list of adjust values; an empty slot keeps the default. Null when malformed. */
function adjustList(raw: string | undefined): (number | undefined)[] | null {
  if (raw === undefined || raw.trim() === '') return [];
  const slots = raw.split(',');
  if (slots.length > MAX_ADJUST) return null;
  const values: (number | undefined)[] = [];
  for (const slot of slots) {
    const value = slot.trim();
    if (value === '') values.push(undefined);
    else if (/^-?\d{1,10}$/.test(value)) values.push(Number(value));
    else return null;
  }
  return values;
}

/** Two positive numbers `w,h`, the coordinate size; 21600 square when absent. */
function pair(raw: string | undefined, fallback: number): [number, number] | null {
  if (raw === undefined) return [fallback, fallback];
  const parts = raw.split(',').map((part) => part.trim());
  if (parts.length !== 2 || !parts.every((part) => /^-?\d{1,9}$/.test(part))) return null;
  return [Number(parts[0]), Number(parts[1])];
}

/** The type number a model's template and shape agree on, or null. */
function shapeType(model: LegacyTextArtModel): number | null {
  const match = /^#_x0000_t(\d{3})$/.exec(model.shape.type ?? '');
  return match ? Number(match[1]) : null;
}

/**
 * The guide lines of a text path shape in the unit square of its box (x right, y down), or
 * null when its geometry cannot be read. A plain text path has two, its top and bottom.
 */
export function textArtGuides(model: LegacyTextArtModel): readonly (readonly PathPoint[])[] | null {
  const spt = shapeType(model);
  if (spt === null) return null;
  const template = model.template;
  if (template && template.spt !== undefined && Number(template.spt) !== spt) return null;
  const standard = STANDARD.get(spt);
  const source = template ?? standard;
  if (!source) return null;
  // A shape path of its own replaces the template's; it then reads the template's formulas.
  const path = model.shape.path ?? source.path;
  if (!path) return null;
  const defaults = adjustList(source.adj);
  const own = adjustList(model.shape.adj);
  if (!defaults || !own) return null;
  // A slot neither the shape nor the template sets reads as 0.
  const adjust: number[] = [];
  for (let i = 0; i < MAX_ADJUST; i++) adjust.push(own[i] ?? defaults[i] ?? 0);
  const size = pair(model.shape.coordsize ?? template?.coordsize, 21600);
  const origin = pair(model.shape.coordorigin ?? template?.coordorigin, 0);
  if (!size || !origin || !(size[0] > 0 && size[1] > 0)) return null;
  const values = vmlFormulaValues(source.formulas, {
    width: size[0],
    height: size[1],
    adjust,
  });
  if (!values) return null;
  const traced = traceVmlPath(path, values);
  if (!traced || !traced.length) return null;
  const unit = traced.map((subpath) =>
    Object.freeze(
      subpath.points.map((point) =>
        Object.freeze({
          x: (point.x - origin[0]) / size[0],
          y: (point.y - origin[1]) / size[1],
        })
      )
    )
  );
  if (!unit.every((points) => points.every((p) => Math.abs(p.x) <= 4 && Math.abs(p.y) <= 4)))
    return null;
  return Object.freeze(unit);
}
