// DrawingML colour and fill reads for shapes: `a:srgbClr`/`a:schemeClr` with their transforms,
// resolved at the store trust boundary into validated 6-digit sRGB hex and an alpha.

import { presetColorHex } from './drawing-preset-colors.ts';
import { findDirectChild } from './drawing-shape-readers.ts';
import { isElement } from './drawing-projection-walk.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from './ooxml-tree.ts';

/** @internal */
export type ShapeSchemeColorResolver = (scheme: string) => string | null;

const SHAPE_HEX_RE = /^[0-9A-Fa-f]{6}$/;

/** A resolved shape colour. @public */
export interface ShapeColor {
  /** Validated six-character sRGB hex, without `#`. */
  readonly hex: string;
  /** Opacity, 0..1. */
  readonly alpha: number;
}

function colorChannels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function channelsHex(channels: readonly number[]): string {
  return channels
    .map((channel) =>
      Math.round(Math.max(0, Math.min(255, channel)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
    .toUpperCase();
}

/**
 * DrawingML blends `a:tint` and `a:shade` in linear light, not on the stored sRGB channel.
 * The conversion uses a plain 2.3 colour-space gamma, not the sRGB piecewise curve, and the
 * linear result truncates back to a byte rather than rounding.
 *
 * Where those two constants come from, precisely, because they look arbitrary:
 *
 * - Measured against LibreOffice, rendering purpose-built `.docx` files to PDF and sampling
 *   the pixel. Word was not available on the machine that wrote this, so it is NOT the
 *   oracle here. Treat this as one renderer's behaviour reproduced exactly (47 of 47
 *   base/ratio pairs), not as Word's behaviour confirmed. Note also that 2.3 is LibreOffice's
 *   own colour-space gamma, so agreement with it is partly circular.
 * - The one check that does not come from a renderer: ECMA-376 Part 1 20.1.2.3.31's worked
 *   `a:shade` example, `00FF00` at `val="50%"`, gives `00BC00`. This model reproduces it
 *   exactly. Read what that does and does not settle — a blend on the stored channel gives
 *   `008000`, so the example rules that reading out decisively, but the sRGB curve gives
 *   `00BB00`, one level away, so it barely speaks to the choice of curve.
 *
 * On the spelling in that citation: Part 1 (Strict) writes percentages as `50%`, and its
 * `ST_PositiveFixedPercentage` does not admit `50000` at all. The 1000ths-of-a-percent
 * integer Word writes is Part 4 (Transitional). `transformRatio` takes both.
 *
 * Both constants are load-bearing, though neither is dramatic on any single colour. Against
 * `Math.round` the result moves a level on about half of a uniform base/ratio grid. Against
 * the sRGB piecewise curve, holding this floor fixed, it moves on about half as well, by
 * four levels on `336699` + `shade 40000` (`224466` here, `1E4163` through sRGB) and by as
 * much as eleven at the dark end.
 *
 * `lumMod`/`lumOff` are NOT linear-light: they stay in HSL over the stored channels and keep
 * `channelsHex`'s rounding. That path is confirmed against Word itself, so do not fold it in.
 */
const SHAPE_COLOR_GAMMA = 2.3;

function linearFromChannel(channel: number): number {
  return (Math.max(0, Math.min(255, channel)) / 255) ** SHAPE_COLOR_GAMMA;
}

function channelFromLinear(linear: number): number {
  const channel = Math.max(0, Math.min(1, linear)) ** (1 / SHAPE_COLOR_GAMMA) * 255;
  // The epsilon only absorbs the round-trip error of the two `**` calls, so a ratio of
  // 100000 (the identity transform) returns the input channel instead of the one below it.
  return Math.max(0, Math.min(255, Math.floor(channel + 1e-6)));
}

function rgbToHsl([red, green, blue]: readonly number[]): [number, number, number] {
  const r = red! / 255;
  const g = green! / 255;
  const b = blue! / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue =
    max === r
      ? (g - b) / delta + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return [hue / 6, saturation, lightness];
}

function hslToRgb([hue, saturation, lightness]: readonly number[]): [number, number, number] {
  if (saturation === 0) return [lightness! * 255, lightness! * 255, lightness! * 255];
  const q =
    lightness! < 0.5
      ? lightness! * (1 + saturation!)
      : lightness! + saturation! - lightness! * saturation!;
  const p = 2 * lightness! - q;
  const channel = (offset: number): number => {
    let value = hue! + offset;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return [channel(1 / 3) * 255, channel(0) * 255, channel(-1 / 3) * 255];
}

/**
 * `val` on a colour transform, as a 0..1 ratio, or null to refuse the colour.
 *
 * Two spellings are legal and both appear in the wild:
 *
 * - The 1000ths-of-a-percent integer (`50000`). This is `ST_Percentage`'s Transitional
 *   spelling (ECMA-376 Part 4), and it is what Word writes, so it is the common case.
 * - The percentage literal (`50%`, `12.5%`). This is the Strict spelling
 *   (`ST_PositiveFixedPercentage`, Part 1 20.1.10.45, whose pattern is 22.9.2.10) and the
 *   one the spec's own worked examples use. Refusing it dropped the shape to a placeholder.
 *
 * Both regexes are anchored, bounded and have no nested quantifier, so a hostile `val`
 * cannot make either backtrack. Anything else — a sign, an exponent, whitespace, 7 digits —
 * refuses, and the caller fails the whole colour closed rather than guessing.
 *
 * The percentage PATTERN is wider than the value space it belongs to: 22.9.2.10 admits
 * `100.99%`, which is 1.0099 as a ratio. The explicit ceiling below is what keeps the
 * result in 0..1, not the regex, and it refuses the overshoot the same way the integer
 * branch refuses `100001`.
 */
function transformRatio(node: OoxmlElement): number | null {
  const value = schemaAttributeValue(node.attributes, 'val');
  if (value === undefined) return null;
  if (/^\d{1,6}$/.test(value)) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100_000 ? parsed / 100_000 : null;
  }
  if (/^(?:100|\d{1,2})(?:\.\d{1,2})?%$/.test(value)) {
    const percent = Number(value.slice(0, -1));
    return percent >= 0 && percent <= 100 ? percent / 100 : null;
  }
  return null;
}

/**
 * A signed transform `val` (`ST_Percentage` offsets and modulations, `ST_Angle` hue offsets)
 * as its raw integer, or null to refuse the colour. The Strict percentage spelling (`-12.5%`)
 * converts to the same 1000ths-of-a-percent integer. `limit` bounds the magnitude, so a
 * hostile value cannot push a channel arbitrarily far before the clamp.
 */
function signedTransformValue(value: string | undefined, limit: number): number | null {
  if (value === undefined) return null;
  let parsed: number;
  if (/^[+-]?\d{1,9}$/.test(value)) parsed = Number(value);
  else if (/^[+-]?\d{1,7}(?:\.\d{1,3})?%$/.test(value)) {
    parsed = Math.round(Number(value.slice(0, -1)) * 1000);
  } else return null;
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit ? parsed : null;
}

const PERCENT_LIMIT = 10_000_000;
const ANGLE_LIMIT = 21_600_000;

/** A colour with no theme lookup: `a:sysClr` keeps its last colour, or its system default. */
const SYSTEM_COLOR_DEFAULTS: ReadonlyMap<string, string> = new Map([
  ['windowText', '000000'],
  ['window', 'FFFFFF'],
  ['btnText', '000000'],
  ['btnFace', 'F0F0F0'],
  ['highlight', '0078D7'],
  ['highlightText', 'FFFFFF'],
  ['grayText', '6D6D6D'],
]);

/** sRGB transfer of one linear channel, for `a:scrgbClr` (ECMA-376 20.1.2.3.30). */
function srgbChannelFromLinear(linear: number): number {
  const value = Math.max(0, Math.min(1, linear));
  const encoded = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

function baseColorHex(
  color: OoxmlElement,
  resolveSchemeColor: ShapeSchemeColorResolver | undefined,
  placeholder: ShapeColor | undefined
): { readonly hex: string | null | undefined; readonly alpha: number } {
  const token = schemaAttributeValue(color.attributes, 'val');
  switch (color.localName) {
    case 'srgbClr':
      return { hex: token, alpha: 1 };
    case 'schemeClr':
      if (token === 'phClr' && placeholder) return placeholder;
      return { hex: token !== undefined ? resolveSchemeColor?.(token) : null, alpha: 1 };
    case 'sysClr': {
      const last = schemaAttributeValue(color.attributes, 'lastClr');
      if (last !== undefined && SHAPE_HEX_RE.test(last)) return { hex: last, alpha: 1 };
      return { hex: token !== undefined ? SYSTEM_COLOR_DEFAULTS.get(token) : null, alpha: 1 };
    }
    case 'prstClr':
      return { hex: presetColorHex(token), alpha: 1 };
    case 'scrgbClr': {
      const channels: number[] = [];
      for (const name of ['r', 'g', 'b']) {
        const percent = signedTransformValue(
          schemaAttributeValue(color.attributes, name),
          PERCENT_LIMIT
        );
        if (percent === null) return { hex: null, alpha: 1 };
        channels.push(srgbChannelFromLinear(percent / 100_000));
      }
      return { hex: channelsHex(channels), alpha: 1 };
    }
    default:
      return { hex: null, alpha: 1 };
  }
}

const BASE_COLOR_NAMES = new Set(['srgbClr', 'schemeClr', 'sysClr', 'scrgbClr', 'prstClr']);

/**
 * Transforms with signed values, applied in HSL (channel 0..2) or to alpha (channel 3).
 * `lumMod`/`lumOff` stay in HSL over the stored channels (confirmed against Word); a modulation
 * may exceed 100%, as theme and diagram colours write it (`lumMod val="102000"`).
 */
const SIGNED_HSL_TRANSFORMS: ReadonlyMap<
  string,
  { readonly channel: 0 | 1 | 2 | 3; readonly mode: 'off' | 'mod'; readonly limit: number }
> = new Map([
  ['hueOff', { channel: 0, mode: 'off', limit: ANGLE_LIMIT }],
  ['hueMod', { channel: 0, mode: 'mod', limit: PERCENT_LIMIT }],
  ['satOff', { channel: 1, mode: 'off', limit: PERCENT_LIMIT }],
  ['satMod', { channel: 1, mode: 'mod', limit: PERCENT_LIMIT }],
  ['lumMod', { channel: 2, mode: 'mod', limit: PERCENT_LIMIT }],
  ['lumOff', { channel: 2, mode: 'off', limit: PERCENT_LIMIT }],
  ['alphaOff', { channel: 3, mode: 'off', limit: PERCENT_LIMIT }],
  ['alphaMod', { channel: 3, mode: 'mod', limit: PERCENT_LIMIT }],
]);

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** @internal */
export function resolveColorNode(
  color: OoxmlNode,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  placeholder?: ShapeColor
): ShapeColor | null {
  if (
    !isElement(color) ||
    !('namespaceUri' in color) ||
    color.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI ||
    !BASE_COLOR_NAMES.has(color.localName)
  ) {
    return null;
  }
  const base = baseColorHex(color, resolveSchemeColor, placeholder);
  let alpha = base.alpha;
  let hex = base.hex;
  if (!hex || !SHAPE_HEX_RE.test(hex)) return null;
  let channels = colorChannels(hex);
  for (const child of color.children) {
    if (!isElement(child) || child.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) continue;
    const signed = SIGNED_HSL_TRANSFORMS.get(child.localName);
    if (signed) {
      const value = signedTransformValue(
        schemaAttributeValue(child.attributes, 'val'),
        signed.limit
      );
      if (value === null) return null;
      // An identity transform leaves the colour exactly as it is: no HSL round trip.
      if (signed.mode === 'off' ? value === 0 : value === 100_000) continue;
      if (signed.channel === 3) {
        alpha = clampUnit(
          signed.mode === 'mod' ? (alpha * value) / 100_000 : alpha + value / 100_000
        );
        continue;
      }
      const hsl = rgbToHsl(channels);
      const current = hsl[signed.channel]!;
      if (signed.channel === 0) {
        // Hue wraps: offsets are 60000ths of a degree, modulation scales the turn.
        const turned =
          signed.mode === 'mod' ? (current * value) / 100_000 : current + value / 21_600_000;
        hsl[0] = ((turned % 1) + 1) % 1;
      } else {
        hsl[signed.channel] = clampUnit(
          signed.mode === 'mod' ? (current * value) / 100_000 : current + value / 100_000
        );
      }
      channels = hslToRgb(hsl);
      continue;
    }
    const ratio = transformRatio(child);
    if (ratio === null) return null;
    if (child.localName === 'alpha') alpha = ratio;
    else if (child.localName === 'tint') {
      // ECMA-376 20.1.2.3.34: `val` is the fraction of the INPUT colour, the rest white.
      channels = channels.map((channel) =>
        channelFromLinear(linearFromChannel(channel) * ratio + (1 - ratio))
      ) as [number, number, number];
    } else if (child.localName === 'shade') {
      // ECMA-376 20.1.2.3.31: `val` is the fraction of the input colour, the rest black.
      channels = channels.map((channel) =>
        channelFromLinear(linearFromChannel(channel) * ratio)
      ) as [number, number, number];
    } else {
      return null;
    }
  }
  hex = channelsHex(channels);
  return { hex, alpha };
}

/** Resolve and transform one DrawingML solid fill at the store trust boundary. */
export function readSolidFill(
  parent: OoxmlElement,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  placeholder?: ShapeColor
): ShapeColor | null {
  const solidFill = findDirectChild(parent.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName: 'solidFill',
  });
  if (!solidFill) return null;
  const color = solidFill.children.find(isElement);
  return color ? resolveColorNode(color, resolveSchemeColor, placeholder) : null;
}

const FILL_ELEMENT_NAMES = new Set([
  'noFill',
  'solidFill',
  'gradFill',
  'blipFill',
  'pattFill',
  'grpFill',
]);

/** @internal */
export function directFill(
  parent: OoxmlElement,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  placeholder?: ShapeColor
): { readonly present: boolean; readonly color: ShapeColor | null } {
  const authored = parent.children.find(
    (child) =>
      isElement(child) &&
      child.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
      FILL_ELEMENT_NAMES.has(child.localName)
  );
  if (!authored || !isElement(authored)) return { present: false, color: null };
  return {
    present: true,
    color:
      authored.localName === 'solidFill'
        ? readSolidFill(parent, resolveSchemeColor, placeholder)
        : null,
  };
}
