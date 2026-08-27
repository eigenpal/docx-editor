// Exact line metrics and advances, from the font itself (task 7.7).
//
// Every host-side measurement is a fraction out, and the fraction is not cosmetic. Word
// derives single line spacing from the face's ascent, descent AND `hhea.lineGap` — the same
// total GDI reports as `tmHeight + tmExternalLeading`. Dropping the gap makes every line of a
// face that has one a fraction too short, and that fraction accumulates until text paginates
// later than Word.
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

/**
 * Ceiling on `hhea.lineGap`, as a multiple of the face's own ascent + descent.
 *
 * The gap is file-derived, signed, and unbounded in the format, so an embedded font is a
 * lever on every line box in the document. Measured over all twenty faces this engine ships,
 * the largest real gap is Liberation Serif's 87/2268 = 0.038 face boxes; Liberation Sans is
 * 0.029 and Carlito, Caladea and Liberation Mono declare none at all. Even a font with
 * unusually generous leading is a few percent, not a multiple.
 *
 * 0.5 therefore clears the largest face this engine ships by 13x — no real document can
 * reach it — while capping the worst case an attacker can produce at 1.5x the face box. A
 * full face box would have allowed 2x, which is a usable layout blow-up from a file.
 */
const MAX_LINE_GAP_FACE_BOXES = 0.5;

/**
 * Ceiling on a face's own ascent + descent, as a multiple of the size it is drawn at.
 *
 * Measured over the twenty faces this engine ships plus the test corpus, the largest face
 * box is Carlito's 1.2207 em; Caladea is 1.15, Liberation Mono 1.1328, Liberation Sans
 * 1.1172, Liberation Serif 1.1074. Faces built for scripts with tall ascenders reach about
 * 2 em, so 4 clears every real face by a wide margin — it exists only so a font declaring a
 * huge `hhea.ascender` over a tiny `head.unitsPerEm` cannot make one run a page. With the
 * gap ceiling above it, the worst line box a file can ask for is 6 em.
 */
const MAX_FACE_BOX_EM = 4;

/** Maximum distinct lowercase characters tested for `smcp` support in one font. */
const MAX_SMALL_CAPS_SUPPORT_PROBES = 256;

/** Super and subscript draw at three quarters, so they measure at three quarters. */
const sizeFactorOf = (style: ResolvedRunStyle): number =>
  style.verticalAlign === 'baseline' ? 1 : 0.75;

/**
 * Half-points, which is the unit the shaper takes and OOXML stores.
 *
 * The BASE size, never the super/subscript size: the shaper asserts an integer, and rounding
 * `11pt × 0.75 × 2 = 16.5` up to 17 half-points measured superscript 3% wider than paint
 * draws it — every span after one on the line sat left of its glyphs, and the caret landed
 * mid-glyph. Advances are unhinted and scale linearly, so callers shape at the base size and
 * multiply by {@link sizeFactorOf}, which is exactly the factor paint applies.
 */
function halfPointsOf(style: ResolvedRunStyle): number {
  const halfPoints = Math.round(style.fontSizePt * 2);
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

  // Nested by font object and half-point size rather than by one concatenated string key:
  // `measure` runs once per word-boundary probe of every line break in the document, and
  // building (then hashing) a `identity|size|text` string per call made the KEYS a
  // measurable slice of a large document's cold open. The font level is a WeakMap so a
  // font-epoch swap releases its subtree.
  const widthsByFont = new WeakMap<ResolvedFont, Map<number, Map<string, number>>>();
  const linesByFont = new WeakMap<
    ResolvedFont,
    Map<number, { height: number; baseline: number }>
  >();
  // Style objects live inside cached broken lines, so one resolution per style OBJECT
  // amortizes the family/weight lookup across every probe of the runs that share it.
  const fontsByStyle = new WeakMap<ResolvedRunStyle, ResolvedFont | null>();
  const smallCapsSupportByFont = new WeakMap<ResolvedFont, Map<string, boolean>>();

  const resolveFontCached = (style: ResolvedRunStyle): ResolvedFont | null => {
    // A stored `null` ("no font resolves") comes back as null, not undefined, so the
    // negative answer is cached too.
    const cached = fontsByStyle.get(style);
    if (cached !== undefined) return cached;
    const font = resolveFont(style);
    fontsByStyle.set(style, font);
    return font;
  };

  const widthsFor = (font: ResolvedFont, halfPoints: number): Map<string, number> => {
    let bySize = widthsByFont.get(font);
    if (!bySize) {
      bySize = new Map();
      widthsByFont.set(font, bySize);
    }
    let byText = bySize.get(halfPoints);
    if (!byText) {
      byText = new Map();
      bySize.set(halfPoints, byText);
    }
    return byText;
  };

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
        // `w:smallCaps` selects the font's small-cap glyphs. Paint uses the matching CSS
        // feature, so shaping must reserve those glyph advances instead of lowercase advances.
        features: style.smallCaps ? { smcp: 1 } : {},
        fallbackOrder: [],
        fixedPointScale,
        roundingMode: 'halfToEven',
      }),
    });

  const smallCapsCoverText = (
    text: string,
    font: ResolvedFont,
    style: ResolvedRunStyle
  ): boolean => {
    let support = smallCapsSupportByFont.get(font);
    if (!support) {
      support = new Map();
      smallCapsSupportByFont.set(font, support);
    }
    for (const character of text) {
      if (character === character.toUpperCase()) continue;
      let supported = support.get(character);
      if (supported === undefined) {
        if (support.size >= MAX_SMALL_CAPS_SUPPORT_PROBES) return false;
        const featured = shape(character, font, { ...style, smallCaps: true });
        const plain = shape(character, font, { ...style, smallCaps: false });
        supported =
          featured.glyphs.length !== plain.glyphs.length ||
          featured.glyphs.some((glyph, index) => glyph.id !== plain.glyphs[index]?.id);
        support.set(character, supported);
      }
      if (!supported) return false;
    }
    return true;
  };

  return {
    measure(text, style) {
      if (text.length === 0) return 0;
      const font = resolveFontCached(style);
      if (!font) return fallback.measure(text, style);

      const byText = widthsFor(font, halfPointsOf(style));
      // The same text and face can have different advances with `smcp`. Keep that feature in
      // the key so a plain run cannot reuse a small-cap run's shaped width, or the reverse.
      const shapingKey = style.smallCaps ? `smcp\0${text}` : text;
      let advance = byText.get(shapingKey);
      if (advance === undefined) {
        let total = 0;
        try {
          // Test each lowercase character separately. A whole-run comparison can hide partial
          // coverage when a ligature splits after only one character receives `smcp`.
          if (style.smallCaps && !smallCapsCoverText(text, font, style)) {
            return fallback.measure(text, style);
          }
          const shaped = shape(text, font, style);
          for (const glyph of shaped.glyphs) total += glyph.advanceX;
        } catch {
          // Shaping refuses malformed or oversized input by design. Falling back keeps a
          // hostile font from taking the document down with it.
          return fallback.measure(text, style);
        }
        advance = total / fixedPointScale;
        byText.set(shapingKey, advance);
      }
      // Base-size advance scaled to the drawn size; the cache stays keyed on the base size,
      // so baseline and super/subscript runs of one face share entries.
      return (
        advance * sizeFactorOf(style) * (style.horizontalScalePercent / 100) +
        text.length * style.characterSpacingPt
      );
    },

    lineMetrics(style) {
      const font = resolveFontCached(style);
      if (!font) return fallback.lineMetrics(style);

      const factor = sizeFactorOf(style);
      let bySize = linesByFont.get(font);
      if (!bySize) {
        bySize = new Map();
        linesByFont.set(font, bySize);
      }
      const halfPoints = halfPointsOf(style);
      const cached = bySize.get(halfPoints);
      if (cached) {
        return factor === 1
          ? cached
          : { height: cached.height * factor, baseline: cached.baseline * factor };
      }

      let metrics: { height: number; baseline: number };
      let scalable = true;
      try {
        // Vertical metrics are a property of the FACE, not of the text, so any string
        // yields them; a single space is the cheapest to shape.
        const shaped = shape(' ', font, style);
        const ascent = shaped.metrics.ascent / fixedPointScale;
        const descent = shaped.metrics.descent / fixedPointScale;
        // Word's single-spaced line box is ascent + descent + lineGap, and the leading sits
        // BELOW the descent — the same total GDI reports as `tmHeight + tmExternalLeading`.
        // Dropping the gap is what made a 10 pt Arial line 11.17 pt where Word draws 11.50
        // (Liberation Sans and Liberation Serif both carry Arial's and Times New Roman's own
        // gap, so both land on Word's 1.1499 em). Faces with no gap — Carlito, Caladea,
        // Liberation Mono — are unaffected, which is why the error only showed on the two
        // faces that have one.
        //
        // BOUNDED IN THE EM, because all three numbers are `hhea` int16 read from a font a
        // DOCX can embed and nothing downstream bounds a line box. The shaper admits any
        // safe integer over any `upem > 0`, so `ascender = 32767` over `upem = 16` is a face
        // box of ~2048 em on its own — bounding the gap against the face box alone would
        // have clamped one attacker-controlled number against another.
        //
        // The face box is clamped first, absolutely, against the drawn size. Ascent and
        // descent scale together so the baseline stays where it sits inside the box. Then
        // the gap: non-negative, because external leading is non-negative on Windows and in
        // GDI and a face declaring `lineGap = -(ascender - descender) + 1` would otherwise
        // give every run in that family a one-unit line that the `height > 0` guard does not
        // catch; and at most half a face box above.
        const baseSizePt = halfPoints / 2;
        const rawFaceBox = ascent + descent;
        const faceBoxCeiling = baseSizePt * MAX_FACE_BOX_EM;
        const squeeze = rawFaceBox > faceBoxCeiling ? faceBoxCeiling / rawFaceBox : 1;
        const faceBox = rawFaceBox * squeeze;
        const lineGap = Math.min(
          Math.max(0, shaped.metrics.lineGap / fixedPointScale),
          faceBox * MAX_LINE_GAP_FACE_BOXES
        );
        const height = faceBox + lineGap;
        if (height > 0) {
          metrics = { height, baseline: ascent * squeeze };
        } else {
          metrics = fallback.lineMetrics(style);
          scalable = false;
        }
      } catch {
        metrics = fallback.lineMetrics(style);
        scalable = false;
      }
      // Fallback answers are already at the drawn size; only face metrics shaped at the base
      // size are cached and rescaled.
      if (!scalable) return metrics;
      bySize.set(halfPoints, metrics);
      return factor === 1
        ? metrics
        : { height: metrics.height * factor, baseline: metrics.baseline * factor };
    },
  };
}
