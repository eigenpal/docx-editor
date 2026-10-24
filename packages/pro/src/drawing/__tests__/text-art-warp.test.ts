/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// WordArt along text paths: the VML path tracer, the guides of a text path shape, gradient
// fills, extrusion, and the laid-out components the engine paints.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFixedMeasurer,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapedMeasurer,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
  type FontRequest,
} from '../../../../core/src/layout/index.ts';
import { layoutTextArt } from '../../../../core/src/layout/drawing-text-art.ts';
import { projectDrawingsInPart } from '../../../../core/src/store/package/drawing-projection.ts';
import { readOoxmlPart } from '../../../../core/src/store/package/ooxml-tree.ts';
import type { LegacyTextArtProjection } from '../../../../core/src/store/package/legacy-vml-text-art.ts';
import { installDrawing } from '../index.ts';
import { traceVmlPath } from '../text-art-vml-path.ts';
import { textArtRenderData } from '../text-art-render-data.ts';

installDrawing();
await initializeHarfBuzz();

const REQUEST: FontRequest = { family: 'DejaVu Sans', weight: 400, style: 'normal' };
const bytes = new Uint8Array(
  readFileSync(
    new URL('../../../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url)
  )
);
const resolved = createFontResourceSnapshot({
  epoch: 1,
  maxFontBytes: 2_000_000,
  resources: [
    { request: REQUEST, id: 'dejavu', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 },
  ],
  validateFont: harfBuzzFontValidator,
}).resolve(REQUEST);
if (resolved instanceof FontResolutionError) throw resolved;
const measurer = createShapedMeasurer({
  shaper: createHarfBuzzTextShaper(),
  resolveFont: () => resolved,
  fallback: createFixedMeasurer(6, 14),
  shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
  unicodeDataVersion: '15.1',
});

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';

const TRIANGLE =
  '<v:shapetype id="_x0000_t138" coordsize="21600,21600" o:spt="138" adj="10800" ' +
  'path="m0@0l10800,,21600@0m,21600r10800,l21600,21600e"><v:formulas><v:f eqn="val #0"/>' +
  '<v:f eqn="prod #0 1 2"/><v:f eqn="sum @1 10800 0"/><v:f eqn="sum 21600 0 @1"/></v:formulas>' +
  '<v:path textpathok="t" o:connecttype="custom"/><v:textpath on="t" fitshape="t"/>' +
  '<o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>';

function textArtOf(pict: string): LegacyTextArtProjection | undefined {
  const loaded = readOoxmlPart(
    `<w:document ${NS}><w:body><w:p><w:r><w:pict>${pict}</w:pict></w:r></w:p></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  return projectDrawingsInPart(loaded.part)[0]?.textArt;
}

const shape = (type: string, children: string, attrs = 'fillcolor="black" stroked="f"') =>
  `<v:shape id="art" type="#_x0000_t${type}" style="width:300pt;height:60pt" ${attrs}>` +
  `${children}<v:textpath style="font-family:&quot;DejaVu Sans&quot;" trim="t" string="WAVE"/>` +
  '</v:shape>';

describe('the VML path tracer', () => {
  test('an angle arc runs counterclockwise from its start angle', () => {
    // From the left end of the ellipse, a negative half turn passes over its top.
    const [arc] = traceVmlPath('al10800,10800,10800,10800,-11796480,-11796480e', [])!;
    const points = arc!.points;
    expect(points[0]!.x).toBeCloseTo(0);
    expect(points[0]!.y).toBeCloseTo(10800);
    expect(Math.min(...points.map((p) => p.y))).toBeCloseTo(0);
    expect(points.at(-1)!.x).toBeCloseTo(21600);
  });

  test('curves, quadrants and formula values trace; unknown commands do not', () => {
    const [curve] = traceVmlPath('m0,0c0,100,100,100,100,0e', [])!;
    expect(curve!.points.at(-1)).toEqual({ x: 100, y: 0 });
    const [quadrant] = traceVmlPath('m0,100qx100,0e', [])!;
    expect(quadrant!.points.at(-1)!.x).toBeCloseTo(100);
    expect(quadrant!.points.at(-1)!.y).toBeCloseTo(0);
    const [line] = traceVmlPath('m@0,0l@1,0e', [5, 7])!;
    expect(line!.points).toEqual([
      { x: 5, y: 0 },
      { x: 7, y: 0 },
    ]);
    expect(traceVmlPath('m0,0zz9e', [])).toBeNull();
  });
});

describe('text path shapes', () => {
  test('a triangle reads its two guides from the template the drawing holds', () => {
    const art = textArtOf(TRIANGLE + shape('138', ''));
    const data = textArtRenderData(art?.renderData);
    expect(data?.guides).toEqual([
      [0, 0.5, 0.5, 0, 1, 0.5],
      [0, 1, 0.5, 1, 1, 1],
    ]);
  });

  test('an arch without a template reads the standard one: one guide over the top', () => {
    const data = textArtRenderData(textArtOf(shape('144', ''))?.renderData);
    expect(data?.guides).toHaveLength(1);
    const guide = data!.guides[0]!;
    expect(guide[0]).toBeCloseTo(0);
    expect(guide[1]).toBeCloseTo(0.5);
    expect(Math.min(...guide.filter((_, i) => i % 2 === 1))).toBeCloseTo(0);
  });

  test('a plain text path with a solid fill keeps the engine fit', () => {
    expect(textArtOf(shape('136', ''))?.renderData).toBeUndefined();
  });

  test('a vertical gradient places its second colour at the focus', () => {
    const fill = (focus: string) =>
      textArtRenderData(
        textArtOf(
          shape(
            '136',
            `<v:fill type="gradient" color2="#f99" focus="${focus}"/>`,
            'fillcolor="#ffc"'
          )
        )?.renderData
      )?.fill;
    expect(fill('100%')).toEqual({
      kind: 'linear',
      angle: 0,
      stops: [
        { offset: 0, hex: 'FFFFCC', alpha: 1 },
        { offset: 1, hex: 'FF9999', alpha: 1 },
      ],
    });
    expect(fill('50%')).toMatchObject({
      stops: [{ hex: 'FFFFCC' }, { offset: 0.5, hex: 'FF9999' }, { offset: 1, hex: 'FFFFCC' }],
    });
  });

  test('the front face moves away from the viewpoint by a third of the depth', () => {
    const extrusion = (attrs: string) =>
      textArtRenderData(
        textArtOf(shape('136', `<o:extrusion v:ext="view" on="t" backdepth="18pt" ${attrs}/>`))
          ?.renderData
      )?.extrusion;
    // The default viewer stands up and to the right; the skew angle changes nothing.
    const standard = extrusion('skewangle="45"')!;
    expect(standard.frontDxPt).toBeCloseTo(-6);
    expect(standard.frontDyPt).toBeCloseTo(6);
    const left = extrusion('viewpoint="-34.72222mm" viewpointorigin="-.5"')!;
    expect(left.frontDxPt).toBeCloseTo(6);
    expect(left.frontDyPt).toBeCloseTo(6);
    expect(extrusion('type="perspective"')).toBeUndefined();
  });

  test('markup outside the painted subset is refused', () => {
    for (const children of [
      '<v:fill type="gradient" color2="red" angle="90"/>',
      '<v:shadow on="t" type="double"/>',
      '<o:extrusion v:ext="view" on="t" render="wireframe"/>',
    ])
      expect(textArtOf(shape('138', children))).toBeUndefined();
  });
});

describe('text art layout along a path', () => {
  const bounds = (points: readonly { x: number; y: number }[]) => ({
    top: Math.min(...points.map((p) => p.y)),
    bottom: Math.max(...points.map((p) => p.y)),
  });

  test('text between a triangle’s guides rises to the apex and keeps the base', () => {
    const art = textArtOf(TRIANGLE + shape('138', ''))!;
    const record = layoutTextArt(art, 300, 60, measurer);
    expect(record.components).toHaveLength(1);
    const points = record.components![0]!.subpathsEmu.flat().map((p) => ({
      x: p.x / 12700,
      y: p.y / 12700,
    }));
    const middle = points.filter((p) => Math.abs(p.x - 150) < 20);
    const side = points.filter((p) => p.x < 20);
    expect(bounds(middle).top).toBeLessThan(5);
    expect(bounds(side).top).toBeGreaterThan(25);
    expect(bounds(points).bottom).toBeCloseTo(60, 0);
  });

  test('extruded text paints its walls first and its lit front last, with no outline', () => {
    const art = textArtOf(
      shape(
        '136',
        '<o:extrusion v:ext="view" on="t" color="#06c" backdepth="18pt" viewpoint="-34.72222mm"/>',
        'fillcolor="#ffffff"'
      )
    )!;
    const record = layoutTextArt(art, 300, 60, measurer);
    const components = record.components!;
    expect(components.length).toBeGreaterThan(2);
    const front = components.at(-1)!;
    expect(front.strokeHex).toBeNull();
    expect(front.fillHex).not.toBe('FFFFFF');
    expect(components.slice(1, -1).every((wall) => wall.fillRule === 'nonzero')).toBe(true);
    // The front face moved right and down past the box; the back face keeps the box.
    expect(record.inkBounds!.right).toBeGreaterThan(300);
    expect(record.inkBounds!.bottom).toBeGreaterThan(60);
  });

  test('text along an arch keeps its size and centres its em box on the arc', () => {
    const art = textArtOf(shape('144', ''))!;
    const record = layoutTextArt(art, 400, 80, measurer);
    const points = record.components![0]!.subpathsEmu.flat().map((p) => ({
      x: p.x / 12700,
      y: p.y / 12700,
    }));
    const xs = points.map((p) => p.x);
    // Centred on the arc's middle, narrower than the box at the default 36pt.
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(200, 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(200);
    // The ink rises above the box, where the arc's top runs through the em box.
    expect(bounds(points).top).toBeLessThan(0);
    expect(record.inkBounds!.top).toBeLessThan(0);
  });
});
