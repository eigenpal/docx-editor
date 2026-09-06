import { expect, test } from 'bun:test';
import {
  hasEastAsiaSymbolHint,
  hasTimesNewRomanEastAsiaException,
  isEastAsiaHintSymbol,
} from '../east-asia-symbol-hint.ts';
import { applyEastAsiaFontSlots, type FieldAwarePiece } from '../field-pieces.ts';
import { resolveRunStyle } from '../run-style.ts';
import { eastAsiaRunsOfSegments } from '../script-itemization.ts';
import { createFixedMeasurer, layoutSemanticDocument, linesOf } from '../index.ts';
import { readOoxmlPart, type OoxmlProperty } from '@docx-editor.dev/core/store';

const fonts: OoxmlProperty = {
  localName: 'rFonts',
  attributes: { ascii: 'Times New Roman', eastAsia: 'SimSun', hint: 'eastAsia' },
};
function piece(text: string, props: OoxmlProperty[] = [fonts], projected = false): FieldAwarePiece {
  return {
    text,
    props,
    style: resolveRunStyle(props),
    start: 0,
    end: projected ? 1 : text.length,
    ...(projected ? { projected: true } : {}),
  };
}
test('the hint table accepts exactly the unconditional symbols, not accented letters', () => {
  const latin1 = [
    0xa1, 0xa4, 0xa7, 0xa8, 0xaa, 0xad, 0xaf, 0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb6, 0xb7, 0xb8, 0xb9,
    0xba, 0xbc, 0xbd, 0xbe, 0xbf, 0xd7, 0xf7,
  ];
  const inTable = (code: number) =>
    latin1.includes(code) || (code >= 0x2b0 && code <= 0x36f) || (code >= 0x2000 && code <= 0x27bf);
  for (let code = 0; code <= 0x2fff; code++) expect(isEastAsiaHintSymbol(code)).toBe(inTable(code));
  // Private use and the Latin presentation forms, up to the first Hebrew ligature.
  expect(isEastAsiaHintSymbol(0xe000)).toBe(true);
  expect(isEastAsiaHintSymbol(0xf8ff)).toBe(true);
  expect(isEastAsiaHintSymbol(0xfb00)).toBe(true);
  expect(isEastAsiaHintSymbol(0xfb1c)).toBe(true);
  expect(isEastAsiaHintSymbol(0xfb1d)).toBe(false);
  expect(isEastAsiaHintSymbol(0xdfff)).toBe(false);
  expect(isEastAsiaHintSymbol(0xf900)).toBe(false);
  // CJK radicals are strong East Asian text without any hint, so the table leaves them out.
  expect(eastAsiaRunsOfSegments(['⺀'], [false])).toEqual([{ segment: 0, from: 0, to: 1 }]);
});
test('hinted quotes, dashes and enclosed digits resolve the East Asian slot in layout', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const spansOf = (text: string, hint: string) => {
    const parsed = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:rPr>` +
        `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="SimSun"${hint}/>` +
        `</w:rPr><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    const layout = layoutSemanticDocument(parsed.part, 1, { measurer: createFixedMeasurer(6, 14) });
    return linesOf(layout).flatMap((line) => line.spans);
  };
  for (const text of ['“”', '——', '①', '·']) {
    const hinted = spansOf(text, ' w:hint="eastAsia"');
    expect(hinted.map((span) => span.text)).toEqual([text]);
    expect(hinted[0]!.fontSlot).toBe('eastAsia');
    expect(hinted[0]!.style.fontFamily).toBe('Arial');
    const unhinted = spansOf(text, '');
    expect(unhinted[0]!.fontSlot).toBeUndefined();
  }
});
test('the Times New Roman exception needs matching ascii and hAnsi faces', () => {
  const timesNewRoman = (ascii: string, hAnsi: string): OoxmlProperty[] => [
    {
      localName: 'rFonts',
      attributes: { ascii, hAnsi, eastAsia: 'Times New Roman', hint: 'eastAsia' },
    },
  ];
  const distinct = piece('·', timesNewRoman('Arial', 'Calibri'));
  expect(applyEastAsiaFontSlots([distinct])[0]!.fontSlot).toBe('eastAsia');
  const same = piece('·', timesNewRoman('Arial', 'Arial'));
  expect(applyEastAsiaFontSlots([same])[0]).toBe(same);
  expect(
    hasTimesNewRomanEastAsiaException(timesNewRoman('Arial', 'Calibri'), 'Times New Roman')
  ).toBe(false);
  expect(
    hasTimesNewRomanEastAsiaException(timesNewRoman('Arial', 'Arial'), 'Times New Roman')
  ).toBe(true);
  // The face compared is the resolved one; a distinct East Asian face never triggers it.
  expect(hasTimesNewRomanEastAsiaException(timesNewRoman('Arial', 'Arial'), 'SimSun')).toBe(false);
  // Last specified value wins per attribute across the cascade, like the hint itself.
  expect(
    hasTimesNewRomanEastAsiaException(
      [
        ...timesNewRoman('Arial', 'Arial'),
        { localName: 'rFonts', attributes: { hAnsi: 'Calibri' } },
      ],
      'Times New Roman'
    )
  ).toBe(false);
});
test('hinted middle dots keep their East Asian face without changing ASCII or offsets', () => {
  const input = piece('·   · 1×2÷3 20°C'),
    before = JSON.stringify(input);
  const out = applyEastAsiaFontSlots([input]);
  expect(out.map((p) => p.text).join('')).toBe(input.text);
  let offset = 0;
  for (const item of out) {
    expect(item.start).toBe(offset);
    offset = item.end;
    expect(item.style).toBe(input.style);
    expect(item.props).toBe(input.props);
    for (const char of item.text)
      expect(item.fontSlot === 'eastAsia').toBe(isEastAsiaHintSymbol(char.codePointAt(0)!));
  }
  expect(offset).toBe(input.text.length);
  expect(JSON.stringify(input)).toBe(before);
});
test('hint inheritance follows last specified value, not last rFonts element', () => {
  expect(
    hasEastAsiaSymbolHint([fonts, { localName: 'rFonts', attributes: { ascii: 'Arial' } }])
  ).toBe(true);
  expect(
    hasEastAsiaSymbolHint([fonts, { localName: 'rFonts', attributes: { hint: 'default' } }])
  ).toBe(false);
  expect(
    hasEastAsiaSymbolHint([{ localName: 'rFonts', attributes: { hint: 'default' } }, fonts])
  ).toBe(true);
  expect(hasEastAsiaSymbolHint([{ ...fonts, attributes: { hint: 'EastAsia' } }])).toBe(false);
});
test('unhinted Latin symbols and explicitly complex-script runs gain no new slot', () => {
  for (const props of [
    [{ ...fonts, attributes: { ascii: 'Arial', eastAsia: 'SimSun' } }],
    [fonts, { localName: 'rtl' }],
    [fonts, { localName: 'cs', attributes: { val: '1' } }],
  ]) {
    const input = piece('·×÷', props);
    expect(applyEastAsiaFontSlots([input])).toEqual([input]);
  }
  expect(
    hasEastAsiaSymbolHint([
      fonts,
      { localName: 'cs' },
      { localName: 'cs', attributes: { val: '0' } },
    ])
  ).toBe(true);
});
test('projected results retain one model atom; only uniform-symbol projections take the slot', () => {
  const symbol = piece('··', [fonts], true),
    mixed = piece('1·', [fonts], true);
  const out = applyEastAsiaFontSlots([symbol, mixed]);
  expect(out).toHaveLength(2);
  expect(out[0]!.fontSlot).toBe('eastAsia');
  expect(out[0]!.end).toBe(1);
  expect(out[1]).toBe(mixed);
});
test('a hint without a distinct East Asian face leaves the original piece untouched', () => {
  const input = piece('·', [
    { localName: 'rFonts', attributes: { ascii: 'Arial', hint: 'eastAsia' } },
  ]);
  expect(applyEastAsiaFontSlots([input])[0]).toBe(input);
  const fallback = piece('·', [
    {
      localName: 'rFonts',
      attributes: {
        ascii: 'Arial',
        hAnsi: 'Arial',
        eastAsia: 'Times New Roman',
        hint: 'eastAsia',
      },
    },
  ]);
  expect(applyEastAsiaFontSlots([fallback])[0]).toBe(fallback);
});
