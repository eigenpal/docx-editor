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
  layoutFaceHasSmallCaps,
  layoutRunHalfPointsOf,
  shapeLayoutStyleRun,
  type LayoutShapingEnvironment,
} from './layout-run-shape.ts';
import type {
  FixedPointRoundingMode,
  NormalizationPolicy,
  TextShaper,
  VersionedShapingLibrary,
} from './shaped-run.ts';

export type { LayoutShapingEnvironment } from './layout-run-shape.ts';

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
  readonly environment: LayoutShapingEnvironment;
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
  /** Optional low-level shaping controls; omitted values preserve the released defaults. */
  readonly normalization?: NormalizationPolicy;
  readonly features?: Readonly<Record<string, number>>;
  readonly roundingMode?: FixedPointRoundingMode;
}

/** Environment-bound production options that cannot drift from layout cache identity. @public */
export interface LayoutEnvironmentShapedMeasurerOptions {
  /** Shaper from the same admitted layout operation. */
  readonly shaper: TextShaper;
  /** Resolve a run to an admitted face, or null to use the bounded fallback. */
  readonly resolveFont: (style: ResolvedRunStyle) => ResolvedFont | null;
  /** Bounded measurement fallback when no admitted face resolves. */
  readonly fallback: TextMeasurer;
  /** Fingerprinted shaping environment; all geometry-affecting controls come from here. */
  readonly environment: LayoutShapingOptions['environment'];
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

// One measurer belongs to one editor/export session, but a large document can still ask it to
// measure hundreds of thousands of distinct line-break prefixes. Keeping every prefix made the
// measurement cache larger than the published layout it accelerated. A fixed-size clock keeps
// the hot working set while giving every session a hard retention bound.
const MAX_CACHED_SHAPED_WIDTHS = 4_096;

/** Super and subscript draw at three quarters, so they measure at three quarters. */
const sizeFactorOf = (style: ResolvedRunStyle): number =>
  style.verticalAlign === 'baseline' ? 1 : 0.75;

/**
 * A {@link TextMeasurer} that measures through the shaper rather than through a canvas.
 *
 * The accurate path: advances come from the same shaping run that will position the glyphs, so
 * measurement and paint cannot disagree. Falls back per-run when a font is unavailable rather than
 * throwing, because a document naming a font nobody has must still lay out.
 */
export function createShapedMeasurer(options: ShapedMeasurerOptions): TextMeasurer;
export function createShapedMeasurer(options: LayoutEnvironmentShapedMeasurerOptions): TextMeasurer;
export function createShapedMeasurer(
  options: ShapedMeasurerOptions | LayoutEnvironmentShapedMeasurerOptions
): TextMeasurer {
  const environment = 'environment' in options ? options.environment : undefined;
  const explicit = 'environment' in options ? undefined : options;
  const { shaper, resolveFont, fallback } = options;
  const baseEnvironment: LayoutShapingEnvironment =
    environment ??
    ({
      shapingLibrary: explicit!.shapingLibrary,
      unicodeDataVersion: explicit!.unicodeDataVersion,
      script: explicit?.script ?? 'Latn',
      fixedPointScale: explicit?.fixedPointScale ?? 1000,
      normalization: explicit?.normalization ?? 'none',
      features: explicit?.features ?? {},
      roundingMode: explicit?.roundingMode ?? 'halfToEven',
      language: explicit?.language ?? 'en',
      variationAxes: {},
    } satisfies LayoutShapingEnvironment);

  // Nested by font object and half-point size rather than by one concatenated string key:
  // `measure` runs once per word-boundary probe of every line break in the document, and
  // building (then hashing) a `identity|size|text` string per call made the KEYS a
  // measurable slice of a large document's cold open. The font level is a WeakMap so a
  // font-epoch swap releases its subtree.
  // Two roots, not one keyed string: the same text and face have different advances with
  // `smcp`, so a plain run must not reuse a small-cap run's shaped width or the reverse.
  const widthsByFont = new WeakMap<ResolvedFont, Map<number, Map<string, number>>>();
  const smallCapsWidthsByFont = new WeakMap<ResolvedFont, Map<number, Map<string, number>>>();
  const linesByFont = new WeakMap<
    ResolvedFont,
    Map<number, { height: number; baseline: number }>
  >();
  // Style objects live inside cached broken lines, so one resolution per style OBJECT
  // amortizes the family/weight lookup across every probe of the runs that share it.
  const fontsByStyle = new WeakMap<ResolvedRunStyle, ResolvedFont | null>();
  const smallCapsSupportByFont = new WeakMap<ResolvedFont, boolean>();
  const widthClock = new Array<
    | {
        readonly cache: Map<string, number>;
        readonly text: string;
      }
    | undefined
  >(MAX_CACHED_SHAPED_WIDTHS);
  let widthClockCursor = 0;

  const cacheWidth = (cache: Map<string, number>, text: string, advance: number): void => {
    const evicted = widthClock[widthClockCursor];
    if (evicted) evicted.cache.delete(evicted.text);
    cache.set(text, advance);
    widthClock[widthClockCursor] = { cache, text };
    widthClockCursor = (widthClockCursor + 1) % MAX_CACHED_SHAPED_WIDTHS;
  };

  const resolveFontCached = (style: ResolvedRunStyle): ResolvedFont | null => {
    // A stored `null` ("no font resolves") comes back as null, not undefined, so the
    // negative answer is cached too.
    const cached = fontsByStyle.get(style);
    if (cached !== undefined) return cached;
    const font = resolveFont(style);
    fontsByStyle.set(style, font);
    return font;
  };

  const widthsFor = (
    font: ResolvedFont,
    halfPoints: number,
    smallCaps: boolean
  ): Map<string, number> => {
    const root = smallCaps ? smallCapsWidthsByFont : widthsByFont;
    let bySize = root.get(font);
    if (!bySize) {
      bySize = new Map();
      root.set(font, bySize);
    }
    let byText = bySize.get(halfPoints);
    if (!byText) {
      byText = new Map();
      bySize.set(halfPoints, byText);
    }
    return byText;
  };

  return {
    measure(text, style) {
      if (text.length === 0) return 0;
      const font = resolveFontCached(style);
      if (!font) return fallback.measure(text, style);

      const byText = widthsFor(font, layoutRunHalfPointsOf(style), style.smallCaps);
      let advance = byText.get(text);
      if (advance === undefined) {
        let total = 0;
        try {
          // Per FACE, so this span and every prefix of it answer the same way.
          if (
            style.smallCaps &&
            !layoutFaceHasSmallCaps(shaper, baseEnvironment, font, style, smallCapsSupportByFont)
          ) {
            return fallback.measure(text, style);
          }
          const shaped = shapeLayoutStyleRun(shaper, baseEnvironment, font, style, text);
          for (const glyph of shaped.glyphs) total += glyph.advanceX;
        } catch {
          // Shaping refuses malformed or oversized input by design. Falling back keeps a
          // hostile font from taking the document down with it.
          return fallback.measure(text, style);
        }
        advance = total / baseEnvironment.fixedPointScale;
        cacheWidth(byText, text, advance);
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
      const halfPoints = layoutRunHalfPointsOf(style);
      const cached = bySize.get(halfPoints);
      if (cached) {
        return factor === 1
          ? cached
          : { height: cached.height * factor, baseline: cached.baseline * factor };
      }

      let metrics: { height: number; baseline: number };
      let scalable = true;
      const substitutionMetrics = font.substitution?.lineMetrics;
      if (substitutionMetrics) {
        const baseSizePt = halfPoints / 2;
        metrics = {
          height: substitutionMetrics.heightEm * baseSizePt,
          baseline: substitutionMetrics.baselineEm * baseSizePt,
        };
      } else {
        try {
          // Vertical metrics are a property of the FACE, not of the text, so any string
          // yields them; a single space is the cheapest to shape.
          const shaped = shapeLayoutStyleRun(shaper, baseEnvironment, font, style, ' ');
          const ascent = shaped.metrics.ascent / baseEnvironment.fixedPointScale;
          const descent = shaped.metrics.descent / baseEnvironment.fixedPointScale;
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
            Math.max(0, shaped.metrics.lineGap / baseEnvironment.fixedPointScale),
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

/**
 * Bind measurement directly to the environment whose operation identity keys layout caches.
 * Production browser/server hosts use this adapter so fingerprinted and executed shaping cannot
 * drift through independently forwarded fields.
 * @public
 */
export function createLayoutShapedMeasurer(
  shaping: LayoutShapingOptions,
  options: Pick<ShapedMeasurerOptions, 'resolveFont' | 'fallback'>
): TextMeasurer {
  return createShapedMeasurer({
    ...options,
    shaper: shaping.shaper,
    environment: shaping.environment,
  });
}
