/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { docx, mainXmlOf, serverRuntime } from './support/documents.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

for (const directFalse of [false, true]) {
  test(`font writes resolve inherited complex properties, direct false=${directFalse}`, async () => {
    const files = unzipSync(
      docx(
        '<w:p><w:r><w:rPr><w:rStyle w:val="Complex"/>' +
          (directFalse ? '<w:rtl w:val="0"/>' : '') +
          '</w:rPr><w:t>target</w:t></w:r></w:p>'
      )
    );
    files['[Content_Types].xml'] = strToU8(
      strFromU8(files['[Content_Types].xml']!).replace(
        '</Types>',
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
      )
    );
    files['word/_rels/document.xml.rels'] = strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
    );
    files['word/styles.xml'] = strToU8(
      `<w:styles xmlns:w="${W}"><w:style w:type="character" w:styleId="Complex"><w:rPr><w:rtl/><w:color w:val="123456"/></w:rPr></w:style></w:styles>`
    );
    const runtime = await serverRuntime(zipSync(files));
    try {
      await runtime.run(async (context) => {
        const matches = context.document.body.search('target');
        matches.load('items');
        await context.sync();
        const font = matches.items[0]!.font;
        font.bold = true;
        font.italic = true;
        font.size = 20;
        font.name = 'Arial';
        await context.sync();
      });
      const xml = await mainXmlOf(runtime);
      expect(xml.includes('<w:bCs')).toBe(!directFalse);
      expect(xml.includes('<w:iCs')).toBe(!directFalse);
      expect(xml.includes('<w:szCs')).toBe(true);
      expect(xml.includes('w:cs="Arial"')).toBe(!directFalse);
      expect(xml).not.toContain('123456');
      expect(xml).toContain('w:rStyle');
    } finally {
      runtime.dispose();
    }
  });
}

test('automation font writes use conditional table formatting and paragraph marks', async () => {
  const cell = (text: string) =>
    `<w:tr><w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr>`;
  const files = unzipSync(
    docx(
      '<w:tbl><w:tblPr><w:tblStyle w:val="TableStyle"/><w:tblLook w:firstRow="1"/></w:tblPr>' +
        '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
        cell('first') +
        cell('second') +
        '</w:tbl>'
    )
  );
  files['[Content_Types].xml'] = strToU8(
    strFromU8(files['[Content_Types].xml']!).replace(
      '</Types>',
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    )
  );
  files['word/_rels/document.xml.rels'] = strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
  );
  files['word/styles.xml'] = strToU8(
    `<w:styles xmlns:w="${W}"><w:style w:type="table" w:styleId="TableStyle"><w:tblStylePr w:type="firstRow"><w:rPr><w:rtl/></w:rPr></w:tblStylePr></w:style></w:styles>`
  );
  const runtime = await serverRuntime(zipSync(files));
  try {
    await runtime.run(async (context) => {
      context.document.body.font.bold = true;
      await context.sync();
    });
    const rows = (await mainXmlOf(runtime)).split('<w:tr>');
    expect(rows[1]).toContain('<w:bCs');
    expect(rows[2]).not.toContain('<w:bCs');
    expect(rows[1]).toContain('<w:b');
    expect(rows[2]).toContain('<w:b');
  } finally {
    runtime.dispose();
  }
});
