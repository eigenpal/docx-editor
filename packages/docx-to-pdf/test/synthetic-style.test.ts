/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from '../src/index.ts';
import { glyphPositions } from './glyph-positions.ts';
import { docx as fixtureDocx } from './fixture.ts';

// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

/** The shared fixture package, given a styles part that pins the format defaults. */
function docx(body: string, extras: Record<string, string | Uint8Array> = {}): Uint8Array {
  const files = unzipSync(fixtureDocx(body, extras));
  files['word/styles.xml'] ??= strToU8(
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `${FORMAT_DOC_DEFAULTS}</w:styles>`
  );
  files['[Content_Types].xml'] = strToU8(
    strFromU8(files['[Content_Types].xml']!).replace(
      '</Types>',
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    )
  );
  const rels = files['word/_rels/document.xml.rels'];
  const stylesRel =
    '<Relationship Id="rIdFormatStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
  files['word/_rels/document.xml.rels'] = strToU8(
    rels
      ? strFromU8(rels).replace('</Relationships>', `${stylesRel}</Relationships>`)
      : `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${stylesRel}</Relationships>`
  );
  return zipSync(files);
}

async function contentStreams(bytes: Uint8Array): Promise<string> {
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

async function extracted(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    return content.items.map((item) => ('str' in item ? item.str : '')).join('');
  } finally {
    await pdf.destroy();
  }
}

// Arabic in Arial: the packaged fallback is the single-weight Noto Sans Arabic Regular.
// A `w:rtl` run takes bold and italic from `w:bCs` and `w:iCs`.
const arabic = (rPr: string) =>
  docx(
    `<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${rPr}<w:sz w:val="20"/><w:rtl/></w:rPr><w:t>مرحبا بالعالم</w:t></w:r></w:p>`
  );
const exported = (input: Uint8Array) => exportPdf(input, { useSystemFonts: false });

test('bold in a single-weight face is stroked, on unchanged advances', async () => {
  const [regular, bold] = await Promise.all([
    exported(arabic('')),
    exported(arabic('<w:b/><w:bCs/>')),
  ]);
  const stream = await contentStreams(bold.bytes);
  // Word 16 draws 10pt (10.08 on the grid) with `1.34 w` in 0.24pt units: 0.3216pt.
  expect(stream).toContain('0.3216 w 2 Tr');
  expect(stream).toMatch(/0 0 0 RG/);
  expect(stream).toMatch(/1 0 0 0\.980392 [\d.]+ [\d.]+ Tm/);
  expect(await contentStreams(regular.bytes)).not.toContain('2 Tr');
  // Paint only: layout and glyph origins are those of the regular run.
  expect(await glyphPositions(bold.bytes)).toEqual(await glyphPositions(regular.bytes));
  expect(await extracted(bold.bytes)).toBe(await extracted(regular.bytes));
});

test('italic in an upright face is skewed', async () => {
  const [regular, italic] = await Promise.all([
    exported(arabic('')),
    exported(arabic('<w:i/><w:iCs/>')),
  ]);
  expect(await contentStreams(italic.bytes)).toMatch(/1 0 0\.339844 1 [\d.]+ [\d.]+ Tm/);
  expect(await glyphPositions(italic.bytes)).toEqual(await glyphPositions(regular.bytes));
  expect(await extracted(italic.bytes)).toBe(await extracted(regular.bytes));
});

test('a real bold or italic face draws as it is', async () => {
  // Arial bold italic resolves to Liberation Sans Bold Italic, which has both.
  const result = await exported(
    docx(
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:i/></w:rPr><w:t>Bold italic</w:t></w:r></w:p>'
    )
  );
  const stream = await contentStreams(result.bytes);
  expect(stream).not.toContain('2 Tr');
  expect(stream).not.toMatch(/ 0\.339844 /);
  expect(await extracted(result.bytes)).toBe('Bold italic');
});
