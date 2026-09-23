/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { docx, paragraph } from '../../test/fixture.ts';
import { traceDocument } from './trace.ts';

test('trace anchors resolved geometry to source nodes without document text', async () => {
  const source = docx(
    '<w:p><w:pPr><w:ind w:left="360"/><w:spacing w:before="240"/></w:pPr><w:r><w:t>Private fixture phrase</w:t></w:r></w:p>'
  );
  const report = await traceDocument(source, 1, 90);
  const record = report.records[0]!;
  expect(record.nodeId).toStartWith('/word/document.xml#');
  expect(record.partName).toBe('/word/document.xml');
  expect(record.resolved).toMatchObject({ indentPt: { left: 18 }, alignment: 'left' });
  expect(record.bbox[0]).toBe(90);
  expect(report.page.contentBox).toEqual([72, 72, 540, 720]);
  expect(JSON.stringify(report)).not.toContain('Private fixture phrase');
  expect(report.producer.settingsSha256).toHaveLength(64);
  expect(report.sourceSha256).toHaveLength(64);
  const lines = record.lines as { baselineOffsetPt: number; bbox: number[] }[];
  expect(lines[0]!.baselineOffsetPt).toBeGreaterThan(0);
  expect(lines[0]!.baselineOffsetPt).toBeLessThan(lines[0]!.bbox[3]! - lines[0]!.bbox[1]!);
  expect(report.baselineCoordinateSpace).toContain('line box top');
});

test('trace selects nearby table geometry and retains canonical table identity', async () => {
  const source = docx(
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>' +
      '<w:tr><w:tc><w:tcPr/>' +
      paragraph('Cell') +
      '</w:tc></w:tr></w:tbl>'
  );
  const report = await traceDocument(source, 1, 80);
  const table = report.records.find((record) => record.kind === 'table');
  expect(table?.nodeId).toStartWith('/word/document.xml#');
  expect(table?.rowCount).toBe(1);
  expect(table?.columnCount).toBe(1);
  const tables = await traceDocument(source, 1, 80, 'table');
  expect(tables.query.kind).toBe('table');
  expect(tables.records).toHaveLength(1);
  expect(tables.records[0]!.kind).toBe('table');
  const paragraphs = await traceDocument(source, 1, 80, 'paragraph');
  expect(paragraphs.records).toHaveLength(1);
  expect(paragraphs.records[0]!.kind).toBe('paragraph');
  const drawings = await traceDocument(source, 1, 80, 'drawing');
  expect(drawings.records).toHaveLength(0);
  expect(drawings.recordsMatched).toBe(0);
  expect(drawings.recordsVisited).toBeGreaterThan(0);
});

test('trace maps header and footer records into page coordinates', async () => {
  const source = docx(
    paragraph('Body') +
      '<w:sectPr><w:headerReference w:type="default" r:id="h"/>' +
      '<w:footerReference w:type="default" r:id="f"/></w:sectPr>',
    {
      'word/_rels/document.xml.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="h" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' +
        '<Relationship Id="f" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>',
      'word/header1.xml':
        '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        paragraph('Header') +
        '</w:hdr>',
      'word/footer1.xml':
        '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        paragraph('Footer') +
        '</w:ftr>',
    }
  );
  const header = (await traceDocument(source, 1, 36)).records[0]!;
  expect(header.story).toBe('header');
  expect(header.partName).toBe('/word/header1.xml');
  expect(header.bbox[1]).toBe(36);
  const footer = (await traceDocument(source, 1, 750)).records[0]!;
  expect(footer.story).toBe('footer');
  expect(footer.partName).toBe('/word/footer1.xml');
  expect(footer.bbox[1]).toBeGreaterThan(700);
});

test('trace is bounded and refuses invalid page queries', async () => {
  const source = docx(
    Array.from({ length: 30 }, (_, index) => paragraph(`Line ${index}`)).join('')
  );
  const report = await traceDocument(source, 1, 200);
  expect(report.records.length).toBeLessThanOrEqual(3);
  expect(JSON.stringify(report).length).toBeLessThanOrEqual(8000);
  await expect(traceDocument(source, 0, 0)).rejects.toThrow('positive integer');
  await expect(traceDocument(source, 1, -1)).rejects.toThrow('inside');
  await expect(traceDocument(source, 999, 0)).rejects.toThrow('does not exist');
});

test('trace exposes drawing identity and distinguishes vector geometry from image state', async () => {
  const source = docx(`<w:p><w:r><w:drawing
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
    xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
    <wp:inline><wp:extent cx="1270000" cy="635000"/><wp:docPr id="1" name="Synthetic shape"/>
    <a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
    <wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="635000"/></a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
    </wps:spPr></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
  const report = await traceDocument(source, 1, 90);
  const drawing = report.records.find((record) => record.kind === 'inlineDrawing');
  expect(drawing?.nodeId).toStartWith('/word/document.xml#');
  expect(drawing?.partName).toBe('/word/document.xml');
  expect(drawing?.bbox[0]).toBe(72);
  expect(drawing?.hasVectorShape).toBe(true);
  const drawings = await traceDocument(source, 1, 0, 'drawing');
  expect(drawings.records).toHaveLength(1);
  expect(drawings.records[0]!.kind).toBe('inlineDrawing');
  expect(drawings.records[0]!.nodeId).toBe(drawing!.nodeId);
  expect(drawings.records[0]!.resourceState).toBeDefined();
  expect(drawings.selectionMeaning).toContain('do not confirm');
});
