// The paragraph mark (`w:pPr/w:rPr`, CT_PPr / ECMA-376 17.3.1.29) sits on the last line of
// a paragraph and participates in that line's metrics. Cover pages often author a larger
// mark `w:sz` than the visible runs (e.g. 16pt mark, 10pt party name) — Word's line box
// follows the mark; ignoring it packs the title block too tight.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core-contract/store';
import { layoutSemanticDocument, linesOf, type TextMeasurer } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Size-aware measurer so mark `w:sz` and run `w:sz` produce different line boxes. */
const measurer: TextMeasurer = {
  measure(text, style) {
    return text.length * style.fontSizePt * 0.5;
  },
  lineMetrics(style) {
    return { height: style.fontSizePt * 1.15, baseline: style.fontSizePt * 0.9 };
  },
};

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const lay = (body: string) => layoutSemanticDocument(load(body), 1, { measurer });

describe('paragraph mark w:sz contributes to last-line height', () => {
  test('a taller mark grows a single-line paragraph past its run size', () => {
    const markTall = lay(
      '<w:p><w:pPr><w:rPr><w:sz w:val="32"/></w:rPr></w:pPr>' +
        '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>MERIDIAN</w:t></w:r></w:p>'
    );
    const plain = lay('<w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>MERIDIAN</w:t></w:r></w:p>');
    // 16pt mark → 18.4; 10pt run alone → 11.5.
    expect(linesOf(markTall)[0]!.box.height).toBeCloseTo(16 * 1.15, 5);
    expect(linesOf(plain)[0]!.box.height).toBeCloseTo(10 * 1.15, 5);
  });

  test('only the last wrapped line inherits the tall mark', () => {
    const words = Array.from({ length: 40 }, (_, index) => `w${index}`).join(' ');
    const lines = linesOf(
      lay(
        '<w:p><w:pPr><w:rPr><w:sz w:val="32"/></w:rPr></w:pPr>' +
          `<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${words}</w:t></w:r></w:p>` +
          '<w:sectPr><w:pgSz w:w="3000" w:h="9000"/>' +
          '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200"/></w:sectPr>'
      )
    );
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(0, -1)) {
      expect(line.box.height).toBeCloseTo(10 * 1.15, 5);
    }
    expect(lines[lines.length - 1]!.box.height).toBeCloseTo(16 * 1.15, 5);
  });

  test('an empty paragraph still uses the mark size for its placeholder line', () => {
    const lines = linesOf(lay('<w:p><w:pPr><w:rPr><w:sz w:val="32"/></w:rPr></w:pPr></w:p>'));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.box.height).toBeCloseTo(16 * 1.15, 5);
  });
});
