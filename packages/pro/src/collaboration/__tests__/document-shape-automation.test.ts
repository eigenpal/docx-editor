/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Text-box edits through `Shape.body` on two collaborating editors (issue #1070).
//
// The edit replicates as ordinary paragraph edits, and every peer saves the same bytes: the VML
// fallback follows the DrawingML story on export from canonical content alone.

import { afterAll, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor, ShapeType } from '@docx-editor.dev/editor-api/browser';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness, zipDocument } from './document-peer-support';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

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

async function room() {
  const harness = createPeerHarness('shape-automation', { offlineEditing: true });
  const pair = await harness.pair(zipDocument(`<w:p><w:r><w:t>Cover</w:t></w:r>${BOX}</w:p>`));
  const peers = [pair.alice, pair.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    return {
      ...peer,
      editor,
      runtime: DocxEditor.createBrowser(editor, { author: 'Writer' }),
      container,
    };
  });
  return {
    pair,
    peers,
    sync() {
      for (const peer of peers) peer.room.session.flushPendingJournals();
    },
    close() {
      for (const peer of peers) {
        peer.runtime.dispose();
        peer.editor.destroy();
        peer.container.remove();
      }
      harness.cleanup();
    },
  };
}

async function boxText(runtime: ReturnType<typeof DocxEditor.createBrowser>): Promise<string> {
  return runtime.run(async (context) => {
    const shapes = context.document.body.shapes.getByTypes([ShapeType.textBox]);
    shapes.load('items');
    await context.sync();
    const body = shapes.items[0]!.body;
    body.load('text');
    await context.sync();
    return body.text;
  });
}

test('a text box edit replicates, undoes, and saves the same synced bytes on every peer', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    await alice!.runtime.run(async (context) => {
      const shapes = context.document.body.shapes.getByTypes([ShapeType.textBox]);
      shapes.load('items');
      await context.sync();
      const body = shapes.items[0]!.body;
      body.load('text');
      await context.sync();
      const found = body.search('Acme Holdings');
      found.load('items');
      await context.sync();
      found.items[0]!.insertText('Beta Logistics', 'Replace');
      await context.sync();
    });
    r.sync();
    expect(await boxText(bob!.runtime)).toBe('Client: Beta Logistics');

    const saved = await Promise.all(
      r.peers.map(async (peer) => new Uint8Array(await peer.editor.save()))
    );
    const xml = saved.map((bytes) => strFromU8(unzipSync(bytes)['word/document.xml']!));
    expect(xml[0]).toBe(xml[1]!);
    expect(xml[0]!.match(/Beta Logistics/g)).toHaveLength(2);

    expect(alice!.editor.exec({ type: 'undo' }).ok).toBe(true);
    r.sync();
    expect(await boxText(bob!.runtime)).toBe('Client: Acme Holdings');
    expect(alice!.editor.exec({ type: 'redo' }).ok).toBe(true);
    r.sync();
    expect(await boxText(bob!.runtime)).toBe('Client: Beta Logistics');

    const reopened = await DocxEditor.createServer(saved[1]!);
    try {
      expect(await boxText(reopened as never)).toBe('Client: Beta Logistics');
    } finally {
      reopened.dispose();
    }
  } finally {
    r.close();
  }
});
