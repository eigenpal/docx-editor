/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const marker = (color: string) =>
  `<w:r><w:rPr><w:color w:val="${color}"/></w:rPr><w:separator/></w:r>`;
export function mixedSeparatorDocx(
  separator:
    | string
    | null = `<w:p><w:r><w:t>Before</w:t></w:r>${marker('FF0000')}<w:r><w:t>After</w:t></w:r>${marker('0000FF')}</w:p>`
) {
  return docx('<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/></w:r></w:p>', {
    'word/_rels/document.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="fn" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>',
    'word/footnotes.xml': `<w:footnotes xmlns:w="${W}">${separator === null ? '' : `<w:footnote w:type="separator" w:id="-1">${separator}</w:footnote>`}<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/><w:t>Note content</w:t></w:r></w:p></w:footnote></w:footnotes>`,
  });
}

test('PDF retains both colored rules and surrounding text in a mixed separator story', async () => {
  const result = await exportPdf(mixedSeparatorDocx(), { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  const parsed = await PDFDocument.load(result.bytes);
  const commands = parsed.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
        : []
    )
    .filter((stream) => stream.includes(' Tm '))
    .join('\n');
  const rectangles = [
    ...commands.matchAll(
      /([\d.]+) ([\d.]+) ([\d.]+) rg ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re f/g
    ),
  ].map((match) => ({ color: match.slice(1, 4).join(' '), box: match.slice(4).map(Number) }));
  const rules = rectangles.filter((rectangle) => ['1 0 0', '0 0 1'].includes(rectangle.color));
  expect(rules.map((rule) => rule.color)).toEqual(['1 0 0', '0 0 1']);
  // 0.48, not 0.5: painted rule thickness goes down to the 0.24pt device grid.
  for (const rule of rules) expect(rule.box.slice(2)).toEqual([144, 0.48]);
  expect(rules[1]!.box[0]!).toBeGreaterThan(rules[0]!.box[0]! + 144);
  expect(rules[1]!.box[1]).toBe(rules[0]!.box[1]);
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const text = await (await pdf.getPage(1)).getTextContent();
    const strings = text.items
      .filter((item) => 'str' in item)
      .map((item) => ('str' in item ? item.str : ''))
      .join('');
    expect(strings).toContain('Before');
    expect(strings).toContain('After');
    expect(strings).toContain('Note content');
    expect(strings).not.toContain('\uFFFC');
  } finally {
    await pdf.destroy();
  }
});

for (const separator of [
  '',
  '<w:p/>',
  '<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:separator/></w:r></w:p>',
  null,
]) {
  test(`PDF distinguishes missing and empty separator stories: ${separator}`, async () => {
    const result = await exportPdf(mixedSeparatorDocx(separator), { useSystemFonts: false });
    expect(result.diagnostics).toEqual([]);
    const parsed = await PDFDocument.load(result.bytes);
    const commands = parsed.context
      .enumerateIndirectObjects()
      .flatMap(([, object]) =>
        object instanceof PDFRawStream
          ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
          : []
      )
      .filter((stream) => stream.includes(' Tm '))
      .join('\n');
    expect([...commands.matchAll(/144 0\.48 re f/g)]).toHaveLength(separator === null ? 1 : 0);
    expect(parsed.getPageCount()).toBe(1);
  });
}
