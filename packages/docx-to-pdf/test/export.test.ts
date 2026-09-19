/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf, PdfDocumentOpenError, PdfFidelityError } from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';

describe('exact PDF export', () => {
  test('strict text export embeds glyphs with extractable Unicode', async () => {
    const result = await exportPdf(docx(paragraph('Hello office café!')));
    expect(result.diagnostics).toEqual([]);
    const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
    try {
      expect(pdf.numPages).toBe(1);
      const text = await (await pdf.getPage(1)).getTextContent();
      expect(
        text.items
          .filter((i) => 'str' in i)
          .map((i) => ('str' in i ? i.str : ''))
          .join('')
      ).toBe('Hello office café!');
    } finally {
      await pdf.destroy();
    }
    const parsed = await PDFDocument.load(result.bytes);
    expect(parsed.getPageCount()).toBe(1);
  });
  test('deterministic bytes and invalid document errors', async () => {
    const input = docx(paragraph('Repeatable'));
    const a = await exportPdf(input),
      b = await exportPdf(input);
    expect(a.bytes).toEqual(b.bytes);
    await expect(exportPdf(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(PdfDocumentOpenError);
  });
  test('legacy bullet markers draw their own face and still extract as Unicode', async () => {
    const levels = [
      ['Symbol', '\uF0B7'],
      ['Wingdings', '\uF0A7'],
    ];
    const input = docx(
      levels
        .map(
          (_, level) =>
            `<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Item ${level}</w:t></w:r></w:p>`
        )
        .join(''),
      {
        'word/_rels/document.xml.rels':
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="numbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>',
        'word/numbering.xml': `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1">${levels.map(([family, glyph], level) => `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${glyph}"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/></w:rPr></w:lvl>`).join('')}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
      }
    );
    const result = await exportPdf(input);
    expect(result.diagnostics).toEqual([]);
    const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
    try {
      const text = await (await pdf.getPage(1)).getTextContent();
      const content = text.items.flatMap((item) => ('str' in item ? [item.str] : [])).join('');
      expect(content).toContain('•');
      expect(content).toContain('▪');
      expect(content).toContain('Item 0');
      expect(content).toContain('Item 1');
    } finally {
      await pdf.destroy();
    }
  });
  test('abort and output limit', async () => {
    await expect(
      exportPdf(docx(paragraph('Test')), { signal: AbortSignal.abort() })
    ).rejects.toMatchObject({ code: 'aborted' });
    await expect(exportPdf(docx(paragraph('Test')), { maxOutputBytes: 100 })).rejects.toThrow(
      'maxOutputBytes'
    );
    await expect(exportPdf(docx(paragraph('Test')), { timeoutMs: 1 })).rejects.toMatchObject({
      code: 'timedOut',
    });
    expect((await exportPdf(docx(paragraph('Recovered')))).pageCount).toBe(1);
  });
  test('unsupported formatting refuses strict output', async () => {
    const input = docx(paragraph('Underlined', '<w:rPr><w:u w:val="unsupported"/></w:rPr>'));
    await expect(exportPdf(input)).rejects.toBeInstanceOf(PdfFidelityError);
    expect(
      (await exportPdf(input, { fidelityPolicy: 'best-effort' })).diagnostics.length
    ).toBeGreaterThan(0);
  });
});
