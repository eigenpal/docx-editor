// Exact line metrics and advances, from the font itself (task 7.7).
//
// Every host-side measurement is a fraction out, and the fraction is not cosmetic. Word
// derives single line spacing from the font's ascent and descent. `hhea.lineGap` is external
// leading: Word does not add it to the line box. Including it makes every line a fraction too
// tall, and that fraction accumulates until text paginates earlier than Word.
//
// The font bytes carry the exact numbers, and the shaper already reads them. This adapts
// that shaper to the semantic layout lane's `TextMeasurer` port, so the lane stays DOM-free
// and becomes exact at the same time: advances are summed glyph advances, not estimated
// character widths, and line height is Word's own formula over the real table values.
//
// Order of operations follows Word, and matches the fixed measurer so the two are
// substitutable: shaped advance, then horizontal scaling, then character spacing as an
// absolute per-character addition the scaling does not multiply.

import type { FontResourceSnapshot, ResolvedFont } from './font-resource.ts';
import type { TextMeasurer } from './semantic-records.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import type { OperationSnapshot } from './resolved-cache.ts';
import {
  createShapingEnvironment,
  type FixedPointRoundingMode,
  type NormalizationPolicy,
  type ShapedRun,
  type TextShaper,
  type VersionedShapingLibrary,
} from './shaped-run.ts';

/**
 * A fully resolved shaping bundle: fonts, shaper, and the environment they were admitted
 * under. Produced by the editor lane's font configuration (`createLayoutShaping`) and
 * consumed to build shaped measurers. Lived in the legacy `metrics.ts` until the legacy
 * layout lane was deleted; the type is the surviving contract between the two lanes.
 */
export interface LayoutShapingOptions {
  readonly fonts: FontResourceSnapshot;
  readonly shaper: TextShaper;
  readonly defaultFont: {
    readonly family: string;
    readonly sizeHalfPoints: number;
  };
  readonly environment: {
    readonly variationAxes: Readonly<Record<string, number>>;
    readonly shapingLibrary: VersionedShapingLibrary;
    readonly unicodeDataVersion: string;
    readonly normalization: NormalizationPolicy;
    readonly language: string;
    readonly features: Readonly<Record<string, number>>;
    readonly fixedPointScale: number;
    readonly roundingMode: FixedPointRoundingMode;
  };
  readonly ligatureCaretPolicy: 'cluster-edges-only';
  readonly operation: OperationSnapshot;
}

/**
 * How the shaped measurer resolves fonts and bounds its work.
 *
 * Font resolution is the HOST's: returning null means "not available" and measurement falls back
 * rather than throwing, because a document naming a font nobody has must still lay out.
 */
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

/**
 * A {@link TextMeasurer} that measures through the shaper rather than through a canvas.
 *
 * The accurate path: advances come from the same shaping run that will position the glyphs, so
 * measurement and paint cannot disagree. Falls back per-run when a font is unavailable rather than
 * throwing, because a document naming a font nobody has must still lay out.
 */
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
        // `lineGap` is external leading. Word's line box uses the face ascent + descent;
        // adding the gap again makes Arial/Liberation Sans about 2.9% too tall per line.
        const height = ascent + descent;
        metrics = height > 0 ? { height, baseline: ascent } : fallback.lineMetrics(style);
      } catch {
        metrics = fallback.lineMetrics(style);
      }
      lines.set(key, metrics);
      return metrics;
    },
  };
}
