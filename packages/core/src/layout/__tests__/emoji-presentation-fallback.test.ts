import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  initializeHarfBuzz,
  harfBuzzFontValidator,
  sha256FontBytes,
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
} from '../index.ts';
import { createShapingEnvironment, type ShapeInput } from '../shaped-run.ts';
import type { LayoutShapingOptions } from '../shaped-measurer.ts';
import { withGlyphFallbacks } from '../glyph-fallback-shaper.ts';
import {
  clusterAsksForEmoji,
  clusterSelectsColorFace,
  continuesEmojiSequence,
} from '../color-font-tables.ts';
import { createGlyphFallbackDemand } from '../../editor/shared-fallback-fonts.ts';

// A text face that maps some emoji characters to monochrome glyphs (DejaVu Sans maps U+2764,
// U+00A9 and U+2615), and a color face (Twemoji Mozilla, COLR) as the glyph fallback.
await initializeHarfBuzz();
const face = (path: string) => new Uint8Array(readFileSync(new URL(path, import.meta.url)));
const faces = {
  Text: face('./fixtures/fonts/DejaVuSans.ttf'),
  Emoji: face('../../../../fonts/assets/TwemojiMozilla.ttf'),
};
const request = (family: string) => ({ family, weight: 400, style: 'normal' as const });
const fonts = createFontResourceSnapshot({
  epoch: 1,
  maxFontBytes: 4_000_000,
  resources: Object.entries(faces).map(([family, bytes]) => ({
    request: request(family),
    id: family,
    bytes,
    hash: sha256FontBytes(bytes),
    faceIndex: 0,
  })),
  validateFont: harfBuzzFontValidator,
});
const text = fonts.resolve(request('Text'));
if (text instanceof FontResolutionError) throw text;
const shaper = createHarfBuzzTextShaper();

function input(value: string, script = 'Latn'): ShapeInput {
  const rtl = script === 'Hebr';
  return {
    text: value,
    fontSizeHalfPoints: 22,
    bidiLevel: rtl ? 1 : 0,
    environment: createShapingEnvironment({
      font: text as Exclude<typeof text, FontResolutionError>,
      variationAxes: {},
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '15.1',
      normalization: 'none',
      script,
      language: rtl ? 'he' : 'en',
      direction: rtl ? 'rtl' : 'ltr',
      features: { kern: 0 },
      fallbackOrder: [],
      fixedPointScale: 1000,
      roundingMode: 'halfAwayFromZero',
    }),
  };
}

/** Each piece of `value` with the family of the face that draws it. */
function faceRuns(value: string, families = ['Emoji'], script = 'Latn'): string[] {
  const fallback = withGlyphFallbacks(
    { fonts, shaper } as LayoutShapingOptions,
    families.map(request)
  ).shaper;
  const run = fallback.shape(input(value, script));
  expect(run.glyphs.some((glyph) => glyph.id === 0)).toBe(false);
  const pieces: string[] = [];
  for (const cluster of [...run.clusters].sort((a, b) => a.textStart - b.textStart)) {
    const family = run.fontSpans[cluster.fontSpan]?.font.request.family ?? 'Text';
    const piece = value.slice(cluster.textStart, cluster.textEnd);
    const last = pieces.at(-1);
    if (last?.endsWith(`:${family}`))
      pieces[pieces.length - 1] = last.replace(/:\w+$/, '') + piece + `:${family}`;
    else pieces.push(`${piece}:${family}`);
  }
  return pieces;
}

describe('emoji presentation (Unicode Technical Standard #51)', () => {
  test('a variation selector decides first; otherwise the default presentation decides', () => {
    expect(clusterAsksForEmoji('❤', '️')).toBe(true);
    expect(clusterAsksForEmoji('❤')).toBe(false);
    expect(clusterAsksForEmoji('❤', '︎')).toBe(false);
    expect(clusterAsksForEmoji('☕')).toBe(true);
    expect(clusterAsksForEmoji('☕', '︎')).toBe(false);
    // The next character is not a selector, so it does not decide.
    expect(clusterAsksForEmoji('❤', '😀')).toBe(false);
    expect(clusterAsksForEmoji('️')).toBe(false);
  });

  test('a digit, # or * asks for emoji only as a keycap', () => {
    expect(clusterAsksForEmoji('1', '️⃣')).toBe(true);
    expect(clusterAsksForEmoji('#', '⃣')).toBe(true);
    expect(clusterAsksForEmoji('1', '️')).toBe(false);
    expect(clusterAsksForEmoji('7')).toBe(false);
  });

  test('a drawn character selects the color face only with U+FE0F above Latin-1, or as a keycap', () => {
    expect(clusterSelectsColorFace('❤', '️')).toBe(true);
    expect(clusterSelectsColorFace('❤️')).toBe(true);
    expect(clusterSelectsColorFace('☕')).toBe(false);
    expect(clusterSelectsColorFace('☕', '︎')).toBe(false);
    expect(clusterSelectsColorFace('©', '️')).toBe(false);
    expect(clusterSelectsColorFace('1', '️⃣')).toBe(true);
    expect(clusterSelectsColorFace('1', '️')).toBe(false);
  });

  test('a joiner, the pictograph after it, a keycap, skin tone or tag continues a sequence', () => {
    expect(continuesEmojiSequence('‍', '❤️')).toBe(true);
    expect(continuesEmojiSequence('🔥', '❤️‍')).toBe(true);
    expect(continuesEmojiSequence('1', '😀‍')).toBe(false);
    expect(continuesEmojiSequence('⃣', '1️')).toBe(true);
    expect(continuesEmojiSequence('\u{1F3FD}', '👍')).toBe(true);
    expect(continuesEmojiSequence('a', '❤️')).toBe(false);
  });
});

describe('a text face that maps an emoji character', () => {
  test('gives a character with U+FE0F to the color face', () => {
    expect(faceRuns('A❤️B')).toEqual(['A:Text', '❤️:Emoji', 'B:Text']);
  });

  test('keeps default and text presentation, and Latin-1 signs, in its own face', () => {
    expect(faceRuns('A❤B ☕ ☕︎ ©️ 1️ 7')).toEqual(['A❤B ☕ ☕︎ ©️ 1️ 7:Text']);
  });

  test('keeps a keycap and a joined sequence whole in the color face', () => {
    expect(faceRuns('a1️⃣b')).toEqual(['a:Text', '1️⃣:Emoji', 'b:Text']);
    expect(faceRuns('a❤️‍🔥b')).toEqual(['a:Text', '❤️‍🔥:Emoji', 'b:Text']);
    expect(faceRuns('a👍\u{1F3FD}b')).toEqual(['a:Text', '👍\u{1F3FD}:Emoji', 'b:Text']);
    expect(faceRuns('a🇵🇱b')).toEqual(['a:Text', '🇵🇱:Emoji', 'b:Text']);
  });

  test('does not pull a character after a lone joiner into the color face', () => {
    expect(faceRuns('x🔥‍1y')).toEqual(['x:Text', '🔥‍:Emoji', '1y:Text']);
  });

  test('keeps the space after an emoji in a Hebrew run in its own face', () => {
    expect(faceRuns('אב❤️ גד', ['Emoji'], 'Hebr')).toEqual(['אב:Text', '❤️:Emoji', ' גד:Text']);
  });

  test('shapes a long chain of joiners in bounded pieces', () => {
    // The text face has no 🔥, so every pictograph falls back; the chain is kept whole only
    // up to a bounded length, so each continuation shapes a short sequence again.
    const chain = '🔥' + '\u200D🔥'.repeat(600);
    const run = withGlyphFallbacks({ fonts, shaper } as LayoutShapingOptions, [
      request('Emoji'),
    ]).shaper.shape(input(`a${chain}b`));
    expect(run.glyphs.some((glyph) => glyph.id === 0)).toBe(false);
    expect(run.fontSpans.length).toBeGreaterThan(20);
  });

  test('keeps its glyph when no color face is held', () => {
    expect(faceRuns('A❤️B', [])).toEqual(['A❤️B:Text']);
  });
});

test('a host that loads faces on demand asks once for the color face alone', () => {
  const asked: boolean[] = [];
  const demand = createGlyphFallbackDemand((held) => asked.push(held));
  const shaping = { fonts, shaper } as LayoutShapingOptions;
  demand.shaping(shaping, true).shaper.shape(input('A❤️B'));
  demand.shaping(shaping, true).shaper.shape(input('C❤️D'));
  expect(demand.families()).toEqual(['Twemoji Mozilla']);
  expect(asked).toHaveLength(1);
  // Text that selects no emoji presentation asks for nothing.
  const quiet = createGlyphFallbackDemand(() => {
    throw new Error('asked');
  });
  quiet.shaping(shaping, true).shaper.shape(input('A❤B ☕ ©️'));
  expect(quiet.families()).toEqual([]);
});
