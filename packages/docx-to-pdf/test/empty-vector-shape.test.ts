/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { PDFDocument } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

function emptyShape(cx: number, cy: number, hyperlink = false) {
  return docx(
    `<w:p><w:r><w:drawing
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
    xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
    <wp:inline><wp:extent cx="${cx}" cy="${cy}"/>
    <wp:effectExtent l="9525" t="9525" r="9525" b="9525"/>
    <wp:docPr id="1" name="Empty shape">
    ${hyperlink ? '<a:hlinkClick r:id="shapeLink"/>' : ''}</wp:docPr>
    <a:graphic><a:graphicData
      uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
    <wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/>
    <a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
    <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
    <a:noFill/><a:ln><a:noFill/></a:ln>
    </wps:spPr></wps:wsp></a:graphicData></a:graphic>
    </wp:inline></w:drawing></w:r></w:p>`,
    hyperlink
      ? {
          'word/_rels/document.xml.rels':
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="shapeLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" ' +
            'Target="https://example.invalid/shape" TargetMode="External"/></Relationships>',
        }
      : {}
  );
}

for (const [cx, cy] of [
  [0, 0],
  [0, 635000],
  [1270000, 0],
  [1270000, 635000],
]) {
  test(`empty shape with ${cx},${cy} extents exports successfully`, async () => {
    const result = await exportPdf(emptyShape(cx!, cy!), {
      displayMode: 'proposed',
      fidelityPolicy: 'best-effort',
      comments: false,
      useSystemFonts: false,
    });
    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(result.diagnostics).toEqual([]);
  });
}

test('empty shapes with positive extents retain hyperlink annotations', async () => {
  const result = await exportPdf(emptyShape(1270000, 635000, true), {
    useSystemFonts: false,
    fidelityPolicy: 'best-effort',
  });
  const pdf = await PDFDocument.load(result.bytes);
  expect(pdf.getPage(0).node.Annots()?.size()).toBe(1);
});
