// Exact line metrics and advances read from the font itself (task 7.7).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_RUN_STYLE,
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
  type ResolvedFont,
  type ResolvedRunStyle,
} from '../index.ts';

await initializeHarfBuzz();

const REQUEST: FontRequest = { family: 'DejaVu Sans', weight: 400, style: 'normal' };

function resolvedFixture(): ResolvedFont {
  const bytes = new Uint8Array(
    readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
  );
  const snapshot = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 2_000_000,
    resources: [
      {
        request: REQUEST,
        id: 'dejavu-400',
        bytes,
        hash: sha256FontBytes(bytes),
        faceIndex: 0,
      },
    ],
    validateFont: harfBuzzFontValidator,
  });
  const result = snapshot.resolve(REQUEST);
  if (result instanceof FontResolutionError) throw result;
  return result;
}

const font = resolvedFixture();
const fallback = createFixedMeasurer(6, 14);

const measurer = (resolve: (style: ResolvedRunStyle) => ResolvedFont | null = () => font) =>
  createShapedMeasurer({
    shaper: createHarfBuzzTextShaper(),
    resolveFont: resolve,
    fallback,
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '15.1',
  });

const style = (overrides: Partial<ResolvedRunStyle> = {}): ResolvedRunStyle => ({
  ...DEFAULT_RUN_STYLE,
  fontSizePt: 11,
  ...overrides,
});

describe('line metrics come from the font, not from a multiplier (task 7.7)', () => {
  test('the line height is the face ascent plus descent', () => {
    const metrics = measurer().lineMetrics(style());
    expect(metrics.height).toBeGreaterThan(0);
    expect(metrics.baseline).toBeGreaterThan(0);
    // The baseline is the ascent, so it is strictly inside the line.
    expect(metrics.baseline).toBeLessThan(metrics.height);
  });

  test('hhea lineGap is part of the Word line box, below the descent', () => {
    const withExternalGap = createShapedMeasurer({
      shaper: {
        shape(input) {
          return {
            text: input.text,
            direction: 'ltr',
            bidiLevel: 0,
            glyphs: [],
            clusters: [],
            fontSpans: [],
            metrics: { ascent: 9_000, descent: 2_000, lineGap: 500 },
          };
        },
      },
      resolveFont: () => font,
      fallback,
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '15.1',
      fixedPointScale: 1_000,
    });

    // Word's single-spaced line box is ascent + descent + lineGap. Measured against Word's
    // own PDF: an Arial 10 pt line pitch is 11.50 pt, which is (1854 + 434 + 67) / 2048 em,
    // not the 11.17 pt that dropping the gap gives.
    expect(withExternalGap.lineMetrics(style())).toEqual({ height: 11.5, baseline: 9 });
  });

  test('Liberation Sans measures Word\u2019s Arial line box, gap included', () => {
    // Word\u2019s own PDF of an Arial 10 pt paragraph puts consecutive baselines 11.50 pt
    // apart. Liberation Sans carries Arial\u2019s metrics exactly \u2014 hhea 1854 / -434 / 67
    // over 2048 units \u2014 so the shipped substitute has to land on the same number.
    const bytes = new Uint8Array(
      readFileSync(new URL('../../../../fonts/assets/LiberationSans-Regular.ttf', import.meta.url))
    );
    const request: FontRequest = { family: 'Liberation Sans', weight: 400, style: 'normal' };
    const snapshot = createFontResourceSnapshot({
      epoch: 1,
      maxFontBytes: 2_000_000,
      resources: [
        { request, id: 'liberation-400', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 },
      ],
      validateFont: harfBuzzFontValidator,
    });
    const resolved = snapshot.resolve(request);
    if (resolved instanceof FontResolutionError) throw resolved;
    const metrics = measurer(() => resolved).lineMetrics(style({ fontSizePt: 10 }));
    expect(metrics.height).toBeCloseTo(11.5, 2);
    // Ascent alone is 9.05 pt; the difference is descent plus the external leading Word
    // keeps in the box.
    expect(metrics.baseline).toBeCloseTo(9.053, 2);
  });

  test('a negative hhea lineGap cannot crush the line box', () => {
    // `hhea.lineGap` is a signed int16 read from a font, and a DOCX embeds fonts. A face
    // declaring a gap that cancels its own ascent and descent would otherwise give every run
    // in that family a one-unit line box, and the `height > 0` guard would not catch it.
    // External leading is non-negative on Windows and in GDI.
    const hostile = createShapedMeasurer({
      shaper: {
        shape(input) {
          return {
            text: input.text,
            direction: 'ltr',
            bidiLevel: 0,
            glyphs: [],
            clusters: [],
            fontSpans: [],
            metrics: { ascent: 9_000, descent: 2_000, lineGap: -10_999 },
          };
        },
      },
      resolveFont: () => font,
      fallback,
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '15.1',
      fixedPointScale: 1_000,
    });
    expect(hostile.lineMetrics(style())).toEqual({ height: 11, baseline: 9 });
  });

  test('an enormous hhea lineGap cannot turn one run into a page', () => {
    // The other end of the same file-derived number. `lineGap = 32767` over 1000 units per em
    // is a ~337 pt line for a 10 pt run — one line to a page for the whole document — and
    // nothing downstream bounds a line box. Capped at the face's own ascent + descent, which
    // every shipping face clears by an order of magnitude.
    const enormous = createShapedMeasurer({
      shaper: {
        shape(input) {
          return {
            text: input.text,
            direction: 'ltr',
            bidiLevel: 0,
            glyphs: [],
            clusters: [],
            fontSpans: [],
            metrics: { ascent: 9_000, descent: 2_000, lineGap: 32_767_000 },
          };
        },
      },
      resolveFont: () => font,
      fallback,
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '15.1',
      fixedPointScale: 1_000,
    });
    // Face box 11, so the gap is admitted up to 5.5 and the line box stops at 16.5 — 1.5x
    // the face, against the largest real gap among the shipped faces of 0.038 face boxes.
    expect(enormous.lineMetrics(style())).toEqual({ height: 16.5, baseline: 9 });
  });

  test('it is NOT the flat multiplier the fallback uses, so the font is really being read', () => {
    // If the two agreed, the test would pass whether or not the font was consulted.
    const exact = measurer().lineMetrics(style());
    const approximate = fallback.lineMetrics(style());
    expect(exact.height).not.toBe(approximate.height);
  });

  test('line height scales with the run size', () => {
    const small = measurer().lineMetrics(style({ fontSizePt: 8 }));
    const large = measurer().lineMetrics(style({ fontSizePt: 24 }));
    expect(large.height).toBeGreaterThan(small.height * 2);
  });

  test('superscript measures at three quarters, so it does not inflate its line', () => {
    const baseline = measurer().lineMetrics(style());
    const raised = measurer().lineMetrics(style({ verticalAlign: 'superscript' }));
    expect(raised.height).toBeLessThan(baseline.height);
  });

  test('superscript line metrics are EXACTLY three quarters of the baseline metrics', () => {
    // 11pt × 0.75 = 8.25pt = 16.5 half-points. Shaping at a rounded 17 half-points made
    // super/subscript 3% taller and wider than paint draws them.
    const baseline = measurer().lineMetrics(style());
    const raised = measurer().lineMetrics(style({ verticalAlign: 'superscript' }));
    expect(raised.height).toBeCloseTo(baseline.height * 0.75, 6);
    expect(raised.baseline).toBeCloseTo(baseline.baseline * 0.75, 6);
  });
});

describe('advances are summed glyph advances (task 7.7)', () => {
  test('a longer string is wider, and width grows with size', () => {
    const measure = measurer();
    expect(measure.measure('mm', style())).toBeGreaterThan(measure.measure('m', style()));
    expect(measure.measure('hello', style({ fontSizePt: 22 }))).toBeGreaterThan(
      measure.measure('hello', style())
    );
  });

  test('a proportional face gives different widths to different letters', () => {
    // The whole reason for shaping rather than counting characters: `i` is not `m`.
    const measure = measurer();
    expect(measure.measure('i', style())).not.toBe(measure.measure('m', style()));
  });

  test('empty text has no width and never reaches the shaper', () => {
    expect(measurer().measure('', style())).toBe(0);
  });

  test('horizontal scaling multiplies the advance, character spacing adds to it', () => {
    // Word's order: scale the shaped advance, then add spacing per character, so spacing is
    // an absolute addition the scale does not multiply.
    const measure = measurer();
    const plain = measure.measure('abc', style());
    const scaled = measure.measure('abc', style({ horizontalScalePercent: 200 }));
    expect(scaled).toBeCloseTo(plain * 2, 5);
    const spaced = measure.measure('abc', style({ characterSpacingPt: 1 }));
    expect(spaced).toBeCloseTo(plain + 3, 5);
    const both = measure.measure(
      'abc',
      style({ horizontalScalePercent: 200, characterSpacingPt: 1 })
    );
    expect(both).toBeCloseTo(plain * 2 + 3, 5);
  });

  test('repeated measurement is cached and stays identical', () => {
    const measure = measurer();
    expect(measure.measure('cached', style())).toBe(measure.measure('cached', style()));
  });

  test('super/subscript advances are EXACTLY three quarters of the baseline advance', () => {
    // Paint draws super/subscript at 0.75 of the run size, so measurement must be 0.75 of
    // the baseline advance — not the advance at the nearest whole half-point. At 11pt the
    // scaled size is 16.5 half-points; shaping at a rounded 17 measured every character 3%
    // wide, which pushed each following span's published x right of its painted glyphs and
    // drew the caret mid-glyph for the rest of the line.
    const measure = measurer();
    const plain = measure.measure('Superscript', style());
    expect(measure.measure('Superscript', style({ verticalAlign: 'superscript' }))).toBeCloseTo(
      plain * 0.75,
      6
    );
    expect(measure.measure('Superscript', style({ verticalAlign: 'subscript' }))).toBeCloseTo(
      plain * 0.75,
      6
    );
  });
});

describe('an unavailable font falls back rather than failing (task 7.7)', () => {
  test('a document naming a font nobody has still lays out', () => {
    const measure = measurer(() => null);
    expect(measure.measure('abc', style())).toBe(fallback.measure('abc', style()));
    expect(measure.lineMetrics(style())).toEqual(fallback.lineMetrics(style()));
  });

  test('a shaper that throws does not take the document down with it', () => {
    const hostile = createShapedMeasurer({
      shaper: {
        shape() {
          throw new Error('refused');
        },
      },
      resolveFont: () => font,
      fallback,
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '15.1',
    });
    expect(hostile.measure('abc', style())).toBe(fallback.measure('abc', style()));
    expect(hostile.lineMetrics(style())).toEqual(fallback.lineMetrics(style()));
  });
});
