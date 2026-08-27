import { describe, expect, test } from 'bun:test';
import {
  UnsupportedScriptError,
  itemizeScriptFontSlots,
  type BidiEmbeddingLevels,
} from '../index.ts';
import { eastAsiaSlotRanges } from '../script-itemization.ts';

const ltr = (text: string): BidiEmbeddingLevels => ({
  paragraphs: [{ from: 0, to: text.length, level: 0 }],
  levels: new Uint8Array(text.length),
});

describe('deterministic script itemization', () => {
  test.each([
    ['देवनागरी', 'Deva'],
    ['বাংলা', 'Beng'],
    ['ไทย', 'Thai'],
    ['ខ្មែរ', 'Khmr'],
  ] as const)(
    '%s uses the exact HarfBuzz script tag and complex-script font slot',
    (text, script) => {
      expect(itemizeScriptFontSlots(text, 0, ltr(text))).toEqual([
        {
          from: 0,
          to: text.length,
          direction: 'ltr',
          bidiLevel: 0,
          script,
          slot: 'cs',
        },
      ]);
    }
  );

  test('rejects an unimplemented strong script before shaping instead of relabeling it Latin', () => {
    expect(() => itemizeScriptFontSlots('ქართული', 0, ltr('ქართული'))).toThrow(
      expect.objectContaining<UnsupportedScriptError>({
        name: 'UnsupportedScriptError',
        code: 'unsupportedScript',
        codePoint: 0x10e5,
      })
    );
  });

  test.each([
    ['Δοκιμή', 'Grek'],
    ['Кириллица', 'Cyrl'],
  ] as const)('%s retains its supported non-Latin HarfBuzz script tag', (text, script) => {
    expect(itemizeScriptFontSlots(text, 0, ltr(text))).toEqual([
      {
        from: 0,
        to: text.length,
        direction: 'ltr',
        bidiLevel: 0,
        script,
        slot: 'hAnsi',
      },
    ]);
  });

  test('all-Common text uses the HarfBuzz Common tag rather than pretending to be Latin', () => {
    const text = '☐ 😀';
    expect(itemizeScriptFontSlots(text, 0, ltr(text))).toEqual([
      {
        from: 0,
        to: text.length,
        direction: 'ltr',
        bidiLevel: 0,
        script: 'Zyyy',
        slot: 'hAnsi',
      },
    ]);
  });

  test('fullwidth Latin stays Latin and splits from adjacent Han at exact boundaries', () => {
    const text = '漢ＡＺ字';
    expect(
      itemizeScriptFontSlots(text, 0, ltr(text)).map(({ from, to, script, slot }) => ({
        text: text.slice(from, to),
        script,
        slot,
      }))
    ).toEqual([
      { text: '漢', script: 'Hani', slot: 'eastAsia' },
      { text: 'ＡＺ', script: 'Latn', slot: 'hAnsi' },
      { text: '字', script: 'Hani', slot: 'eastAsia' },
    ]);
  });

  test('fullwidth Latin boundaries exclude neighboring Common punctuation', () => {
    for (const [text, script, slot] of [
      ['＠', 'Zyyy', 'hAnsi'],
      ['Ａ', 'Latn', 'hAnsi'],
      ['ｚ', 'Latn', 'hAnsi'],
      ['｛', 'Zyyy', 'hAnsi'],
    ] as const) {
      expect(itemizeScriptFontSlots(text, 0, ltr(text))[0]).toMatchObject({ script, slot });
    }
  });

  test('FE2E–FE2F are inherited combining marks, never Cyrillic', () => {
    const inherited = 'A\uFE2E\uFE2F';
    expect(itemizeScriptFontSlots(inherited, 0, ltr(inherited))).toEqual([
      {
        from: 0,
        to: inherited.length,
        direction: 'ltr',
        bidiLevel: 0,
        script: 'Latn',
        slot: 'ascii',
      },
    ]);
    expect(itemizeScriptFontSlots('\uFE2E', 0, ltr('\uFE2E'))[0]).toMatchObject({
      script: 'Zyyy',
      slot: 'hAnsi',
    });
  });

  test('retains Latin, Arabic, Hebrew, and Han split invariance around Common characters', () => {
    const text = 'abc,سلام;עברית。漢字';
    expect(
      itemizeScriptFontSlots(text, 0, ltr(text)).map(({ from, to, script, slot }) => ({
        text: text.slice(from, to),
        script,
        slot,
      }))
    ).toEqual([
      { text: 'abc,', script: 'Latn', slot: 'ascii' },
      { text: 'سلام;', script: 'Arab', slot: 'cs' },
      { text: 'עברית', script: 'Hebr', slot: 'cs' },
      { text: '。漢字', script: 'Hani', slot: 'eastAsia' },
    ]);
  });
});

describe('eastAsiaSlotRanges — the slot-only projection for piece splitting', () => {
  test('mixed CJK and Latin text answers the merged eastAsia ranges in order', () => {
    expect(eastAsiaSlotRanges('甲方shall履行')).toEqual([
      { from: 0, to: 2 },
      { from: 7, to: 9 },
    ]);
  });

  test('Common characters inherit the surrounding strong classification', () => {
    // The comma and space take the preceding CJK answer, so one range covers all four.
    expect(eastAsiaSlotRanges('甲, 方')).toEqual([{ from: 0, to: 4 }]);
    // Leading Common text takes the FOLLOWING strong item, same as itemization.
    expect(eastAsiaSlotRanges('"甲"')).toEqual([{ from: 0, to: 3 }]);
  });

  test('Latin-only text answers no ranges', () => {
    expect(eastAsiaSlotRanges('shall perform')).toEqual([]);
    expect(eastAsiaSlotRanges('')).toEqual([]);
  });

  test('an unsupported script answers [] rather than throwing through layout', () => {
    // U+1C50 OL CHIKI is outside every supported range; the whole text stays in the
    // base slot, which is the pre-slot behaviour.
    expect(() => itemizeScriptFontSlots('᱐甲', 0, ltr('᱐甲'))).toThrow(UnsupportedScriptError);
    expect(eastAsiaSlotRanges('᱐甲')).toEqual([]);
  });

  test('agrees with full itemization on the slot boundary', () => {
    const text = 'A甲B';
    const slots = itemizeScriptFontSlots(text, 0, ltr(text));
    const ranges = eastAsiaSlotRanges(text);
    expect(ranges).toEqual(
      slots.filter((item) => item.slot === 'eastAsia').map(({ from, to }) => ({ from, to }))
    );
  });
});
