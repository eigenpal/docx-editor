// The East Asian font the document defaults name counts as a Chinese, Japanese, or Korean face
// by the face that draws it: a face that resolves as itself decides by its CJK code pages,
// whatever its name or the font table's `w:charset`. A face that does not resolve keeps the
// name lists, the families this project's font packages serve, and the font table. The legacy space rule shows the answer: in mode 14 with
// punctuation compression, spaces shrink only when the defaults name an East Asian face.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { loadFixture, measurer, type FixtureOptions } from './punctuation-kerning-fixture.ts';
import type { TextMeasurer } from '../semantic-records.ts';
import type { ResolvedRunStyle } from '../run-style.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
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

await initializeHarfBuzz();

// Every character is 24 pt in a face with no known average width, so a space gives up a fifth.
// Six words and their spaces take 432 pt; the seventh word joins at 452 pt only by shrinking.
const WORDS = 'aa aa aa aa aa aa aa aa';
const SEVEN = 'aa aa aa aa aa aa aa ';
const SIX = 'aa aa aa aa aa aa ';

/** The fixture measurer, answering for the faces the host resolves. */
const resolving = (faces: Record<string, boolean>): TextMeasurer => ({
  ...measurer,
  eastAsianFace: (style: ResolvedRunStyle) =>
    style.fontFamily !== null && Object.hasOwn(faces, style.fontFamily)
      ? faces[style.fontFamily]
      : undefined,
});
const firstLine = (options: FixtureOptions) =>
  loadFixture({
    text: WORDS,
    available: 452,
    language: 'ja-JP',
    compatibility: 14,
    compression: 'compressPunctuation',
    paragraphProperties: '<w:jc w:val="left"/>',
    ...options,
  })
    .lines[0]!.spans.map((span) => span.text)
    .join('');

describe('the document defaults name an East Asian face', () => {
  test('a CJK face on no name list counts when it resolves', () => {
    expect(firstLine({ defaultFace: 'Fooming Sans' })).toBe(SIX);
    expect(
      firstLine({
        defaultFace: 'Fooming Sans',
        measurer: resolving({ 'Fooming Sans': true }),
      })
    ).toBe(SEVEN);
  });

  test('a face without CJK code pages does not count, even with an East Asian charset', () => {
    const fontTableEntry = { name: 'Lucida Sans Unicode', charset: '80' };
    expect(firstLine({ defaultFace: 'Lucida Sans Unicode', fontTableEntry })).toBe(SEVEN);
    expect(
      firstLine({
        defaultFace: 'Lucida Sans Unicode',
        fontTableEntry,
        measurer: resolving({ 'Lucida Sans Unicode': false }),
      })
    ).toBe(SIX);
  });

  test('a face that does not resolve keeps the name lists and the font table', () => {
    const none = resolving({});
    expect(firstLine({ defaultFace: 'Fooming Sans', measurer: none })).toBe(SIX);
    expect(firstLine({ defaultFace: 'Noto Sans CJK SC', measurer: none })).toBe(SIX);
    // A family this project's font packages serve counts by its name, so hosts with and
    // without the package agree.
    expect(firstLine({ defaultFace: 'Noto Sans CJK JP', measurer: none })).toBe(SEVEN);
    expect(firstLine({ defaultFace: 'Noto Sans JP', measurer: none })).toBe(SEVEN);
    expect(firstLine({ defaultFace: 'Yu Mincho', measurer: none })).toBe(SEVEN);
    expect(
      firstLine({
        defaultFace: 'Fooming Mincho',
        fontTableEntry: { name: 'Fooming Mincho', charset: '80' },
        measurer: none,
      })
    ).toBe(SEVEN);
  });

  test('the resolved face decides hanging punctuation in a justified paragraph too', () => {
    // A 168 pt word, then a period that overflows a 180 pt line: the period hangs only beside
    // an East Asian default face.
    const word = (faces: Record<string, boolean>) =>
      loadFixture({
        text: 'abcdefg. hi',
        available: 180,
        language: 'ja-JP',
        compatibility: 15,
        compression: 'compressPunctuation',
        paragraphProperties: '<w:jc w:val="both"/>',
        defaultFace: 'Fooming Sans',
        measurer: resolving(faces),
      })
        .lines[0]!.spans.map((span) => span.text)
        .join('');
    expect(word({ 'Fooming Sans': true })).toBe('abcdefg. ');
    expect(word({ 'Fooming Sans': false })).toBe('abcdefg');
  });
});

describe('the shaped measurer answers from the resolved face', () => {
  const FIXTURE = { family: 'Metric Fixture', weight: 400, style: 'normal' as const };
  const STAND_IN = { family: 'Missing CJK Family', weight: 400, style: 'normal' as const };
  function shaped(codePageBit: number) {
    const bytes = new Uint8Array(
      readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
    );
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < view.getUint16(4); index++) {
      const record = 12 + index * 16;
      if (view.getUint32(record) !== 0x4f532f32) continue;
      const offset = view.getUint32(record + 8);
      view.setUint16(offset, 1);
      view.setUint32(offset + 78, 1 << codePageBit);
    }
    const snapshot = createFontResourceSnapshot({
      epoch: 0,
      maxFontBytes: 2_000_000,
      validateFont: harfBuzzFontValidator,
      resources: [
        { id: 'metrics', request: FIXTURE, bytes, hash: sha256FontBytes(bytes), faceIndex: 0 },
      ],
      substitutions: [{ from: STAND_IN, to: FIXTURE }],
    });
    return createShapedMeasurer({
      shaper: createHarfBuzzTextShaper(),
      resolveFont: (style) => {
        const font = snapshot.resolve({ ...FIXTURE, family: style.fontFamily ?? FIXTURE.family });
        return font instanceof FontResolutionError ? null : font;
      },
      fallback: createFixedMeasurer(),
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '15.1',
    });
  }
  const style = (family: string) => ({ ...DEFAULT_RUN_STYLE, fontFamily: family });

  test('a face that lists a CJK code page is one', () => {
    for (const bit of [17, 18, 19, 20])
      expect(shaped(bit).eastAsianFace!(style('Metric Fixture'))).toBe(true);
  });

  test('a face without CJK code pages is not one', () => {
    expect(shaped(0).eastAsianFace!(style('Metric Fixture'))).toBe(false);
  });

  test('a stand-in for a missing family cannot tell', () => {
    expect(shaped(17).eastAsianFace!(style('Missing CJK Family'))).toBeUndefined();
    expect(shaped(17).eastAsianFace!(style('Unknown Family'))).toBeUndefined();
  });
});
