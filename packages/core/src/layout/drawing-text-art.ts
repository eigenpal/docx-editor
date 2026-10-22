// Floating VML text art (a text watermark) laid out for paint.
//
// The text path stretches the string's glyph ink to fill the shape box inside the VML default
// text inset: 0.1in left and right, 0.05in top and bottom. Layout fits the outlines once, so
// the screen and every exporter paint the same ink. The box is the unrotated shape; paint
// turns it about its centre.
import { DEFAULT_RUN_STYLE, type ResolvedRunStyle } from './run-style.ts';
import type { LayoutBox, TextMeasurer, TextOutline } from './semantic-records.ts';
import type { LegacyTextArtProjection } from '../store/package/legacy-vml-text-art.ts';

/** Size the string is measured and, without outlines, drawn at; the fit scales it to the box. */
export const TEXT_ART_FONT_SIZE_PT = 100;
const INSET_X_PT = 7.2;
const INSET_Y_PT = 3.6;

/** `x' = scaleX * x + offsetX`, `y' = scaleY * y + offsetY`, from text space into the box. */
export interface TextArtFit {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface DrawingTextArtRecord {
  readonly text: string;
  readonly fontFamily: string;
  readonly bold: boolean;
  readonly italic: boolean;
  /** Size of the unfitted text that `fit` maps into the box. */
  readonly fontSizePt: number;
  /** `RRGGBB`, or null when the text is not filled. */
  readonly fillHex: string | null;
  readonly fillAlpha: number;
  /** `RRGGBB`, or null when the text is not outlined. */
  readonly strokeHex: string | null;
  readonly strokeAlpha: number;
  readonly strokeWidthPt: number;
  /** Clockwise rotation about the box centre. */
  readonly rotationDegrees: number;
  /**
   * The fitted glyph outlines in points from the box's top-left corner, as absolute M/L/Q/C/Z
   * path data. Null when the measurer knew only the ink box: paint then draws the text at
   * `fontSizePt` through `fit`.
   */
  readonly path: string | null;
  /** Null when the measurer could not bound the string's ink: nothing paints. */
  readonly fit: TextArtFit | null;
}

/** The style the text is measured in. */
export function textArtRunStyle(textArt: LegacyTextArtProjection): ResolvedRunStyle {
  return {
    ...DEFAULT_RUN_STYLE,
    fontFamily: textArt.fontFamily,
    bold: textArt.bold,
    italic: textArt.italic,
    fontSizePt: TEXT_ART_FONT_SIZE_PT,
  };
}

function fittedPath(path: string, fit: TextArtFit): string {
  let index = 0;
  return path.replace(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/giu, (value) => {
    const n = Number(value);
    const mapped = index++ % 2 === 0 ? fit.scaleX * n + fit.offsetX : fit.scaleY * n + fit.offsetY;
    const rounded = Math.round(mapped * 1000) / 1000;
    return String(Object.is(rounded, -0) ? 0 : rounded);
  });
}

/** Records by measurer, then projection, then box: a header watermark repeats on every page. */
const fitted = new WeakMap<
  object,
  WeakMap<LegacyTextArtProjection, Map<string, DrawingTextArtRecord>>
>();
const NO_MEASURER = {};
/** Box sizes kept per projection; a document resizes its watermark rarely. */
const MAX_BOXES = 8;

/**
 * Text art for a `width` by `height` box. When the measurer cannot bound the string's ink the
 * record has no fit and paints nothing: guessing glyph metrics would draw text the document does not.
 *
 * The same projection, box and measurer return the same record. A watermark sits in a header
 * that every page repeats, so shaping and fitting it once per page made layout of a long
 * document several times slower.
 */
export function layoutTextArt(
  textArt: LegacyTextArtProjection,
  width: number,
  height: number,
  measurer: TextMeasurer | undefined
): DrawingTextArtRecord {
  let byProjection = fitted.get(measurer ?? NO_MEASURER);
  if (!byProjection) fitted.set(measurer ?? NO_MEASURER, (byProjection = new WeakMap()));
  let byBox = byProjection.get(textArt);
  if (!byBox) byProjection.set(textArt, (byBox = new Map()));
  const key = `${width}x${height}`;
  const hit = byBox.get(key);
  if (hit) return hit;
  const record = fitTextArt(textArt, width, height, measurer);
  if (byBox.size >= MAX_BOXES) byBox.delete(byBox.keys().next().value!);
  byBox.set(key, record);
  return record;
}

/** The outline when its ink is a finite, non-empty box; null otherwise. */
function usableOutline(outline: TextOutline | undefined): TextOutline | null {
  const ink = outline?.ink;
  if (!outline || !ink) return null;
  if (![ink.left, ink.top, ink.right, ink.bottom].every(Number.isFinite)) return null;
  return ink.right > ink.left && ink.bottom > ink.top ? outline : null;
}

function fitTextArt(
  textArt: LegacyTextArtProjection,
  width: number,
  height: number,
  measurer: TextMeasurer | undefined
): DrawingTextArtRecord {
  const base = {
    text: textArt.text,
    fontFamily: textArt.fontFamily,
    bold: textArt.bold,
    italic: textArt.italic,
    fontSizePt: TEXT_ART_FONT_SIZE_PT,
    fillHex: textArt.fillHex,
    fillAlpha: textArt.fillAlpha,
    strokeHex: textArt.strokeHex,
    strokeAlpha: textArt.strokeAlpha,
    strokeWidthPt: textArt.strokeWidthPt,
    rotationDegrees: textArt.rotationDegrees,
  };
  const style = textArtRunStyle(textArt);
  const outlineOf = (runStyle: ResolvedRunStyle) =>
    width > 0 && height > 0 ? usableOutline(measurer?.textOutline?.(textArt.text, runStyle)) : null;
  // A family no face resolves (a misspelled or garbled name) draws in the document's default
  // face, as a run of body text with that name does, rather than dropping the watermark.
  const outline =
    outlineOf(style) ??
    (style.fontFamily === null ? null : outlineOf({ ...style, fontFamily: null }));
  const ink = outline?.ink;
  if (!outline || !ink) return Object.freeze({ ...base, path: null, fit: null });
  // A box too small for the inset keeps its whole area for the ink.
  const insetX = width > 4 * INSET_X_PT ? INSET_X_PT : 0;
  const insetY = height > 4 * INSET_Y_PT ? INSET_Y_PT : 0;
  const scaleX = (width - 2 * insetX) / (ink.right - ink.left);
  const scaleY = (height - 2 * insetY) / (ink.bottom - ink.top);
  const fit: TextArtFit = Object.freeze({
    scaleX,
    scaleY,
    offsetX: insetX - ink.left * scaleX,
    offsetY: insetY - ink.top * scaleY,
  });
  return Object.freeze({
    ...base,
    path: outline.path === null ? null : fittedPath(outline.path, fit),
    fit,
  });
}

/**
 * Paint bounds that hold a text box shape: grown by the outer half of a centred outline, then
 * turned about the box centre.
 */
export function turnedTextboxBounds(
  bounds: LayoutBox,
  story:
    | {
        readonly chromeRotationDegrees?: number;
        readonly strokeCentered?: true;
        readonly strokeHex: string | null;
        readonly strokeWidthPt: number;
        readonly shadow?: Readonly<{ dx: number; dy: number }>;
      }
    | null
    | undefined
): LayoutBox {
  if (!story) return bounds;
  const reach =
    story.strokeCentered && story.strokeHex !== null ? Math.max(0, story.strokeWidthPt) / 2 : 0;
  const grown = reach
    ? Object.freeze({
        x: bounds.x - reach,
        y: bounds.y - reach,
        width: bounds.width + 2 * reach,
        height: bounds.height + 2 * reach,
      })
    : bounds;
  const degrees = story.chromeRotationDegrees;
  const turned = degrees ? rotatedBounds(grown, degrees) : grown;
  // A shadow repeats the shape at a page offset; the painted area holds both.
  const shadow = story.shadow;
  if (!shadow || (shadow.dx === 0 && shadow.dy === 0)) return turned;
  const x = Math.min(turned.x, turned.x + shadow.dx),
    y = Math.min(turned.y, turned.y + shadow.dy);
  return Object.freeze({
    x,
    y,
    width: turned.width + Math.abs(shadow.dx),
    height: turned.height + Math.abs(shadow.dy),
  });
}

/** The box turned about its centre, as the axis-aligned box that holds it. */
export function rotatedBounds(box: LayoutBox, degrees: number): LayoutBox {
  if (degrees % 360 === 0) return box;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians)),
    sin = Math.abs(Math.sin(radians));
  const width = box.width * cos + box.height * sin,
    height = box.width * sin + box.height * cos;
  return Object.freeze({
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  });
}
