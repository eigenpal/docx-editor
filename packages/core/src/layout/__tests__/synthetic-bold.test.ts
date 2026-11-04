// Synthesized bold follows the face's own bytes, not the weight it was registered under.
//
// Word embeds the face it draws bold text with in the font's bold slot. For a family without a
// bold face, that is a copy of the regular face, and Word emboldens it: each inked glyph also
// advances 1/50 em further. The test font stands in for such a family by filling the bold slot
// with the regular DejaVu Sans.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPart } from '../../store/index.ts';
import { linesOf } from '../semantic-records.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { HEAD_TAG, OS2_TAG, tableDirectoryBase, tableOffset } from '../sfnt-tables.ts';
import { sfntFaceIsBold } from '../synthetic-bold.ts';
import {
  DEFAULT_RUN_STYLE,
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  SYNTHETIC_BOLD_ADVANCE_EM,
  createFixedMeasurer,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapedMeasurer,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
  type FontRequest,
  type ResolvedRunStyle,
} from '../index.ts';

await initializeHarfBuzz();

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./fixtures/fonts/${name}`, import.meta.url)));
const regularBytes = fixture('DejaVuSans.ttf');
const boldBytes = fixture('DejaVuSans-Bold.ttf');

/** A copy of the regular face with one field of its `OS/2` or `head` table changed. */
function withField(table: number, offset: number, value: number): Uint8Array {
  const bytes = regularBytes.slice();
  const view = new DataView(bytes.buffer);
  const start = tableOffset(
    view,
    bytes.byteLength,
    tableDirectoryBase(view, bytes.length, 0)!,
    table,
    0
  );
  view.setUint16(start! + offset, value);
  return bytes;
}

describe('sfntFaceIsBold reads the face itself', () => {
  test('a regular face is not bold, a bold face is', () => {
    expect(sfntFaceIsBold(regularBytes, 0)).toBe(false);
    expect(sfntFaceIsBold(boldBytes, 0)).toBe(true);
  });

  test('a weight class of 600, the fsSelection bold bit, or the macStyle bold bit makes it bold', () => {
    expect(sfntFaceIsBold(withField(OS2_TAG, 4, 600), 0)).toBe(true);
    expect(sfntFaceIsBold(withField(OS2_TAG, 4, 599), 0)).toBe(false);
    expect(sfntFaceIsBold(withField(OS2_TAG, 62, 0x0020), 0)).toBe(true);
    expect(sfntFaceIsBold(withField(HEAD_TAG, 44, 0x0001), 0)).toBe(true);
  });

  test('bytes that are not a face are not bold', () => {
    expect(sfntFaceIsBold(new Uint8Array([1, 2, 3]), 0)).toBe(false);
    expect(sfntFaceIsBold(new Uint8Array(0), 0)).toBe(false);
  });
});

const face = (family: string, weight: number, bytes: Uint8Array) => ({
  request: { family, weight, style: 'normal' as const },
  id: `${family}-${weight}`,
  bytes,
  hash: sha256FontBytes(bytes),
  faceIndex: 0,
});
const snapshot = createFontResourceSnapshot({
  epoch: 1,
  maxFontBytes: 2_000_000,
  resources: [
    face('Single Weight', 400, regularBytes),
    // Word's bold slot for a family without a bold face: the regular face again.
    face('Single Weight', 700, regularBytes),
    face('Two Weights', 400, regularBytes),
    face('Two Weights', 700, boldBytes),
  ],
  validateFont: harfBuzzFontValidator,
});
const measurer = createShapedMeasurer({
  shaper: createHarfBuzzTextShaper(),
  resolveFont: (style) => {
    const request: FontRequest = {
      family: style.fontFamily ?? 'Single Weight',
      weight: style.bold ? 700 : 400,
      style: 'normal',
    };
    const resolved = snapshot.resolve(request);
    return resolved instanceof FontResolutionError ? null : resolved;
  },
  fallback: createFixedMeasurer(6, 14),
  shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
  unicodeDataVersion: '15.1',
});
const style = (fontFamily: string, bold: boolean): ResolvedRunStyle => ({
  ...DEFAULT_RUN_STYLE,
  fontFamily,
  fontSizePt: 11,
  bold,
});

describe('a bold slot that holds a regular face', () => {
  test('measures each inked glyph 1/50 em wider, as Word draws it', () => {
    const regular = measurer.measure('Bold text', style('Single Weight', false));
    const bold = measurer.measure('Bold text', style('Single Weight', true));
    // Eight inked glyphs; the space keeps its advance.
    expect(bold - regular).toBeCloseTo(8 * 11 * SYNTHETIC_BOLD_ADVANCE_EM, 3);
    expect(measurer.syntheticBold?.(style('Single Weight', true))).toBe(true);
    expect(measurer.caretAdvances?.('Bold text', style('Single Weight', true))?.at(-1)).toBeCloseTo(
      bold,
      3
    );
  });

  test('a real bold face takes no extra advance', () => {
    expect(measurer.syntheticBold?.(style('Two Weights', true))).toBe(false);
    expect(measurer.syntheticBold?.(style('Single Weight', false))).toBe(false);
  });

  test('layout marks the spans whose bold is synthesized, and no blank span', () => {
    const read = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:p>` +
        `<w:r><w:rPr><w:rFonts w:ascii="Single Weight" w:hAnsi="Single Weight"/><w:b/></w:rPr><w:t xml:space="preserve">Single </w:t></w:r>` +
        `<w:r><w:rPr><w:rFonts w:ascii="Two Weights" w:hAnsi="Two Weights"/><w:b/></w:rPr><w:t xml:space="preserve">Two </w:t></w:r>` +
        `<w:r><w:rPr><w:rFonts w:ascii="Single Weight" w:hAnsi="Single Weight"/><w:b/></w:rPr><w:t xml:space="preserve">  </w:t></w:r>` +
        `<w:r><w:rPr><w:rFonts w:ascii="Single Weight" w:hAnsi="Single Weight"/></w:rPr><w:t>plain</w:t></w:r>` +
        `</w:p></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'application/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    const spans = linesOf(layoutSemanticDocument(read.part, 0, { measurer }))[0]!.spans;
    const marked = (text: string) => spans.find((span) => span.text === text)?.syntheticBold;
    expect(marked('Single ')).toBe(true);
    expect(marked('Two ')).toBeUndefined();
    expect(marked('  ')).toBeUndefined();
    expect(marked('plain')).toBeUndefined();
  });
});
