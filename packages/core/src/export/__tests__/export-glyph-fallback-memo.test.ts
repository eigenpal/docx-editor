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
} from '../../layout/index.ts';
import {
  createShapingEnvironment,
  type ShapeInput,
  type ShapedRun,
  type TextShaper,
} from '../../layout/shaped-run.ts';
import type { LayoutShapingOptions } from '../../layout/shaped-measurer.ts';
import { withExportGlyphFallbacks } from '../export-glyph-fallback.ts';

await initializeHarfBuzz();
const bytes = new Uint8Array(
  readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
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
  const fallback = withExportGlyphFallbacks(
    { fonts, shaper: base.shaper } as LayoutShapingOptions,
    [request('B')]
  ).shaper;
  const first = fallback.shape(input('AB'));
  const callsAfterFirst = base.calls();
  expect(callsAfterFirst).toBeGreaterThan(1);
  expect(fallback.shape(input('AB'))).toBe(first);
  expect(base.calls()).toBe(callsAfterFirst + 1);
});

test('a base shaper that reuses one run for unequal inputs still gets each chain run', () => {
  // Keyed by face alone, so "AB" and "BA" come back as the same base run object.
  const base = coverageShaper((input) => input.environment.font.id);
  const fallback = withExportGlyphFallbacks(
    { fonts, shaper: base.shaper } as LayoutShapingOptions,
    [request('B')]
  ).shaper;
  fallback.shape(input('AB'));
  const callsAfterFirst = base.calls();
  fallback.shape(input('BA'));
  // The chain ran again: more than the one base call a memo hit would make.
  expect(base.calls()).toBeGreaterThan(callsAfterFirst + 1);
});
