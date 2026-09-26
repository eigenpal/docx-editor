/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { docx, paragraph } from '../../test/fixture.ts';
import { exportPdf } from '../../src/index.ts';
import { summarizePages } from './layout-summary.ts';

test('pagination-only session agrees with PDF export for page breaks and tables', async () => {
  const source = docx(
    paragraph('First page') +
      '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>' +
      '<w:tr><w:tc><w:tcPr/>' +
      paragraph('Second page cell') +
      '</w:tc></w:tr></w:tbl>'
  );
  const summary = await summarizePages(source);
  const pdf = await exportPdf(source, {
    displayMode: 'proposed',
    comments: false,
    useSystemFonts: false,
    fidelityPolicy: 'best-effort',
  });
  expect(summary.pageCount).toBe(2);
  expect(summary.pageCount).toBe(pdf.pageCount);
  expect(summary.textStatus).toBe('recorded-logical-layout');
  expect(summary.text.pages[0]!.lines.map((line) => line.text).join(' ')).toContain('First page');
  expect(summary.text.pages[1]!.lines.map((line) => line.text).join(' ')).toContain('Second page cell');
  expect(summary.text.pages[1]!.lines[0]!.spans[0]!.sourceRange).not.toBeNull();
  expect(summary.visualStatus).toBe('not-measured');
});

test('pagination-only session refuses invalid documents', async () => {
  await expect(summarizePages(new Uint8Array([1, 2, 3]))).rejects.toThrow();
});

 test('records words across styled spans and excludes hidden text', async () => {
  const source = docx('<w:p><w:r><w:t>hel</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>lo world</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>secret</w:t></w:r></w:p>');
  const summary = await summarizePages(source);
  const text = summary.text.pages[0]!.lines.map((line) => line.text).join(' ');
  expect(text).toBe('hello world');
  expect(summary.text.pages[0]!.lines[0]!.spans.length).toBeGreaterThan(1);
});

test('records repeated page furniture and logical RTL text', async () => {
  const source = docx(
    paragraph('First') + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
    paragraph('שלום עולם') +
    '<w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr>',
    {
      'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="header" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>',
      'word/header1.xml': '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' + paragraph('Repeated header') + '</w:hdr>',
    }
  );
  const summary = await summarizePages(source);
  expect(summary.text.pages).toHaveLength(2);
  for (const page of summary.text.pages) {
    expect(page.lines.filter((line) => line.story === 'header').map((line) => line.text).join(' ')).toBe('Repeated header');
  }
  expect(summary.text.pages[1]!.lines.map((line) => line.text).join(' ')).toContain('שלום עולם');
});
