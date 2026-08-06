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

  test('hhea lineGap is external leading and does not inflate Word line boxes', () => {
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

    expect(withExternalGap.lineMetrics(style())).toEqual({ height: 11, baseline: 9 });
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
