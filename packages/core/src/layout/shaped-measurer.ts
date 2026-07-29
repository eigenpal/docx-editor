// Exact line metrics and advances, from the font itself (task 7.7).
//
// Every host-side measurement is a fraction out, and the fraction is not cosmetic. Word
// derives single line spacing from the font's `hhea` table — ascent + descent + line gap —
// and a browser will not tell you the line gap: canvas reports the font bounding box
// (ascent and descent only), and a DOM probe reports a rounded composite. Build a line
// height from either and every run either overflows the line reserved for it or leaves a
// gap beneath it, which is what a selection band draws attention to.
//
// The font bytes carry the exact numbers, and the shaper already reads them. This adapts
// that shaper to the semantic layout lane's `TextMeasurer` port, so the lane stays DOM-free
// and becomes exact at the same time: advances are summed glyph advances, not estimated
// character widths, and line height is Word's own formula over the real table values.
//
// Order of operations follows Word, and matches the fixed measurer so the two are
// substitutable: shaped advance, then horizontal scaling, then character spacing as an
// absolute per-character addition the scaling does not multiply.

import type { ResolvedFont } from './font-resource.ts';
import type { TextMeasurer } from './semantic-records.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import {
  createShapingEnvironment,
  type ShapedRun,
  type TextShaper,
  type VersionedShapingLibrary,
} from './shaped-run.ts';

export interface ShapedMeasurerOptions {
  readonly shaper: TextShaper;
  /**
   * The font a run should be measured with.
   *
   * Returning null means "not available", and measurement falls back rather than throwing:
   * a document naming a font nobody has must still lay out. Resolution is the host's,
   * because which bytes stand in for `Calibri` is a packaging decision, not a layout one.
   */
  readonly resolveFont: (style: ResolvedRunStyle) => ResolvedFont | null;
  /** Used when no font resolves. */
  readonly fallback: TextMeasurer;
  readonly shapingLibrary: VersionedShapingLibrary;
  readonly unicodeDataVersion: string;
  /** Fixed-point units per point in the shaper's output. */
  readonly fixedPointScale?: number;
  /** ISO 15924 script and BCP 47 language for shaping. Latin/English by default. */
  readonly script?: string;
  readonly language?: string;
}

/** Super and subscript draw at three quarters, so they measure at three quarters. */
const sizeFactorOf = (style: ResolvedRunStyle): number =>
  style.verticalAlign === 'baseline' ? 1 : 0.75;

/** Half-points, which is the unit the shaper takes and OOXML stores. */
function halfPointsOf(style: ResolvedRunStyle): number {
  const halfPoints = Math.round(style.fontSizePt * sizeFactorOf(style) * 2);
  // A zero-sized run would shape to nothing and make a line of no height; the smallest size
  // Word records is half a point.
  return Math.max(1, halfPoints);
}

export function createShapedMeasurer(options: ShapedMeasurerOptions): TextMeasurer {
  const {
    shaper,
    resolveFont,
    fallback,
    shapingLibrary,
    unicodeDataVersion,
    fixedPointScale = 1000,
    script = 'Latn',
    language = 'en',
  } = options;

  const widths = new Map<string, number>();
  const lines = new Map<string, { height: number; baseline: number }>();

  const keyOf = (font: ResolvedFont, style: ResolvedRunStyle): string =>
    `${font.identity}|${halfPointsOf(style)}`;

  const shape = (text: string, font: ResolvedFont, style: ResolvedRunStyle): ShapedRun =>
    shaper.shape({
      text,
      fontSizeHalfPoints: halfPointsOf(style),
      // The semantic paragraph lane is left-to-right; bidi resolution is its own task, and
      // claiming a level here would be asserting an analysis that has not run.
      bidiLevel: 0,
      environment: createShapingEnvironment({
        font,
        variationAxes: {},
        shapingLibrary,
        unicodeDataVersion,
        normalization: 'none',
        script,
        language,
        direction: 'ltr',
        features: {},
        fallbackOrder: [],
        fixedPointScale,
        roundingMode: 'halfToEven',
      }),
    });

  return {
    measure(text, style) {
      if (text.length === 0) return 0;
      const font = resolveFont(style);
      if (!font) return fallback.measure(text, style);

      const key = `${keyOf(font, style)}|${text}`;
      let advance = widths.get(key);
      if (advance === undefined) {
        let total = 0;
        try {
          for (const glyph of shape(text, font, style).glyphs) total += glyph.advanceX;
        } catch {
          // Shaping refuses malformed or oversized input by design. Falling back keeps a
          // hostile font from taking the document down with it.
          return fallback.measure(text, style);
        }
        advance = total / fixedPointScale;
        widths.set(key, advance);
      }
      return (
        advance * (style.horizontalScalePercent / 100) + text.length * style.characterSpacingPt
      );
    },

    lineMetrics(style) {
      const font = resolveFont(style);
      if (!font) return fallback.lineMetrics(style);

      const key = keyOf(font, style);
      const cached = lines.get(key);
      if (cached) return cached;

      let metrics: { height: number; baseline: number };
      try {
        // Vertical metrics are a property of the FACE, not of the text, so any string
        // yields them; a single space is the cheapest to shape.
        const shaped = shape(' ', font, style);
        const ascent = shaped.metrics.ascent / fixedPointScale;
        const descent = shaped.metrics.descent / fixedPointScale;
        const lineGap = shaped.metrics.lineGap / fixedPointScale;
        // Word's single spacing, exactly: the gap is part of the line, not padding around
        // it. Leaving it out is what made every line a fraction too short.
        const height = ascent + descent + lineGap;
        metrics = height > 0 ? { height, baseline: ascent } : fallback.lineMetrics(style);
      } catch {
        metrics = fallback.lineMetrics(style);
      }
      lines.set(key, metrics);
      return metrics;
    },
  };
}
