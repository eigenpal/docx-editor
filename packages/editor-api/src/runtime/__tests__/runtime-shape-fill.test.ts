/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `Shape.fill` through the server host: reads resolve the shape style, writes in one sync are
// one fill change, the VML fallback follows, and unsupported targets and values refuse.

import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor, ShapeFillType, ShapeType } from '../../index.ts';
import { docx } from './support/docx.ts';

const NS =
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';

const anchor = (id: number, payload: string) =>
  '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" ' +
  'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
  '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  '<wp:extent cx="914400" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
  `<wp:docPr id="${id}" name="Shape ${id}"/><wp:cNvGraphicFramePr/><a:graphic>` +
  `<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">${payload}` +
  '</a:graphicData></a:graphic></wp:anchor></w:drawing>';

const STYLED =
  '<wps:wsp><wps:cNvSpPr/><wps:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
  '<wps:style><a:lnRef idx="0"><a:srgbClr val="000000"/></a:lnRef><a:fillRef idx="1">' +
  '<a:srgbClr val="4472C4"/></a:fillRef><a:effectRef idx="0"><a:srgbClr val="000000"/></a:effectRef>' +
  '<a:fontRef idx="minor"><a:srgbClr val="FFFFFF"/></a:fontRef></wps:style><wps:bodyPr/></wps:wsp>';

const RECT =
  `<w:r><mc:AlternateContent ${NS}><mc:Choice Requires="wps">${anchor(1, STYLED)}</mc:Choice>` +
  '<mc:Fallback><w:pict><v:rect id="_x0000_s1025" style="width:72pt;height:36pt" fillcolor="#4472c4"/>' +
  '</w:pict></mc:Fallback></mc:AlternateContent></w:r>';
const LEGACY =
  `<w:r><w:pict ${NS}><v:rect id="_x0000_s1030" o:spid="_x0000_s1030" style="width:72pt;height:36pt" ` +
  'fillcolor="red"/></w:pict></w:r>';

const BYTES = docx(`<w:p><w:r><w:t>Cover</w:t></w:r>${RECT}${LEGACY}</w:p>`);

describe('Shape.fill through the host', () => {
  test('reads, writes one fill per sync, and clears', async () => {
    const runtime = await DocxEditor.createServer(BYTES);
    try {
      const result = await runtime.run(async (context) => {
        const shapes = context.document.body.shapes.getByTypes([ShapeType.geometricShape]);
        shapes.load('items');
        await context.sync();
        const [rect, legacy] = shapes.items;
        rect!.fill.load(['type', 'foregroundColor', 'transparency']);
        legacy!.fill.load('foregroundColor');
        await context.sync();
        const before = {
          type: rect!.fill.type,
          color: rect!.fill.foregroundColor,
          transparency: rect!.fill.transparency,
          legacy: legacy!.fill.foregroundColor,
        };
        rect!.fill.setSolidColor('#C00000');
        rect!.fill.transparency = 0.25;
        await context.sync();
        rect!.fill.load(['foregroundColor', 'transparency']);
        await context.sync();
        const after = { color: rect!.fill.foregroundColor, transparency: rect!.fill.transparency };
        legacy!.fill.clear();
        await context.sync();
        legacy!.fill.load('type');
        await context.sync();
        return { before, after, legacyType: legacy!.fill.type };
      });
      expect(result).toEqual({
        before: { type: ShapeFillType.solid, color: '#4472C4', transparency: 0, legacy: '#FF0000' },
        after: { color: '#C00000', transparency: 0.25 },
        legacyType: ShapeFillType.noFill,
      });
      const xml = strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
      expect(xml).toContain('<a:srgbClr val="C00000"><a:alpha val="75000"/></a:srgbClr>');
      expect(xml).toContain('fillcolor="#c00000"');
      expect(xml).toContain('filled="f"');
    } finally {
      runtime.dispose();
    }
  });

  test('a color name, a legacy transparency and an out-of-range value refuse', async () => {
    const runtime = await DocxEditor.createServer(BYTES);
    try {
      const outcome = await runtime.run(async (context) => {
        const shapes = context.document.body.shapes;
        shapes.load('items');
        await context.sync();
        const errors: string[] = [];
        try {
          shapes.items[0]!.fill.setSolidColor('red');
        } catch (error) {
          errors.push((error as { code: string }).code);
        }
        try {
          shapes.items[0]!.fill.transparency = 2;
        } catch (error) {
          errors.push((error as { code: string }).code);
        }
        shapes.items[1]!.fill.transparency = 0.5;
        try {
          await context.sync();
        } catch (error) {
          errors.push((error as { code: string }).code);
        }
        return errors;
      });
      expect(outcome).toEqual(['InvalidArgument', 'InvalidArgument', 'InvalidArgument']);
    } finally {
      runtime.dispose();
    }
  });
});
