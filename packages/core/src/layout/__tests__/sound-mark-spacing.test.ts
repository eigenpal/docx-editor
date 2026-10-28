// The combining kana sound marks U+3099 and U+309A follow their face. A face that classes the
// mark glyph as a mark joins it with the kana before it, in one cell. A face that leaves it
// unclassed with an advance draws it in a cell of its own, beside an uncomposed base. Both test
// faces give every glyph a 1000-unit advance on a 1000-unit em.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFixedMeasurer,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapedMeasurer,
  createShapingEnvironment,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
} from '../index.ts';
import { loadFixture } from './punctuation-kerning-fixture.ts';

await initializeHarfBuzz();

const shaper = createHarfBuzzTextShaper();
function face(file: string) {
  const bytes = new Uint8Array(readFileSync(new URL(`./fixtures/fonts/${file}`, import.meta.url)));
  const request = { family: file, weight: 400, style: 'normal' } as const;
  const resolved = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 100_000,
    resources: [{ request, id: file, bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
    validateFont: harfBuzzFontValidator,
  }).resolve(request);
  if (resolved instanceof FontResolutionError) throw resolved;
  return resolved;
}
const spacing = face('sound-mark-spacing.ttf');
const joining = face('sound-mark-joining.ttf');

/** Glyph ids and advances of `text` at 24 pt, in points. */
function shape(font: typeof spacing, text: string, before = '', after = '') {
  const run = shaper.shape({
    text,
    fontSizeHalfPoints: 48,
    bidiLevel: 0,
    context: { before, after },
    environment: createShapingEnvironment({
      font,
      variationAxes: {},
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '16.0.0',
      normalization: 'none',
      script: 'Hira',
      language: 'ja',
      direction: 'ltr',
      features: {},
      fallbackOrder: [],
      fixedPointScale: 64,
      roundingMode: 'halfAwayFromZero',
    }),
  });
  return run.glyphs.map((glyph) => ({ id: glyph.id, advance: glyph.advanceX / 64 }));
}
// Glyph ids follow the build order: space あ か が は ぱ 国, then U+3099 U+309A U+309B U+309C.
const HIRAGANA_A = 2;
const KA = 3;
const GA = 4;
const VOICED = 8;

function measurer(font: typeof spacing) {
  return createShapedMeasurer({
    shaper,
    resolveFont: () => font,
    fallback: createFixedMeasurer(),
    environment: {
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '16.0.0',
      documentLigatures: false,
      script: 'Hira',
      language: 'ja',
      variationAxes: {},
      features: {},
      normalization: 'none',
      fixedPointScale: 64,
      roundingMode: 'halfAwayFromZero',
    },
  });
}
const texts = (result: ReturnType<typeof loadFixture>) =>
  result.lines.map((line) => line.spans.map((span) => span.text).join(''));
const A = 'あ'.repeat(18);

describe('a face that leaves the sound mark unclassed draws it in its own cell', () => {
  test('the base stays uncomposed and the mark keeps its advance', () => {
    expect(shape(spacing, 'があ')).toEqual([
      { id: KA, advance: 24 },
      { id: VOICED, advance: 24 },
      { id: HIRAGANA_A, advance: 24 },
    ]);
    expect(shape(spacing, '゙', 'か')).toEqual([{ id: VOICED, advance: 24 }]);
    expect(shape(spacing, '゚').map((glyph) => glyph.advance)).toEqual([24]);
  });

  test('the base and the mark move to the next line together', () => {
    for (const split of [undefined, 19]) {
      const result = loadFixture({
        text: A + 'があいう',
        available: 456,
        measurer: measurer(spacing),
        ...(split === undefined ? {} : { split }),
      });
      expect(texts(result)).toEqual([A, 'があいう']);
      // The mark paints as a span of its own, one cell after its base.
      const spans = result.lines[1]!.spans;
      const mark = spans.find((span) => span.text === '゙')!;
      expect(mark.box.x - spans[0]!.box.x).toBeCloseTo(24, 6);
      expect(mark.box.width).toBeCloseTo(24, 6);
    }
  });
});

describe('a face that classes the sound mark as a mark joins it with its base', () => {
  test('a base and a mark in one string compose and take one cell', () => {
    expect(shape(joining, 'があ')).toEqual([
      { id: GA, advance: 24 },
      { id: HIRAGANA_A, advance: 24 },
    ]);
    expect(shape(joining, '゙', 'か')).toEqual([{ id: VOICED, advance: 0 }]);
  });

  test('a mark in its own run adds no width and paints over its base', () => {
    const result = loadFixture({
      text: A + 'があいう',
      available: 456,
      measurer: measurer(joining),
      split: 19,
    });
    expect(texts(result)).toEqual([A + 'が', 'あいう']);
    const spans = result.lines[0]!.spans;
    const mark = spans.find((span) => span.text === '゙')!;
    expect(mark.box.width).toBe(0);
    expect(mark.box.x - spans[0]!.box.x).toBeCloseTo(456, 6);
    expect(mark.glyphOffsetPt).toBeCloseTo(-24, 6);
  });

  test('a mark in the same run as its base needs no offset', () => {
    const result = loadFixture({
      text: A + 'があいう',
      available: 456,
      measurer: measurer(joining),
    });
    expect(texts(result)).toEqual([A + 'が', 'あいう']);
    expect(result.lines[0]!.spans.every((span) => span.glyphOffsetPt === undefined)).toBe(true);
  });
});
