/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The text art layout `installDrawing` installs: text art that carries this module's render
// data, as vector components the engine paints in every output.
//
// The glyph outlines are warped onto the text path (`text-art-warp.ts`), then painted back to
// front: the shadow, the extruded sides, and the front face with its fill and outline.

import type {
  TextArtLayout,
  TextArtLayoutInput,
  VectorGradient,
  VectorShapeComponent,
} from '@docx-editor.dev/core/store';
import { textArtExtrusionComponents, frontShade, shadeHex } from './text-art-extrusion.ts';
import { textArtRenderData, type TextArtRenderData } from './text-art-render-data.ts';
import {
  densify,
  guide,
  outlinePolygons,
  warpAlong,
  warpBetween,
  type InkBox,
  type Point,
} from './text-art-warp.ts';

const EMU = 12_700;
/** The size the outlines are read at; the warp scales them to the path. */
const OUTLINE_SIZE_PT = 100;
/** The VML text inset, kept unless the text path trims it: 0.1in across, 0.05in down. */
const INSET_X_PT = 7.2;
const INSET_Y_PT = 3.6;
/** Edge pieces per ink width, so straight edges bend with the path. */
const PIECES_PER_WIDTH = 400;
/** Along a single guide the text draws at this share of its font size, as measured. */
const ALONG_PATH_SCALE = 0.6;
/** The middle of the em box above the baseline, in ems: half of ascent less descent. */
const EM_CENTRE = 0.35;

const toEmu = (polygons: readonly Point[][]) =>
  polygons.map((polygon) => polygon.map((p) => ({ x: p.x * EMU, y: p.y * EMU })));

/** The guides in box points, the box shrunk by the text inset unless trimmed. */
function boxGuides(data: TextArtRenderData, width: number, height: number, trim: boolean) {
  const insetX = !trim && width > 4 * INSET_X_PT ? INSET_X_PT : 0;
  const insetY = !trim && height > 4 * INSET_Y_PT ? INSET_Y_PT : 0;
  return data.guides.map((flat) => {
    const points: Point[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2)
      points.push({
        x: insetX + flat[i]! * (width - 2 * insetX),
        y: insetY + flat[i + 1]! * (height - 2 * insetY),
      });
    return guide(points);
  });
}

/** The front face's fill as a component's fill fields, lit by `shade`. */
function fillFields(
  data: TextArtRenderData,
  height: number,
  shade: number,
  dy: number
): Pick<VectorShapeComponent, 'fillHex' | 'fillAlpha' | 'fillGradient'> {
  const fill = data.fill;
  if (!fill) return { fillHex: null, fillAlpha: 1 };
  if (fill.kind === 'solid') return { fillHex: shadeHex(fill.hex, shade), fillAlpha: fill.alpha };
  const stops = fill.stops.map((stop) => ({ ...stop, hex: shadeHex(stop.hex, shade) }));
  const gradient: VectorGradient = {
    kind: 'linear',
    stops,
    coords: [0, dy * EMU, 0, (height + dy) * EMU],
    matrix: [1, 0, 0, 1, 0, 0],
  };
  return { fillHex: stops[0]!.hex, fillAlpha: 1, fillGradient: gradient };
}

/** Box-local bounds of polygons in points. */
function bounds(polygons: readonly Point[][]): InkBox {
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polygon of polygons)
    for (const p of polygon) {
      left = Math.min(left, p.x);
      right = Math.max(right, p.x);
      top = Math.min(top, p.y);
      bottom = Math.max(bottom, p.y);
    }
  return { left, top, right, bottom };
}

/** The text art layout `installDrawing` installs. */
export function textArtLayout(input: TextArtLayoutInput): TextArtLayout | null {
  const data = textArtRenderData(input.textArt.renderData);
  if (!data) return null;
  const { widthPt: width, heightPt: height } = input;
  if (!(width > 0 && height > 0)) return null;
  const outline = input.outline(input.textArt.text, OUTLINE_SIZE_PT);
  const raw = outline && outlinePolygons(outline.path);
  if (!outline || !raw?.length) return null;
  const ink = outline.ink;
  const polygons = densify(raw, (ink.right - ink.left) / PIECES_PER_WIDTH);
  if (!polygons) return null;
  const guides = boxGuides(data, width, height, input.textArt.trim === true);
  if (!guides.every((g) => g !== null)) return null;
  let front: Point[][];
  if (guides.length === 2) {
    front = warpBetween(polygons, ink, guides[0]!, guides[1]!);
  } else {
    // Along a single guide the text keeps its size, scaled as measured, whatever `fitpath`
    // says; the middle of its em box runs on the guide.
    const scale = (data.fontSizePt * ALONG_PATH_SCALE) / OUTLINE_SIZE_PT;
    front = warpAlong(polygons, ink, guides[0]!, scale, -EM_CENTRE * OUTLINE_SIZE_PT);
  }
  const extrusion = data.extrusion;
  const shift = extrusion ? { x: extrusion.frontDxPt, y: extrusion.frontDyPt } : { x: 0, y: 0 };
  if (shift.x || shift.y)
    front = front.map((polygon) => polygon.map((p) => ({ x: p.x + shift.x, y: p.y + shift.y })));

  const components: VectorShapeComponent[] = [];
  if (extrusion) {
    const sideHex = extrusion.hex ?? (data.fill?.kind === 'solid' ? data.fill.hex : null);
    components.push(...textArtExtrusionComponents(front, extrusion, sideHex ?? '808080'));
  }
  const shade = extrusion ? frontShade(extrusion) : 1;
  // An extruded shape paints no outline.
  const stroke = extrusion ? null : data.stroke;
  const frontEmu = toEmu(front);
  components.push({
    subpathsEmu: frontEmu,
    ...fillFields(data, height, shade, shift.y),
    strokeHex: stroke?.hex ?? null,
    strokeAlpha: stroke?.alpha ?? 1,
    strokeWidthEmu: (stroke?.widthPt ?? 0) * EMU,
    strokeJoin: 'round',
    ...(data.shadow
      ? {
          shadow: {
            dxEmu: data.shadow.dxPt * EMU,
            dyEmu: data.shadow.dyPt * EMU,
            blurEmu: 0,
            hex: data.shadow.hex,
            alpha: data.shadow.alpha,
          },
        }
      : {}),
  });
  if (!data.fill && !stroke && !extrusion) return null;

  const reach = stroke ? stroke.widthPt / 2 : 0;
  let box = bounds(front);
  if (extrusion) {
    box = {
      left: Math.min(box.left, box.left - shift.x),
      right: Math.max(box.right, box.right - shift.x),
      top: Math.min(box.top, box.top - shift.y),
      bottom: Math.max(box.bottom, box.bottom - shift.y),
    };
  }
  if (data.shadow) {
    box = {
      left: Math.min(box.left, box.left + data.shadow.dxPt),
      right: Math.max(box.right, box.right + data.shadow.dxPt),
      top: Math.min(box.top, box.top + data.shadow.dyPt),
      bottom: Math.max(box.bottom, box.bottom + data.shadow.dyPt),
    };
  }
  const inkBounds = {
    left: box.left - reach,
    top: box.top - reach,
    right: box.right + reach,
    bottom: box.bottom + reach,
  };
  const outside =
    inkBounds.left < 0 || inkBounds.top < 0 || inkBounds.right > width || inkBounds.bottom > height;
  return { components, ...(outside ? { inkBounds } : {}) };
}
