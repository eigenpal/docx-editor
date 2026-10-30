/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Legacy VML text boxes through the server host.
//
// Some documents keep all of their visible text in floating VML text boxes, anchored by one
// empty body paragraph. An agent reaches that text through `Body.shapes` and each shape's
// `body`, and edits it there, tracked, instead of writing into the empty anchor paragraph.

import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor, DocxEditorError, ShapeType } from '../../index.ts';
import { docx } from './support/docx.ts';

const NS =
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';
const STYLE = 'position:absolute;margin-left:36pt;margin-top:13pt;width:144pt;height:36pt';

const box = (id: number, text: string) =>
  `<w:r><w:pict ${NS}><v:shape id="_x0000_s${String(id)}" type="#_x0000_t202" ` +
  `style="${STYLE}"><v:textbox inset="0,0,0,0"><w:txbxContent><w:p><w:r><w:t>${text}</w:t>` +
  '</w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r>';
// A border drawn with the text box template and no text frame of its own.
const frame = (id: number) =>
  `<w:r><w:pict ${NS}><v:shape id="_x0000_s${String(id)}" type="#_x0000_t202" ` +
  `style="${STYLE}" filled="f" stroked="t"/></w:pict></w:r>`;

// One 1pt anchor paragraph that holds every box, as page-capture converters write it.
const BYTES = docx(
  '<w:p><w:pPr><w:spacing w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>' +
    `${frame(1025)}${box(1026, 'Ref 7')}${box(1027, 'Client: Acme Holdings')}</w:p>`
);

describe('legacy VML text boxes through the host', () => {
  test('an agent reads every box in one sync and redlines the one it means', async () => {
    const runtime = await DocxEditor.createServer(BYTES, { author: 'Agent' });
    try {
      const texts = await runtime.run(async (context) => {
        const body = context.document.body;
        body.load('text');
        const shapes = body.shapes.getByTypes([ShapeType.textBox, ShapeType.geometricShape]);
        shapes.load('items/id,items/type');
        await context.sync();
        // The anchor paragraph holds no text; the boxes hold all of it.
        expect(body.text).toBe('');
        const bodies = shapes.items.map((shape) => {
          shape.body.load('text');
          return shape.body;
        });
        await context.sync();

        const target = bodies.find((story) => story.text.includes('Acme'))!;
        const matches = target.search('Acme', { matchCase: true });
        matches.load('items');
        await context.sync();
        context.document.changeTrackingMode = 'TrackMineOnly';
        matches.items[0]!.insertText('Beta', 'Replace');
        await context.sync();
        target.load('text');
        await context.sync();
        return shapes.items.map((shape, index) => ({
          id: shape.id,
          type: shape.type,
          text: bodies[index]!.text,
        }));
      });
      expect(texts).toEqual([
        { id: 1025, type: ShapeType.textBox, text: '' },
        { id: 1026, type: ShapeType.textBox, text: 'Ref 7' },
        { id: 1027, type: ShapeType.textBox, text: 'Client: AcmeBeta Holdings' },
      ]);
      const xml = strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
      expect(xml).toMatch(/<v:textbox[^>]*><w:txbxContent>.*<w:del\b.*Acme.*<w:ins\b.*Beta/);
    } finally {
      runtime.dispose();
    }
  });

  test('a box with no text frame reads as empty and refuses a write', async () => {
    const runtime = await DocxEditor.createServer(BYTES);
    try {
      const failure = await runtime.run(async (context) => {
        const shape = context.document.body.shapes.getFirst();
        shape.body.insertText('Hello', 'End');
        try {
          await context.sync();
        } catch (error) {
          return error;
        }
        return null;
      });
      expect(failure).toBeInstanceOf(DocxEditorError);
      expect((failure as DocxEditorError).code).toBe('InvalidArgument');
      expect((failure as DocxEditorError).debugInfo.innerError).toMatchObject({
        code: 'edit.unsupported-story',
      });
      const xml = strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
      expect(xml).not.toContain('Hello');
    } finally {
      runtime.dispose();
    }
  });
});
