/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The text art model as the projection the engine lays out and paints.
//
// This is the text art renderer `installDrawing` installs, for every text path that is not a
// watermark. Plain text fitted to its box, with one solid fill and an optional outline, is the
// engine's own fit. Anything more carries render data for the text art layout
// (`text-art-layout.ts`): a text path that is not the plain rectangle (an arch, a triangle,
// a wave), a gradient fill, a shown shadow, or a 3-D extrusion. Multi-line text, rotated
// letters, unmeasured gradient angles and unknown markup stay outside it, and the engine
// keeps refusing them.

import {
  legacyRotationDegrees,
  vmlColor,
  vmlOff as off,
  vmlPoints,
  VML_OFFICE_NAMESPACE_URI as OFFICE,
  VML_WORD_NAMESPACE_URI as WORD_VML,
  type LegacyTextArtContext,
  type LegacyTextArtProjection,
  type OoxmlElement,
} from '@docx-editor.dev/core/store';
import {
  readLegacyTextArtModel,
  type LegacyTextArtModel,
  type TextArtOtherChild,
  type TextPathModel,
} from './text-art-model.ts';
import { textArtExtrusion, textArtFill, textArtShadow, vmlOpacity } from './text-art-effects.ts';
import { textArtGuides } from './text-art-geometry.ts';
import type { TextArtRenderData, TextArtStrokeData } from './text-art-render-data.ts';

/** The longest text the projection fits; WordArt is a short phrase. */
const MAX_TEXT_ART_LENGTH = 256;

const TEXTPATH_STYLES = new Set([
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'v-text-align',
  'v-rotate-letters',
  'v-same-letter-heights',
  'v-text-kern',
]);

/** A CSS-style font family with its quotes removed; null when it cannot name a face. */
function family(raw: string | undefined): string | null {
  const value = (raw ?? '')
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim();
  if (!value || value.length > 64 || /["';{}<>\\]/.test(value)) return null;
  return value;
}

const unit = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
const hex = (value: string) => value.slice(1).toUpperCase();

/** A child the projection paints past: a lock, a wrap, an empty anchor lock. */
function inert(child: TextArtOtherChild): boolean {
  const is = (ns: string, name: string) => child.namespaceUri === ns && child.localName === name;
  return (
    is(OFFICE, 'lock') ||
    is(WORD_VML, 'wrap') ||
    (is(WORD_VML, 'anchorlock') && child.attributeCount === 0)
  );
}

/**
 * The shape's `v:textpath` with the template's attributes under it: a shape element inherits
 * what it leaves unsaid from the same element of its template.
 */
function effectiveTextPath(model: LegacyTextArtModel): TextPathModel | null {
  if (model.textPaths.length !== 1) return null;
  const own = model.textPaths[0]!;
  const inherited = model.template?.textPaths[0];
  if (!inherited || inherited.otherAttributes.length) return own;
  const style = new Map(inherited.style ?? []);
  for (const [key, value] of own.style ?? []) style.set(key, value);
  return { ...inherited, ...own, style: own.style === null ? null : style };
}

/** The outline: null when not stroked, `undefined` outside the subset. */
function stroke(model: LegacyTextArtModel): TextArtStrokeData | null | undefined {
  const node = model.strokes[0];
  if (node?.otherAttributes.length) return undefined;
  // VML strokes a shape unless told otherwise, black at three quarters of a point.
  if (off(model.shape.stroked) || (node && off(node.on))) return null;
  const color = vmlColor(node?.color ?? model.shape.strokecolor, '#000000');
  const widthPt = vmlPoints(node?.weight ?? model.shape.strokeweight ?? '0.75pt');
  const alpha = vmlOpacity(node?.opacity);
  if (!color || !(widthPt > 0 && widthPt <= 100) || !unit(alpha)) return undefined;
  return { hex: hex(color), alpha, widthPt };
}

/** Whether the guides are the box's own top and bottom edges: plain text, fitted. */
function plainGuides(guides: readonly (readonly { x: number; y: number }[])[]): boolean {
  const edge = (points: readonly { x: number; y: number }[], y: number) =>
    points.length === 2 &&
    points.every((p) => Math.abs(p.y - y) < 1e-9) &&
    Math.abs(Math.min(points[0]!.x, points[1]!.x)) < 1e-9 &&
    Math.abs(Math.max(points[0]!.x, points[1]!.x) - 1) < 1e-9;
  return guides.length === 2 && edge(guides[0]!, 0) && edge(guides[1]!, 1);
}

/** The projection of a text art model, or null outside the painted subset. */
export function projectLegacyTextArt(model: LegacyTextArtModel): LegacyTextArtProjection | null {
  if (!model.others.every(inert) || model.nestedChildren) return null;
  if (
    model.fills.length > 1 ||
    model.strokes.length > 1 ||
    model.paths.length > 1 ||
    model.shadows.length > 1 ||
    model.extrusions.length > 1
  )
    return null;
  if (model.paths[0]?.otherAttributes.length) return null;
  const path = effectiveTextPath(model);
  if (
    !path ||
    path.otherAttributes.length ||
    off(path.on) ||
    (path.xscale !== undefined && !off(path.xscale))
  )
    return null;
  const text = model.textPaths[0]!.string ?? '';
  if (!text.trim() || text.length > MAX_TEXT_ART_LENGTH || /[\r\n\v\f\u2028\u2029]/.test(text))
    return null;
  const style = path.style;
  if (!style) return null;
  for (const [key, value] of style) {
    if (!TEXTPATH_STYLES.has(key)) return null;
    if (key === 'v-text-align' && value !== 'center') return null;
    // Kerning only tightens letter pairs; the fit to the box still holds.
    if (key.startsWith('v-') && !['v-text-align', 'v-text-kern'].includes(key) && !off(value))
      return null;
  }
  const face = family(style.get('font-family'));
  const size = style.has('font-size') ? vmlPoints(style.get('font-size')) : 36;
  const weight = style.get('font-weight') ?? 'normal';
  const slant = style.get('font-style') ?? 'normal';
  if (
    !face ||
    !(size > 0 && size <= 1000) ||
    !['normal', 'bold', '400', '700'].includes(weight) ||
    !['normal', 'italic'].includes(slant)
  )
    return null;

  const fill = textArtFill(model);
  const outline = stroke(model);
  const shadow = textArtShadow(model.shadows[0]);
  const extrusion = textArtExtrusion(model.extrusions[0]);
  const guides = textArtGuides(model);
  if (fill === undefined || outline === undefined || shadow === undefined) return null;
  if (extrusion === undefined || !guides) return null;
  // A single guide carries the text along it; two hold it between them.
  if (guides.length > 2) return null;
  const plain = plainGuides(guides) && fill?.kind !== 'linear' && !shadow && !extrusion;
  // The plain fit stretches the text to the box, so only a path that fits the shape has one.
  if (plain && off(path.fitshape)) return null;

  const rotation = legacyRotationDegrees(model.shape.style?.get('rotation'));
  if (!Number.isFinite(rotation)) return null;
  const solid = fill?.kind === 'solid' ? fill : null;
  const firstStop = fill?.kind === 'linear' ? fill.stops[0]! : null;
  const renderData: TextArtRenderData | null = plain
    ? null
    : {
        guides: guides.map((points) => points.flatMap((p) => [p.x, p.y])),
        fontSizePt: size,
        fill,
        stroke: outline,
        shadow,
        extrusion,
      };
  return Object.freeze({
    text,
    fontFamily: face,
    bold: weight === 'bold' || weight === '700',
    italic: slant === 'italic',
    fillHex: solid?.hex ?? firstStop?.hex ?? null,
    fillAlpha: solid?.alpha ?? firstStop?.alpha ?? 1,
    strokeHex: outline?.hex ?? null,
    strokeAlpha: outline?.alpha ?? 1,
    strokeWidthPt: outline?.widthPt ?? 0,
    rotationDegrees: rotation,
    ...(path.trim !== undefined && !off(path.trim) ? { trim: true as const } : {}),
    ...(renderData ? { renderData } : {}),
  });
}

/** The text art renderer `installDrawing` installs. */
export function legacyTextArtRenderer(
  shape: OoxmlElement,
  context?: LegacyTextArtContext
): LegacyTextArtProjection | null {
  const model = readLegacyTextArtModel(shape, context?.template);
  return model ? projectLegacyTextArt(model) : null;
}
