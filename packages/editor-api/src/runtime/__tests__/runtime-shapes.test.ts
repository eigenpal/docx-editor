/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Text boxes through the server host (issue #1070).
//
// `Body.shapes` lists floating shapes, and a text box's `body` is an ordinary story: paragraphs,
// text, search and edits. An edit saves to both the DrawingML copy and its VML fallback.

import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor, ShapeType } from '../../index.ts';
import { docx } from './support/docx.ts';

const NS =
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml"';

const story =
  '<w:txbxContent><w:p><w:r><w:t>Client: Acme Holdings</w:t></w:r></w:p></w:txbxContent>';

const BOX =
  `<w:r><mc:AlternateContent ${NS}><mc:Choice Requires="wps"><w:drawing><wp:anchor distT="0" ` +
  'distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" ' +
  'layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH ' +
  'relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV ' +
  'relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent ' +
  'cx="2743200" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare ' +
  'wrapText="bothSides"/><wp:docPr id="1" name="Text Box 1"/><wp:cNvGraphicFramePr/><a:graphic>' +
  '<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
  '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  `</wps:spPr><wps:txbx>${story}</wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>` +
  '</wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape id="Text Box 1" ' +
  `type="#_x0000_t202" style="width:3in;height:36pt"><v:textbox>${story}</v:textbox></v:shape>` +
  '</w:pict></mc:Fallback></mc:AlternateContent></w:r>';

const BYTES = docx(`<w:p><w:r><w:t>Cover</w:t></w:r>${BOX}</w:p>`);

describe('text boxes through the host', () => {
  test('a text box is listed, read, searched and edited through its body', async () => {
    const runtime = await DocxEditor.createServer(BYTES);
    try {
      const read = await runtime.run(async (context) => {
        const shapes = context.document.body.shapes.getByTypes([ShapeType.textBox]);
        shapes.load('items');
        await context.sync();
        const box = shapes.items[0]!;
        box.load(['id', 'name', 'type']);
        // A body read through its shape is addressable after the sync that answers it.
        box.body.load('text');
        await context.sync();
        const paragraphs = box.body.paragraphs;
        paragraphs.load('items');
        const found = box.body.search('Acme Holdings');
        found.load('items');
        await context.sync();
        for (const paragraph of paragraphs.items) paragraph.load('text');
        await context.sync();
        found.items[0]!.insertText('Beta Logistics', 'Replace');
        await context.sync();
        box.body.load('text');
        await context.sync();
        return {
          count: shapes.items.length,
          shape: { id: box.id, name: box.name, type: box.type },
          paragraphs: paragraphs.items.map((paragraph) => paragraph.text),
          after: box.body.text,
        };
      });
      expect(read).toEqual({
        count: 1,
        shape: { id: 1, name: 'Text Box 1', type: ShapeType.textBox },
        paragraphs: ['Client: Acme Holdings'],
        after: 'Client: Beta Logistics',
      });
      const xml = strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
      expect(xml.match(/Beta Logistics/g)).toHaveLength(2);
      expect(xml).not.toContain('Acme');
    } finally {
      runtime.dispose();
    }
  });

  test('the anchoring paragraph reads its own words only', async () => {
    const runtime = await DocxEditor.createServer(BYTES);
    try {
      const text = await runtime.run(async (context) => {
        const paragraph = context.document.body.paragraphs.getFirst();
        paragraph.load('text');
        await context.sync();
        return paragraph.text;
      });
      expect(text).toBe('Cover');
    } finally {
      runtime.dispose();
    }
  });

  test('chained type filters narrow to the types both name', async () => {
    const runtime = await DocxEditor.createServer(BYTES);
    try {
      const counts = await runtime.run(async (context) => {
        const shapes = context.document.body.shapes;
        const both = shapes.getByTypes([ShapeType.textBox, ShapeType.picture]);
        const kept = both.getByTypes([ShapeType.textBox]);
        const none = both.getByTypes([ShapeType.geometricShape]);
        kept.load('items');
        none.load('items');
        await context.sync();
        return [kept.items.length, none.items.length];
      });
      expect(counts).toEqual([1, 0]);
    } finally {
      runtime.dispose();
    }
  });

  test('a paragraph lists the shapes it anchors', async () => {
    const runtime = await DocxEditor.createServer(BYTES);
    try {
      const ids = await runtime.run(async (context) => {
        const shapes = context.document.body.paragraphs.getFirst().shapes;
        shapes.load('items');
        await context.sync();
        for (const shape of shapes.items) shape.load('id');
        await context.sync();
        return shapes.items.map((shape) => shape.id);
      });
      expect(ids).toEqual([1]);
    } finally {
      runtime.dispose();
    }
  });
});
