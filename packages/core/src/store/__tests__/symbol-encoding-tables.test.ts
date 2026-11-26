// Each symbol face maps its bytes through its own table: Webdings and Wingdings 3 do not share
// the Wingdings and Wingdings 2 encodings.

import { expect, test } from 'bun:test';
import { mapSymbolPuaText, symbolFaceByteOf } from '../package/symbol-encoding.ts';

const pua = (byte: number) => String.fromCodePoint(0xf000 + byte);

test.each([
  ['Webdings', 0x31, '\u{1f5d6}'],
  ['Webdings', 0x72, '\u{1f5d9}'],
  ['Wingdings 2', 0x35, '▢'],
  ['Wingdings 2', 0xa3, '□'],
  ['Wingdings 2', 0x52, '☑'],
  ['Wingdings 2', 0xa7, '▣'],
  ['Wingdings 2', 0xb7, '◆'],
  ['Wingdings 3', 0xa7, '⬅'],
  ['Wingdings', 0xa8, '◻'],
  ['Wingdings', 0xfe, '☑'],
])('%s byte %d maps to the glyph the face draws', (font, byte, expected) => {
  expect(mapSymbolPuaText(pua(byte), font)).toBe(expected);
});

test('a byte a face does not list keeps its private-use code', () => {
  expect(mapSymbolPuaText(pua(0x6c), 'Webdings')).toBe(pua(0x6c));
  expect(mapSymbolPuaText(pua(0xb7), 'Wingdings 3')).toBe(pua(0xb7));
});

test('an available face draws its own glyph', () => {
  expect(mapSymbolPuaText(pua(0x31), 'Webdings', () => true)).toBe(pua(0x31));
});

test.each([
  [0x2d, '\u2212'], // minus: the dash bullet
  [0x61, '\u03b1'], // alpha
  [0x6d, '\u03bc'], // mu: the Greek letter, not the micro sign
  [0x44, '\u0394'], // Delta: the Greek letter, not the increment sign
  [0x57, '\u03a9'], // Omega: the Greek letter, not the ohm sign
  [0xb1, '\u00b1'], // plusminus
  [0xb3, '\u2265'], // greaterequal
  [0xa5, '\u221e'], // infinity
  [0xe5, '\u2211'], // summation
  [0xac, '\u2190'], // arrowleft
  [0xe0, '\u25ca'], // lozenge
  [0x2a, '\u2217'], // asteriskmath
  [0x33, '3'], // the digits draw as digits
])('Symbol byte %d maps to the glyph the face names', (byte, expected) => {
  expect(mapSymbolPuaText(pua(byte), 'Symbol')).toBe(expected);
});

test('Symbol bytes without an exact, invertible twin keep their private-use code', () => {
  // Space, the euro sign (no glyph in the face), extension pieces, serif and sans signs,
  // and the two Latin-1 twins that are also bare bytes of other glyphs.
  for (const byte of [0x20, 0xa0, 0x60, 0xbd, 0xbe, 0xd2, 0xe2, 0xe6, 0xf4, 0xfe, 0xb8, 0xd8]) {
    expect(mapSymbolPuaText(pua(byte), 'Symbol')).toBe(pua(byte));
  }
});

test('every Symbol twin is unique and inverts to its own byte', () => {
  const twins = new Map<string, number>();
  for (let byte = 0x20; byte <= 0xff; byte++) {
    const twin = mapSymbolPuaText(pua(byte), 'Symbol');
    if (twin === pua(byte)) continue;
    expect(twins.has(twin)).toBe(false);
    twins.set(twin, byte);
    expect(symbolFaceByteOf(twin.codePointAt(0)!, 'Symbol')).toBe(byte);
  }
  expect(twins.size).toBe(156);
});
