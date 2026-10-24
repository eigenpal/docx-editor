/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The text art model as the projection the engine lays out and paints: plain text fitted to
// the shape box, one fill, an optional outline, and a turn about the box centre.
//
// This is the text art renderer `installDrawing` installs, for every text path that is not a
// watermark. It accepts a bounded subset: one `v:textpath` with `fitshape`, a solid fill with
// an optional opacity, an optional plain outline, and a shadow that is switched off. Custom
// paths, adjustment handles, gradients, shown shadows and multi-line text stay outside it, and
// the engine keeps refusing them.

import {
  legacyRotationDegrees,
  vmlColor,
  vmlNumber,
  vmlOff as off,
  vmlPoints,
  VML_NAMESPACE_URI as VML,
  VML_OFFICE_NAMESPACE_URI as OFFICE,
  VML_WORD_NAMESPACE_URI as WORD_VML,
  type LegacyTextArtProjection,
  type OoxmlElement,
} from '@docx-editor.dev/core/store';
import {
  readLegacyTextArtModel,
  type LegacyTextArtModel,
  type TextArtOtherChild,
} from './text-art-model.ts';

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

/** VML opacity: a fraction, a `f` fixed-point fraction, or a percentage. NaN when malformed. */
function opacity(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const value = raw.trim();
  if (/^\d{1,6}f$/.test(value)) return Number(value.slice(0, -1)) / 65536;
  if (/^\d{1,3}(\.\d{1,6})?%$/.test(value)) return Number(value.slice(0, -1)) / 100;
  return vmlNumber(value);
}

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

/** A child the subset paints past: a switched-off shadow, a lock, a wrap, an empty anchor lock. */
function inert(child: TextArtOtherChild): boolean {
  const is = (ns: string, name: string) => child.namespaceUri === ns && child.localName === name;
  return (
    // A shadow is off unless it says `on`; a switched-off one paints nothing.
    (is(VML, 'shadow') && (child.on === undefined || off(child.on))) ||
    is(OFFICE, 'lock') ||
    is(WORD_VML, 'wrap') ||
    (is(WORD_VML, 'anchorlock') && child.attributeCount === 0)
  );
}

/** The projection of a text art model, or null outside the painted subset. */
export function projectLegacyTextArt(model: LegacyTextArtModel): LegacyTextArtProjection | null {
  const { shape } = model;
  if (shape.path || (shape.adj !== undefined && shape.adj !== '10800')) return null;
  if (!model.others.every(inert) || model.nestedChildren) return null;
  if (
    model.textPaths.length !== 1 ||
    model.fills.length > 1 ||
    model.strokes.length > 1 ||
    model.paths.length > 1
  )
    return null;
  if (model.paths[0]?.otherAttributes.length) return null;
  const path = model.textPaths[0]!;
  if (
    path.otherAttributes.length ||
    off(path.on) ||
    off(path.fitshape) ||
    (path.xscale !== undefined && !off(path.xscale))
  )
    return null;
  const text = path.string ?? '';
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

  const fillNode = model.fills[0];
  if (fillNode && (fillNode.otherAttributes.length || (fillNode.type ?? 'solid') !== 'solid'))
    return null;
  const filled = !(off(shape.filled) || (fillNode && off(fillNode.on)));
  const fill = filled ? vmlColor(fillNode?.color ?? shape.fillcolor, '#ffffff') : null;
  const fillAlpha = opacity(fillNode?.opacity);
  if ((filled && !fill) || !unit(fillAlpha)) return null;

  const strokeNode = model.strokes[0];
  if (strokeNode?.otherAttributes.length) return null;
  // VML strokes a shape unless told otherwise, black at three quarters of a point.
  const stroked = !(off(shape.stroked) || (strokeNode && off(strokeNode.on)));
  const stroke = stroked ? vmlColor(strokeNode?.color ?? shape.strokecolor, '#000000') : null;
  const strokeWidth = vmlPoints(strokeNode?.weight ?? shape.strokeweight ?? '0.75pt');
  const strokeAlpha = opacity(strokeNode?.opacity);
  if (stroked && (!stroke || !(strokeWidth > 0 && strokeWidth <= 100) || !unit(strokeAlpha)))
    return null;

  const rotation = legacyRotationDegrees(shape.style?.get('rotation'));
  if (!Number.isFinite(rotation)) return null;
  return Object.freeze({
    text,
    fontFamily: face,
    bold: weight === 'bold' || weight === '700',
    italic: slant === 'italic',
    fillHex: fill ? hex(fill) : null,
    fillAlpha: filled ? fillAlpha : 1,
    strokeHex: stroke ? hex(stroke) : null,
    strokeAlpha: stroked ? strokeAlpha : 1,
    strokeWidthPt: stroked ? strokeWidth : 0,
    rotationDegrees: rotation,
    ...(path.trim !== undefined && !off(path.trim) ? { trim: true as const } : {}),
  });
}

/** The text art renderer `installDrawing` installs. */
export function legacyTextArtRenderer(shape: OoxmlElement): LegacyTextArtProjection | null {
  const model = readLegacyTextArtModel(shape);
  return model ? projectLegacyTextArt(model) : null;
}
