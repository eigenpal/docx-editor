// Auto line spacing scales a list line's text band, and the marker's extra ascent adds once.
//
// A 22pt bullet on an 11pt list at 0.9, 1.5, and double spacing grows each line by the
// marker's ascent over the text's, and the multiple applies to the 11pt band alone
// (`w:spacing`, `CT_Spacing`, 17.3.1.33; `ST_LineSpacingRule` `auto`, 17.18.48).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import type { ResolvedRunStyle } from '../run-style.ts';
import type { TextMeasurer } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TEXT_ASCENT = 11;
const TEXT_DESCENT = 3;
const MARKER_RISE = 4;

/** The paragraph face ascends 11 and descends 3; `Taller` ascends 4 further. */
const measurer: TextMeasurer = {
  measure: (text) => text.length * 6,
  lineMetrics: (style: ResolvedRunStyle) => {
    const ascent = style.fontFamily === 'Taller' ? TEXT_ASCENT + MARKER_RISE : TEXT_ASCENT;
    return { height: ascent + TEXT_DESCENT, baseline: ascent };
  },
};

function partOf(xml: string, name: string): OoxmlPart {
  const part = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!part.ok) throw new Error(part.reason);
  return part.part;
}

const numbering = partOf(
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0">` +
    `<w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/><w:lvlJc w:val="left"/>` +
    `<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>` +
    `<w:rPr><w:rFonts w:ascii="Taller" w:hAnsi="Taller"/></w:rPr></w:lvl></w:abstractNum>` +
    `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
  '/word/numbering.xml'
);

const LONG_TEXT = 'one two three four five six seven eight nine ten '.repeat(8);

function firstLines(spacing: string, numbered: boolean, text = LONG_TEXT) {
  const numPr = numbered ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '';
  const run = text ? `<w:r><w:t>${text}</w:t></w:r>` : '';
  const body = partOf(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr>${numPr}${spacing}</w:pPr>` +
      `${run}</w:p></w:body></w:document>`,
    '/word/document.xml'
  );
  const layout = layoutSemanticDocument(body, 1, {
    measurer,
    numberingIndex: buildNumberingIndex(numbering.root),
  });
  return paragraphFragmentsOf(layout.pages[0]!)[0]!.lines;
}

describe('a taller list marker under auto line spacing', () => {
  for (const [line, multiple] of [
    ['360', 1.5],
    ['480', 2],
  ] as const) {
    test(`at ${multiple}x the marker's rise adds once, unscaled`, () => {
      const spacing = `<w:spacing w:line="${line}" w:lineRule="auto"/>`;
      const listed = firstLines(spacing, true);
      const plain = firstLines(spacing, false);
      const band = (TEXT_ASCENT + TEXT_DESCENT) * multiple;
      expect(plain[0]!.box.height).toBeCloseTo(band, 9);
      expect(listed[0]!.box.height).toBeCloseTo(band + MARKER_RISE, 9);
      // The baseline still clears the marker's ascent; later lines keep the plain height.
      expect(listed[0]!.baseline).toBeCloseTo(TEXT_ASCENT + MARKER_RISE, 9);
      expect(listed[1]!.box.height).toBeCloseTo(plain[1]!.box.height, 9);
    });
  }

  test('below single the multiple shrinks the text band, and the rise still adds once', () => {
    const spacing = '<w:spacing w:line="216" w:lineRule="auto"/>';
    const listed = firstLines(spacing, true);
    const plain = firstLines(spacing, false);
    const band = (TEXT_ASCENT + TEXT_DESCENT) * 0.9;
    expect(plain[0]!.box.height).toBeCloseTo(band, 9);
    expect(listed[0]!.box.height).toBeCloseTo(band + MARKER_RISE, 9);
    // The text baseline scales with the band, and the marker's rise sits above it unscaled.
    expect(listed[0]!.baseline).toBeCloseTo(TEXT_ASCENT * 0.9 + MARKER_RISE, 9);
    expect(listed[1]!.box.height).toBeCloseTo(plain[1]!.box.height, 9);
  });

  test('an empty list paragraph scales the marker with the rest of its line', () => {
    // Without text, the marker is the line's only band, so the multiple applies to all of it.
    const lines = firstLines('<w:spacing w:line="360" w:lineRule="auto"/>', true, '');
    expect(lines[0]!.box.height).toBeCloseTo((TEXT_ASCENT + TEXT_DESCENT + MARKER_RISE) * 1.5, 9);
  });

  test('single spacing still grows the line by the rise', () => {
    const lines = firstLines('<w:spacing w:line="240" w:lineRule="auto"/>', true);
    expect(lines[0]!.box.height).toBe(TEXT_ASCENT + TEXT_DESCENT + MARKER_RISE);
  });

  test('exact spacing keeps its authored height', () => {
    const lines = firstLines('<w:spacing w:line="400" w:lineRule="exact"/>', true);
    expect(lines[0]!.box.height).toBe(20);
  });
});
