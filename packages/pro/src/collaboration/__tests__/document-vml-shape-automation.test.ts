/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Legacy VML text-box edits through `Shape.body` on two collaborating editors.
//
// A standalone `w:pict` text box is a story of its own. Its edits replicate as ordinary
// paragraph edits, converge with edits to the paragraph that anchors it, undo on the peer that
// made them, and review through the box's own body on every peer.

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

const BOX =
  '<w:r><w:pict xmlns:v="urn:schemas-microsoft-com:vml" ' +
  'xmlns:o="urn:schemas-microsoft-com:office:office"><v:shape id="Text Box 2" ' +
  'o:spid="_x0000_s1026" type="#_x0000_t202" style="position:absolute;margin-left:36pt;' +
  'margin-top:13pt;width:144pt;height:36pt"><v:textbox inset="0,0,0,0"><w:txbxContent><w:p>' +
  '<w:r><w:t>Client: Acme Holdings</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape>' +
  '</w:pict></w:r>';
const COVER = `<w:p><w:r><w:t>Cover</w:t></w:r>${BOX}</w:p>`;

async function room(bytes: Uint8Array = zipDocument(COVER)) {
  const harness = createPeerHarness('vml-shape-automation', { offlineEditing: true });
  const pair = await harness.pair(bytes);
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
    async saved() {
      return Promise.all(peers.map(async (peer) => new Uint8Array(await peer.editor.save())));
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

type Runtime = Pick<ReturnType<typeof DocxEditor.createBrowser>, 'run'>;

const xmlOf = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml']!);

async function boxText(runtime: Runtime): Promise<string | null> {
  return runtime.run(async (context) => {
    const shapes = context.document.body.shapes.getByTypes([ShapeType.textBox]);
    shapes.load('items');
    await context.sync();
    if (shapes.items.length === 0) return null;
    const body = shapes.items[0]!.body;
    body.load('text');
    await context.sync();
    return body.text;
  });
}

async function replaceInBox(runtime: Runtime, find: string, text: string): Promise<void> {
  await runtime.run(async (context) => {
    const shapes = context.document.body.shapes.getByTypes([ShapeType.textBox]);
    shapes.load('items');
    await context.sync();
    const body = shapes.items[0]!.body;
    body.load('text');
    await context.sync();
    const found = body.search(find);
    found.load('items');
    await context.sync();
    found.items[0]!.insertText(text, 'Replace');
    await context.sync();
  });
}

test('a VML box edit and an anchor paragraph edit made at once both survive', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    r.pair.pause();
    await replaceInBox(alice!.runtime, 'Acme Holdings', 'Beta Logistics');
    await bob!.runtime.run(async (context) => {
      context.document.body.paragraphs.getFirst().insertText('Front ', 'Start');
      await context.sync();
    });
    r.pair.resume();
    r.sync();
    for (const peer of r.peers) {
      expect(await boxText(peer.runtime)).toBe('Client: Beta Logistics');
      const text = await peer.runtime.run(async (context) => {
        const paragraph = context.document.body.paragraphs.getFirst();
        paragraph.load('text');
        await context.sync();
        return paragraph.text;
      });
      expect(text).toBe('Front Cover');
    }
    const xml = (await r.saved()).map(xmlOf);
    expect(xml[0]).toBe(xml[1]!);
    expect(xml[0]).toContain('<v:textbox inset="0,0,0,0"><w:txbxContent>');
    expect(xml[0]!.match(/Beta Logistics/g)).toHaveLength(1);
  } finally {
    r.close();
  }
});

test('deleting the anchor while the other peer types in the VML box converges', async () => {
  const r = await room(zipDocument(`${COVER}<w:p><w:r><w:t>Tail</w:t></w:r></w:p>`));
  try {
    const [alice, bob] = r.peers;
    r.pair.pause();
    await alice!.runtime.run(async (context) => {
      context.document.body.paragraphs.getFirst().delete();
      await context.sync();
    });
    await replaceInBox(bob!.runtime, 'Acme Holdings', 'Beta Logistics');
    r.pair.resume();
    r.sync();
    const texts = await Promise.all(r.peers.map((peer) => boxText(peer.runtime)));
    expect(texts[0]).toBe(texts[1]!);
    const xml = (await r.saved()).map(xmlOf);
    expect(xml[0]).toBe(xml[1]!);
  } finally {
    r.close();
  }
});

test('a VML box edit replicates, undoes, redoes, and reopens from the saved bytes', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    await replaceInBox(alice!.runtime, 'Acme Holdings', 'Beta Logistics');
    r.sync();
    expect(await boxText(bob!.runtime)).toBe('Client: Beta Logistics');
    expect(alice!.editor.exec({ type: 'undo' }).ok).toBe(true);
    r.sync();
    expect(await boxText(bob!.runtime)).toBe('Client: Acme Holdings');
    expect(alice!.editor.exec({ type: 'redo' }).ok).toBe(true);
    r.sync();
    expect(await boxText(bob!.runtime)).toBe('Client: Beta Logistics');

    const saved = await r.saved();
    expect(xmlOf(saved[0]!)).toBe(xmlOf(saved[1]!));
    const reopened = await DocxEditor.createServer(saved[1]!);
    try {
      expect(await boxText(reopened)).toBe('Client: Beta Logistics');
    } finally {
      reopened.dispose();
    }
  } finally {
    r.close();
  }
});

test('tracked changes in a VML box are reviewed through its body on every peer', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    await alice!.runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      await context.sync();
    });
    await replaceInBox(alice!.runtime, 'Acme', 'Beta');
    r.sync();
    const counts = async (runtime: Runtime) =>
      runtime.run(async (context) => {
        const shapes = context.document.body.shapes;
        shapes.load('items');
        await context.sync();
        const box = shapes.items[0]!.body;
        box.load('text');
        await context.sync();
        const inBody = context.document.body.revisions;
        const inBox = box.revisions;
        inBody.load('items');
        inBox.load('items');
        await context.sync();
        return [inBody.items.length, inBox.items.length];
      });
    const [, boxCount] = await counts(bob!.runtime);
    expect(boxCount).toBeGreaterThan(0);
    expect(await counts(alice!.runtime)).toEqual([0, boxCount]);
    await bob!.runtime.run(async (context) => {
      const shapes = context.document.body.shapes;
      shapes.load('items');
      await context.sync();
      const box = shapes.items[0]!.body;
      box.load('text');
      await context.sync();
      box.revisions.acceptAll();
      await context.sync();
    });
    r.sync();
    for (const peer of r.peers) {
      expect(await counts(peer.runtime)).toEqual([0, 0]);
      expect(await boxText(peer.runtime)).toBe('Client: Beta Holdings');
    }
    const xml = (await r.saved()).map(xmlOf);
    expect(xml[0]).toBe(xml[1]!);
    expect(xml[0]).not.toMatch(/<w:(ins|del)\b/);
  } finally {
    r.close();
  }
});
