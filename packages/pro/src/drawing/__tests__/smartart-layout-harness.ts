/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Compares synthesized SmartArt drawings with drawings Office saved for the same parts.
//
// The fixture set is a gzipped JSON file: deduplicated parts (data model, layout, quick
// style, colours) and, per case, the frame and the compared fields of each saved shape.
// The data models hold only synthetic text. Shapes match by presentation point id.

import { readFileSync } from 'node:fs';
import { gunzipSync, strFromU8 } from 'fflate';
import { synthesizeDiagramDrawing } from '../diagram-layout-synthesis.ts';
import { tableDiagramTextMeasurer } from '../diagram-layout-metrics.ts';
import { readOoxmlPart, type OoxmlElement } from '../../../../core/src/store/package/ooxml-tree.ts';
import { isElement } from '../../../../core/src/store/package/drawing-projection-walk.ts';

export interface SavedTransform {
  readonly x: number;
  readonly y: number;
  readonly cx: number;
  readonly cy: number;
  readonly rot: number;
  readonly flipH: boolean;
  readonly flipV: boolean;
}

export interface SavedShape {
  readonly modelId: string;
  readonly presName: string | null;
  readonly prst: string | null;
  readonly xfrm: SavedTransform | null;
  readonly txXfrm: SavedTransform | null;
  readonly fontSizes: readonly number[];
  readonly hasText: boolean;
}

export interface LayoutCase {
  readonly id: string;
  readonly layout: string;
  readonly fonts: readonly [string, string];
  readonly frame: readonly [number, number];
  readonly parts: Readonly<Record<'data' | 'layout' | 'style' | 'colors', string>>;
  readonly shapes: readonly SavedShape[];
}

export interface LayoutFixtures {
  readonly parts: Readonly<Record<string, string>>;
  readonly cases: readonly LayoutCase[];
}

export function loadLayoutFixtures(path: string): LayoutFixtures {
  return JSON.parse(strFromU8(gunzipSync(readFileSync(path)))) as LayoutFixtures;
}

function parse(xml: string, name: string): OoxmlElement {
  const result = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!result.ok) throw new Error(`fixture part ${name} does not parse: ${result.reason}`);
  return result.part.root;
}

function children(element: OoxmlElement, localName: string): OoxmlElement[] {
  const out: OoxmlElement[] = [];
  for (const node of element.children) {
    if (isElement(node) && node.localName === localName) out.push(node);
  }
  return out;
}

function first(element: OoxmlElement | undefined, localName: string): OoxmlElement | undefined {
  return element ? children(element, localName)[0] : undefined;
}

function number(element: OoxmlElement | undefined, name: string): number {
  const value = element?.attributes.find((attribute) => attribute.localName === name)?.value;
  return value === undefined ? 0 : Number(value);
}

function transform(element: OoxmlElement | undefined): SavedTransform | null {
  if (!element) return null;
  const off = first(element, 'off');
  const ext = first(element, 'ext');
  return {
    x: number(off, 'x'),
    y: number(off, 'y'),
    cx: number(ext, 'cx'),
    cy: number(ext, 'cy'),
    rot: number(element, 'rot'),
    flipH: number(element, 'flipH') === 1,
    flipV: number(element, 'flipV') === 1,
  };
}

export interface SynthesizedShape {
  readonly modelId: string;
  readonly prst: string | null;
  readonly xfrm: SavedTransform | null;
  readonly txXfrm: SavedTransform | null;
  readonly fontSizes: readonly number[];
}

/** The compared fields of each `dsp:sp` in a drawing. */
export function drawingShapes(drawing: OoxmlElement): SynthesizedShape[] {
  const tree = first(drawing, 'spTree');
  if (!tree) return [];
  return children(tree, 'sp').map((sp) => {
    const spPr = first(sp, 'spPr');
    const sizes: number[] = [];
    const body = first(sp, 'txBody');
    for (const p of body ? children(body, 'p') : []) {
      for (const r of children(p, 'r')) sizes.push(number(first(r, 'rPr'), 'sz'));
    }
    return {
      modelId: sp.attributes.find((attribute) => attribute.localName === 'modelId')?.value ?? '',
      prst:
        first(spPr, 'prstGeom')?.attributes.find((attribute) => attribute.localName === 'prst')
          ?.value ?? null,
      xfrm: transform(first(spPr, 'xfrm')),
      txXfrm: transform(first(sp, 'txXfrm')),
      fontSizes: sizes,
    };
  });
}

export interface CaseScore {
  readonly id: string;
  readonly layout: string;
  /** Null when the engine refused the diagram. */
  readonly synthesized: number | null;
  readonly shapes: number;
  readonly boxes: number;
  readonly presets: number;
  readonly rotations: number;
  readonly fontsCompared: number;
  readonly fonts: number;
  readonly misses: readonly string[];
}

/**
 * Lay a case out with its saved drawing hidden and score it against the saved shapes:
 * box within max(1% of the frame, 1 pt), preset and rotation exact, font within 1 pt.
 */
export function scoreCase(fixtures: LayoutFixtures, item: LayoutCase): CaseScore {
  const part = (key: 'data' | 'layout' | 'style' | 'colors') =>
    parse(fixtures.parts[item.parts[key]]!, `/${item.id}/${key}.xml`);
  const drawing = synthesizeDiagramDrawing(
    {
      dataModel: part('data'),
      layoutDef: part('layout'),
      styleDef: part('style'),
      colorsDef: part('colors'),
    },
    { cx: item.frame[0], cy: item.frame[1] },
    { fontFamily: item.fonts[0], measurer: tableDiagramTextMeasurer }
  );
  const misses: string[] = [];
  const base = {
    id: item.id,
    layout: item.layout,
    shapes: item.shapes.length,
  };
  if (!drawing) {
    return {
      ...base,
      synthesized: null,
      boxes: 0,
      presets: 0,
      rotations: 0,
      fontsCompared: 0,
      fonts: 0,
      misses: ['refused'],
    };
  }
  const made = new Map(drawingShapes(drawing).map((shape) => [shape.modelId, shape]));
  const tolerance = Math.max(0.01 * Math.max(item.frame[0], item.frame[1]), 12_700);
  let boxes = 0;
  let presets = 0;
  let rotations = 0;
  let fonts = 0;
  let fontsCompared = 0;
  for (const saved of item.shapes) {
    const shape = made.get(saved.modelId);
    const name = saved.presName ?? saved.modelId;
    if (!shape || !shape.xfrm || !saved.xfrm) {
      misses.push(`${name}: missing`);
      continue;
    }
    const a = shape.xfrm;
    const b = saved.xfrm;
    const deltas = [a.x - b.x, a.y - b.y, a.cx - b.cx, a.cy - b.cy];
    if (deltas.every((delta) => Math.abs(delta) <= tolerance)) boxes++;
    else misses.push(`${name}: box off by ${deltas.map(Math.round).join(',')}`);
    if (shape.prst === saved.prst) presets++;
    else misses.push(`${name}: preset ${shape.prst} for ${saved.prst}`);
    if (a.rot % 21_600_000 === b.rot % 21_600_000) rotations++;
    else misses.push(`${name}: rotation ${a.rot} for ${b.rot}`);
    if (saved.txXfrm && saved.hasText) {
      const frame = shape.txXfrm;
      const want = saved.txXfrm;
      const off = frame
        ? [frame.x - want.x, frame.y - want.y, frame.cx - want.cx, frame.cy - want.cy]
        : null;
      if (!off || off.some((delta) => Math.abs(delta) > tolerance)) {
        misses.push(`${name}: text frame off by ${off ? off.map(Math.round).join(',') : 'none'}`);
      }
    }
    if (saved.hasText && saved.fontSizes.length > 0) {
      fontsCompared++;
      const want = saved.fontSizes[0]! / 100;
      const got = (shape.fontSizes[0] ?? 0) / 100;
      if (Math.abs(got - want) <= 1) fonts++;
      else misses.push(`${name}: font ${got} for ${want}`);
    }
  }
  return {
    ...base,
    synthesized: made.size,
    boxes,
    presets,
    rotations,
    fontsCompared,
    fonts,
    misses,
  };
}
