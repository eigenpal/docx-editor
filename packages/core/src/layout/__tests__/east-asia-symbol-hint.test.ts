import { expect, test } from 'bun:test';
import { hasEastAsiaSymbolHint, isEastAsiaHintSymbol } from '../east-asia-symbol-hint.ts';
import { applyEastAsiaFontSlots, type FieldAwarePiece } from '../field-pieces.ts';
import { resolveRunStyle } from '../run-style.ts';
import type { OoxmlProperty } from '@docx-editor.dev/core/store';

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
test('the Latin-1 hint table accepts exactly the unconditional symbols, not accented letters', () => {
  const expected = [
    0xa1, 0xa4, 0xa7, 0xa8, 0xaa, 0xad, 0xaf, 0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb6, 0xb7, 0xb8, 0xb9,
    0xba, 0xbc, 0xbd, 0xbe, 0xbf, 0xd7, 0xf7,
  ];
  for (let code = 0; code <= 0x2ff; code++)
    expect(isEastAsiaHintSymbol(code)).toBe(expected.includes(code));
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
