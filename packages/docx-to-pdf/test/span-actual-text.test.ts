/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

const ARIAL = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>';
const run = (text: string, properties = '') =>
  `<w:r><w:rPr>${ARIAL}${properties}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const NUMBERING =
  '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/>' +
  '<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>' +
  `<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr>${ARIAL}</w:rPr></w:lvl>` +
  '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>';
const input = docx(
  // A tab in its own run, a tab inside a run, hidden text, and a numbered paragraph.
  `<w:p>${run('Label:')}<w:r><w:rPr>${ARIAL}</w:rPr><w:tab/></w:r>${run('Value one')}</w:p>` +
    `<w:p><w:r><w:rPr>${ARIAL}</w:rPr><w:t>Name</w:t><w:tab/><w:t>Value two</w:t></w:r></w:p>` +
    `<w:p>${run('Shown ')}${run('hidden ', '<w:vanish/>')}${run('after')}</w:p>` +
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run('Item text')}</w:p>`,
  {
    'word/_rels/document.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>',
    'word/numbering.xml': NUMBERING,
  }
);

async function pageStream(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes);
  return pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
        : []
    )
    .filter((stream) => stream.includes(' Tm '))
    .join('\n');
}

const decode = (hex: string) =>
  String.fromCharCode(...(hex.match(/.{4}/g) ?? []).map((unit) => parseInt(unit, 16)));

// Extractors give a region's ActualText characters to its glyphs in order. A character with
// no glyph of its own would move every later character onto the next glyph.
test('each ActualText region has one character per painted glyph', async () => {
  const stream = await pageStream((await exportPdf(input, { useSystemFonts: false })).bytes);
  const regions = [
    ...stream.matchAll(/\/Span << \/ActualText <FEFF([0-9A-Fa-f]*)> >> BDC\n([\s\S]*?)\nEMC/g),
  ].map(([, hex, body]) => ({
    text: decode(hex!),
    glyphs: [...body!.matchAll(/<([0-9A-Fa-f]{4})>/g)].length,
  }));
  const texts = regions.map((region) => region.text);
  expect(texts.join('')).not.toMatch(/[\t\n\r\f]/);
  expect(texts.join('')).not.toContain('hidden');
  expect(texts).toEqual(expect.arrayContaining(['Label:', 'Value ', 'Name', 'after']));
  expect(texts).toContain('1. ');
  for (const region of regions) {
    // The marker's trailing space keeps it apart from the text; it has no glyph.
    const characters = region.text === '1. ' ? 2 : [...region.text].length;
    expect({ text: region.text, glyphs: region.glyphs }).toEqual({
      text: region.text,
      glyphs: characters,
    });
  }
});

test('an n-ary equation region carries the operator it draws', async () => {
  const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
  const bytes = docx(
    `<w:p xmlns:m="${M}"><m:oMath><m:nary><m:naryPr/>` +
      '<m:sub><m:r><m:t>a</m:t></m:r></m:sub><m:sup><m:r><m:t>b</m:t></m:r></m:sup>' +
      '<m:e><m:r><m:t>y</m:t></m:r></m:e></m:nary></m:oMath></w:p>'
  );
  const stream = await pageStream((await exportPdf(bytes, { useSystemFonts: false })).bytes);
  const texts = [...stream.matchAll(/\/Span << \/ActualText <FEFF([0-9A-Fa-f]*)> >> BDC/g)].map(
    ([, hex]) => decode(hex!)
  );
  // Without m:chr the operator is an integral, and copied PDF text includes it.
  expect(texts).toEqual(['∫aby']);
});
