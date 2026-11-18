// The shaped-width cache: every style input of an advance has its own entries, and a repeated
// probe of one style object builds no key.

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
      { request: REQUEST, id: 'dejavu-400', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 },
    ],
    validateFont: harfBuzzFontValidator,
  });
  const result = snapshot.resolve(REQUEST);
  if (result instanceof FontResolutionError) throw result;
  return result;
}

const font = resolvedFixture();
const fallback = createFixedMeasurer(6, 14);

const measurer = () =>
  createShapedMeasurer({
    shaper: createHarfBuzzTextShaper(),
    resolveFont: () => font,
    fallback,
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '15.1',
  });

const style = (overrides: Partial<ResolvedRunStyle> = {}): ResolvedRunStyle => ({
  ...DEFAULT_RUN_STYLE,
  fontSizePt: 11,
  ...overrides,
});

/** A style that counts reads of its fields, to show that no cache key is built from them. */
const counted = (overrides: Partial<ResolvedRunStyle> = {}) => {
  const reads = new Map<string, number>();
  const proxy = new Proxy(style(overrides), {
    get(target, key, receiver) {
      if (typeof key === 'string') reads.set(key, (reads.get(key) ?? 0) + 1);
      return Reflect.get(target, key, receiver);
    },
  });
  return { style: proxy, reads };
};

const KEY_FIELDS = ['fontFamily', 'ligatures', 'kerningMinPt', 'kerningEnabled', 'bold'];

describe('the shaped-width cache keys every input of the advance', () => {
  const counting = () => {
    const counts = { shaped: 0, resolved: 0 };
    const m = createShapedMeasurer({
      shaper: {
        shape(input) {
          counts.shaped += 1;
          return {
            text: input.text,
            direction: 'ltr',
            bidiLevel: 0,
            glyphs: [
              {
                id: 1,
                cluster: 0,
                originX: 0,
                originY: 0,
                advanceX: 1_000 * counts.shaped,
                advanceY: 0,
                offsetX: 0,
                offsetY: 0,
                outline: { path: '', unitsPerEm: 1_000 },
              },
            ],
            clusters: [],
            fontSpans: [],
            metrics: { ascent: 9_000, descent: 2_000, lineGap: 0 },
          };
        },
      },
      resolveFont: () => {
        counts.resolved += 1;
        return font;
      },
      fallback,
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '15.1',
      fixedPointScale: 1_000,
    });
    return { m, counts };
  };

  test('repeated probes of one style shape once, and equal styles share the width', () => {
    const { m, counts } = counting();
    const one = style();
    const width = m.measure('word', one);
    for (let probe = 0; probe < 50; probe += 1) expect(m.measure('word', one)).toBe(width);
    expect(counts.shaped).toBe(1);
    expect(counts.resolved).toBe(1);
    // A second style object with the same values reads the entry the first one wrote.
    expect(m.measure('word', style())).toBe(width);
    expect(counts.shaped).toBe(1);
  });

  test('each style input of the advance has its own entries', () => {
    const { m, counts } = counting();
    const shaping = { script: 'Latn', direction: 'ltr', level: 0, baseLevel: 0 } as const;
    const variants: ResolvedRunStyle[] = [
      style(),
      style({ fontSizePt: 12 }),
      style({ kerningMinPt: 1 }),
      style({ bold: true }),
      style({ bold: true, kerningMinPt: 1 }),
      style({ smallCaps: true }),
      style({
        ligatures: { standard: true, contextual: false, historical: false, discretionary: false },
      }),
      style({ shaping }),
      style({ shaping: { ...shaping, script: 'Arab' } }),
      style({ shaping: { ...shaping, direction: 'rtl' } }),
      style({ shaping: { ...shaping, context: { before: 'a', after: '' } } }),
      style({ shaping: { ...shaping, context: { before: '', after: 'a' } } }),
    ];
    const widths = variants.map((variant) => m.measure('word', variant));
    // One shaped run for each variant, and one more for the small caps probe of the face.
    const shapedOnce = counts.shaped;
    expect(shapedOnce).toBe(variants.length + 1);
    // Every variant answers again from its own entry.
    expect(variants.map((variant) => m.measure('word', variant))).toEqual(widths);
    expect(counts.shaped).toBe(shapedOnce);
  });

  test('text that spells a context key cannot read a context entry', () => {
    const { m, counts } = counting();
    const shaping = { script: 'Latn', direction: 'ltr', level: 0, baseLevel: 0 } as const;
    const withContext = style({ shaping: { ...shaping, context: { before: 'b', after: 'c' } } });
    const contextWidth = m.measure('a', withContext);
    const forged = JSON.stringify(['a', 'b', 'c']);
    expect(m.measure(forged, style({ shaping }))).not.toBe(contextWidth);
    expect(m.measure(forged, style())).not.toBe(contextWidth);
    expect(counts.shaped).toBe(3);
    expect(m.measure('a', withContext)).toBe(contextWidth);
    expect(counts.shaped).toBe(3);
  });

  test('measure builds no width key after the first probe of a style', () => {
    const m = measurer();
    const { style: probed, reads } = counted();
    const widths = ['one', 'two', 'three'].map((word) => m.measure(word, probed));
    reads.clear();
    for (let pass = 0; pass < 20; pass += 1)
      expect(['one', 'two', 'three'].map((word) => m.measure(word, probed))).toEqual(widths);
    for (const field of KEY_FIELDS) expect(reads.get(field) ?? 0).toBe(0);
    // The same values through a plain style object give the same widths.
    expect(['one', 'two', 'three'].map((word) => m.measure(word, style()))).toEqual(widths);
  });
});
