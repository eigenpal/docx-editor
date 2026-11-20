// Line metrics of a run style: line breaking asks for each word of a run, so the answer for
// one style object under one face is read without building the cache key again.

import { expect, test } from 'bun:test';
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
import { createShapedLineMetrics, type LineMetricsSlot } from '../shaped-line-metrics.ts';
import type { LayoutShapingEnvironment } from '../layout-run-shape.ts';

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

test('line metrics compare no family name after the first answer for a style', () => {
  const m = measurer();
  const { style: probed, reads } = counted({ fontFamily: 'DejaVu Sans' });
  const first = m.lineMetrics(probed, 'word');
  reads.clear();
  for (let pass = 0; pass < 20; pass += 1) expect(m.lineMetrics(probed, 'word')).toEqual(first);
  expect(reads.get('fontFamily') ?? 0).toBe(0);
  expect(m.lineMetrics(style({ fontFamily: 'DejaVu Sans' }), 'word')).toEqual(first);
  // A size change is a different style object and gets its own answer.
  const larger = m.lineMetrics(style({ fontFamily: 'DejaVu Sans', fontSizePt: 22 }), 'word');
  expect(larger.height).toBeCloseTo(first.height * 2, 2);
});

test('a superscript style scales the kept base answer on every call', () => {
  const m = measurer();
  const base = m.lineMetrics(style({ fontFamily: 'DejaVu Sans' }), 'word');
  const raised = style({ fontFamily: 'DejaVu Sans', verticalAlign: 'superscript' });
  const first = m.lineMetrics(raised, 'word');
  expect(first.height).toBeLessThan(base.height);
  for (let pass = 0; pass < 5; pass += 1) expect(m.lineMetrics(raised, 'word')).toEqual(first);
  // The base-size answer stays as it was: the scaled answer is a new record.
  expect(m.lineMetrics(style({ fontFamily: 'DejaVu Sans' }), 'word')).toEqual(base);
});

test('an answer from the fallback measurer is asked for again on every call', () => {
  let fallbackCalls = 0;
  const failing = createShapedMeasurer({
    shaper: {
      shape() {
        throw new Error('this shaper cannot shape');
      },
    },
    resolveFont: () => font,
    fallback: {
      ...fallback,
      lineMetrics: (runStyle, text) => {
        fallbackCalls += 1;
        return fallback.lineMetrics(runStyle, text);
      },
    },
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '15.1',
  });
  const one = style({ fontFamily: 'DejaVu Sans' });
  const first = failing.lineMetrics(one, 'word');
  expect(first).toEqual(fallback.lineMetrics(one));
  const callsForOne = fallbackCalls;
  expect(callsForOne).toBeGreaterThan(0);
  // A fallback answer is at the drawn size and is not kept, so each call asks again.
  expect(failing.lineMetrics(one, 'word')).toEqual(first);
  expect(fallbackCalls).toBe(callsForOne * 2);
});

const ENVIRONMENT: LayoutShapingEnvironment = {
  shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
  unicodeDataVersion: '15.1',
  script: 'Latn',
  fixedPointScale: 1000,
  normalization: 'none',
  features: {},
  roundingMode: 'halfToEven',
  language: 'en',
  variationAxes: {},
};

test('a slot passed with another style is filled again, not read', () => {
  const lineMetricsOf = createShapedLineMetrics(
    createHarfBuzzTextShaper(),
    ENVIRONMENT,
    fallback,
    4,
    0.5
  );
  const slot: LineMetricsSlot = {};
  const small = style({ fontFamily: 'DejaVu Sans' });
  const large = style({ fontFamily: 'DejaVu Sans', fontSizePt: 22 });
  const first = lineMetricsOf(font, small, slot);
  expect(slot.lineStyle).toBe(small);
  // The same face and another size: the kept answer belongs to the first style only.
  const second = lineMetricsOf(font, large, slot);
  expect(second.height).toBeCloseTo(first.height * 2, 2);
  expect(slot.lineStyle).toBe(large);
  expect(lineMetricsOf(font, small, slot)).toEqual(first);
});
