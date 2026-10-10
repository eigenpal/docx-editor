import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  createFontResourceSnapshot,
  FontResolutionError,
  sha256FontBytes,
} from '../font-resource.ts';
import {
  createHarfBuzzTextShaper,
  HARFBUZZ_SHAPING_LIBRARY,
  initializeHarfBuzz,
  harfBuzzFontValidator,
} from '../harfbuzz-shaper.ts';
import { createShapedMeasurer } from '../shaped-measurer.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';

await initializeHarfBuzz();

function measurer(codePageBit: number, gap = 0, ascent = 1760) {
  const bytes = new Uint8Array(
    readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < view.getUint16(4); index++) {
    const record = 12 + index * 16;
    const offset = view.getUint32(record + 8);
    if (view.getUint32(record) === 0x68686561) {
      view.setInt16(offset + 4, ascent);
      view.setInt16(offset + 6, -288);
      view.setInt16(offset + 8, gap);
    }
    if (view.getUint32(record) === 0x4f532f32) {
      view.setUint16(offset, 1);
      view.setUint16(offset + 62, 0); // Do not prefer typo metrics.
      view.setUint32(offset + 78, 1 << codePageBit);
    }
  }
  const request = { family: 'Metric Fixture', weight: 400, style: 'normal' as const };
  const snapshot = createFontResourceSnapshot({
    epoch: 0,
    maxFontBytes: 2_000_000,
    validateFont: harfBuzzFontValidator,
    resources: [{ id: 'metrics', request, bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
  });
  const font = snapshot.resolve(request);
  if (font instanceof FontResolutionError) throw font;
  return createShapedMeasurer({
    shaper: createHarfBuzzTextShaper(),
    resolveFont: () => font,
    fallback: createFixedMeasurer(),
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '15.1',
  });
}

test.each([17, 18, 19, 20])(
  'one-em CJK faces reserve symmetric leading (code page bit %s)',
  (bit) => {
    const measure = measurer(bit);
    for (const size of [10, 11, 18]) {
      const style = { ...DEFAULT_RUN_STYLE, fontSizePt: size };
      const metrics = measure.lineMetrics(style);
      expect(metrics.height).toBeCloseTo(size * 1.3, 2);
      expect(metrics.baseline).toBeCloseTo(size * (1760 / 2048 + 0.15), 2);
      expect(measure.lineMetrics(style)).toEqual(metrics);
      const script = measure.lineMetrics({ ...style, verticalAlign: 'superscript' });
      expect(script.height).toBeCloseTo(metrics.height * 0.65, 3);
    }
  }
);

test.each([0, 16, 21, 31])('other code pages do not add CJK leading (bit %s)', (bit) => {
  expect(measurer(bit).lineMetrics({ ...DEFAULT_RUN_STYLE, fontSizePt: 11 }).height).toBeCloseTo(
    11,
    3
  );
});

test('CJK faces with an existing gap or taller face box keep those metrics', () => {
  expect(
    measurer(17, 128).lineMetrics({ ...DEFAULT_RUN_STYLE, fontSizePt: 11 }).height
  ).toBeCloseTo((11 * 2176) / 2048, 2);
  expect(
    measurer(17, 0, 2304).lineMetrics({ ...DEFAULT_RUN_STYLE, fontSizePt: 11 }).height
  ).toBeCloseTo((11 * 2592) / 2048, 2);
});
