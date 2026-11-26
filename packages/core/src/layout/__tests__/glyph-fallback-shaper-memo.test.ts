import { expect, test } from 'bun:test';
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
import {
  createShapingEnvironment,
  markFacePreservingShaper,
  preservesShapingFace,
  type ShapeInput,
  type ShapedRun,
  type TextShaper,
} from '../shaped-run.ts';
import type { LayoutShapingOptions } from '../shaped-measurer.ts';
import { withGlyphFallbacks } from '../glyph-fallback-shaper.ts';

await initializeHarfBuzz();
const bytes = new Uint8Array(
  readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const request = (family: string) => ({ family, weight: 400, style: 'normal' as const });
const fonts = createFontResourceSnapshot({
  epoch: 1,
  maxFontBytes: 2_000_000,
  resources: ['A', 'B'].map((family) => ({
    request: request(family),
    id: family,
    bytes,
    hash: sha256FontBytes(bytes),
    faceIndex: 0,
  })),
  validateFont: harfBuzzFontValidator,
});
const primary = fonts.resolve(request('A'));
if (primary instanceof FontResolutionError) throw primary;
const actual = createHarfBuzzTextShaper();
const environment = createShapingEnvironment({
  font: primary,
  variationAxes: {},
  shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
  unicodeDataVersion: '15.1',
  normalization: 'none',
  script: 'Latn',
  language: 'en',
  direction: 'ltr',
  features: { kern: 0 },
  fallbackOrder: [],
  fixedPointScale: 1000,
  roundingMode: 'halfAwayFromZero',
});
const input = (text: string): ShapeInput => ({
  text,
  fontSizeHalfPoints: 22,
  bidiLevel: 0,
  environment,
});

/** A face that covers only the letter named by its family, as in the cluster-fallback test. */
function coverageShaper(keyOf: (input: ShapeInput) => string): {
  shaper: TextShaper;
  calls: () => number;
} {
  let calls = 0;
  const runs = new Map<string, ShapedRun>();
  return {
    calls: () => calls,
    shaper: {
      shape(input) {
        calls += 1;
        const key = keyOf(input);
        let run = runs.get(key);
        if (!run) {
          const result = actual.shape(input);
          run = {
            ...result,
            glyphs: result.glyphs.map((glyph) => ({
              ...glyph,
              id:
                input.text[glyph.cluster] === input.environment.font.request.family ? glyph.id : 0,
            })),
          };
          runs.set(key, run);
        }
        return run;
      },
    },
  };
}

test('a caching base shaper runs the fallback chain once per distinct input', () => {
  const base = coverageShaper((input) => `${input.environment.font.id}|${input.text}`);
  const fallback = withGlyphFallbacks({ fonts, shaper: base.shaper } as LayoutShapingOptions, [
    request('B'),
  ]).shaper;
  const first = fallback.shape(input('AB'));
  const callsAfterFirst = base.calls();
  expect(callsAfterFirst).toBeGreaterThan(1);
  expect(fallback.shape(input('AB'))).toBe(first);
  expect(base.calls()).toBe(callsAfterFirst + 1);
});

test('a base shaper that reuses one run for unequal inputs still gets each chain run', () => {
  // Keyed by face alone, so "AB" and "BA" come back as the same base run object.
  const base = coverageShaper((input) => input.environment.font.id);
  const fallback = withGlyphFallbacks({ fonts, shaper: base.shaper } as LayoutShapingOptions, [
    request('B'),
  ]).shaper;
  fallback.shape(input('AB'));
  const callsAfterFirst = base.calls();
  fallback.shape(input('BA'));
  // The chain ran again: more than the one base call a memo hit would make.
  expect(base.calls()).toBeGreaterThan(callsAfterFirst + 1);
});

test('the memo answers only an input equal in every field', () => {
  // Keyed by face alone, so each call below gets the same base run object.
  const base = coverageShaper((input) => input.environment.font.id);
  const fallback = withGlyphFallbacks({ fonts, shaper: base.shaper } as LayoutShapingOptions, [
    request('B'),
  ]).shaper;
  const german = createShapingEnvironment({ ...environment, language: 'de' });
  const variants: ShapeInput[] = [
    input('AB'),
    { ...input('AB'), fontSizeHalfPoints: 24 },
    // Equal to the call before it in all but the environment.
    { ...input('AB'), fontSizeHalfPoints: 24, environment: german },
  ];
  for (const variant of variants) {
    const before = base.calls();
    fallback.shape(variant);
    // A memo hit makes exactly one base call; the chain makes more.
    expect(base.calls()).toBeGreaterThan(before + 1);
  }
});

test('a run that no admitted face covers reports its uncovered characters', () => {
  const base = coverageShaper((input) => `${input.environment.font.id}|${input.text}`);
  const uncovered: string[] = [];
  const fallback = withGlyphFallbacks(
    { fonts, shaper: base.shaper } as LayoutShapingOptions,
    [request('B')],
    { onUncovered: (characters) => uncovered.push(characters) }
  ).shaper;
  // Covered through the fallback face: nothing to report.
  fallback.shape(input('AB'));
  expect(uncovered).toEqual([]);
  // No face covers "C". The whole run stays in its own face, and "B" is uncovered there too.
  fallback.shape(input('ABC'));
  expect(uncovered).toEqual(['BC']);
});

test('with no fallback face held, the shaper reports and keeps the face of each run', () => {
  const base = markFacePreservingShaper(
    coverageShaper((input) => `${input.environment.font.id}|${input.text}`).shaper
  );
  const uncovered: string[] = [];
  const shaping = withGlyphFallbacks(
    { fonts, shaper: base } as LayoutShapingOptions,
    [request('Missing')],
    { onUncovered: (characters) => uncovered.push(characters) }
  );
  expect(preservesShapingFace(shaping.shaper)).toBe(true);
  expect(shaping.shaper.shape(input('AB')).glyphs.some((glyph) => glyph.id === 0)).toBe(true);
  expect(uncovered).toEqual(['B']);
});

test('no fallback face and no listener leaves the shaping as it is', () => {
  const shaping = { fonts, shaper: actual } as LayoutShapingOptions;
  expect(withGlyphFallbacks(shaping, [])).toBe(shaping);
});
