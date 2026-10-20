/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An equation proposed through insertOoxml, across two live peers.
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import {
  DocxEditor,
  type DocxEditorRuntime,
  type RequestContext,
} from '@docx-editor.dev/editor-api/browser';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness, zipDocument } from './document-peer-support';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

const OBJECT = '￼';
const EQUATION =
  '<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">' +
  '<pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml">' +
  '<pkg:xmlData><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><w:p>' +
  '<m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup>' +
  '</m:sSup></m:oMath></w:p></w:body></w:document></pkg:xmlData></pkg:part></pkg:package>';

const SAMPLE = () =>
  zipDocument(
    '<w:p><w:r><w:t xml:space="preserve">Let x be real.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Second paragraph.</w:t></w:r></w:p>'
  );

async function room() {
  const harness = createPeerHarness('tracked-equation', { offlineEditing: true });
  const pair = await harness.pair(SAMPLE());
  const peers = [pair.alice, pair.bob].map((peer, index) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    const author = index === 0 ? 'Math agent' : 'Reviewer';
    return { ...peer, editor, runtime: DocxEditor.createBrowser(editor, { author }), container };
  });
  return {
    pair,
    harness,
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

async function bodyText(c: RequestContext): Promise<string> {
  c.document.body.load('text');
  await c.sync();
  return c.document.body.text;
}

async function proposeEquation(runtime: DocxEditorRuntime): Promise<void> {
  await runtime.run(async (c) => {
    c.document.changeTrackingMode = 'TrackMineOnly';
    c.document.body.search('x').getFirst().insertOoxml(EQUATION, 'After');
    await c.sync();
  });
}

const documentXml = async (editor: { save(): Promise<ArrayBuffer | Uint8Array> }) =>
  strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);

test('a tracked equation converges with a concurrent edit, survives reconnect, and rejects on the other peer', async () => {
  const r = await room();
  try {
    r.pair.pause();
    await proposeEquation(r.peers[0]!.runtime);
    await r.peers[1]!.runtime.run(async (c) => {
      c.document.body.search('real').getFirst().insertText('very ', 'Before');
      c.document.body.paragraphs.getLast().insertText(' Edited.', 'End');
      await c.sync();
    });
    r.sync();
    r.pair.resume();
    r.sync();
    const texts = r.peers.map((peer) => peer.editor.surface!.session.bodyText());
    expect(texts[0]).toBe(texts[1]);
    for (const peer of r.peers) {
      await peer.runtime.run(async (c) => {
        expect(await bodyText(c)).toBe(`Let x${OBJECT} be very real.\rSecond paragraph. Edited.`);
      });
      const xml = await documentXml(peer.editor);
      expect(xml).toMatch(/<w:ins [^>]*w:author="Math agent"[^>]*><m:oMath>/);
      const reopened = await DocxEditor.createServer(new Uint8Array(await peer.editor.save()));
      try {
        await reopened.run(async (c) => {
          expect(await bodyText(c)).toBe(`Let x${OBJECT} be very real.\rSecond paragraph. Edited.`);
        });
      } finally {
        reopened.dispose();
      }
    }
    const rejoined = await r.harness.join(r.pair.alice, 'equation-rejoined');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const joined = createDocxEditor({
      container,
      document: rejoined.room.document,
      modules: [reviewModule(), collaborationModule({ session: rejoined.room.session })],
    });
    const joinedRuntime = DocxEditor.createBrowser(joined);
    try {
      await joinedRuntime.run(async (c) => {
        expect(await bodyText(c)).toContain(`x${OBJECT}`);
        c.document.body.revisions.load('items');
        await c.sync();
        expect(c.document.body.revisions.items.length).toBeGreaterThan(0);
      });
    } finally {
      joinedRuntime.dispose();
      joined.destroy();
      container.remove();
      r.harness.leave(rejoined);
    }
    await r.peers[1]!.runtime.run(async (c) => {
      c.document.body.revisions.rejectAll();
      await c.sync();
    });
    r.sync();
    for (const peer of r.peers) {
      await peer.runtime.run(async (c) => {
        expect(await bodyText(c)).toBe('Let x be very real.\rSecond paragraph. Edited.');
      });
      const xml = await documentXml(peer.editor);
      expect(xml).not.toContain('oMath');
      expect(xml).not.toMatch(/<w:ins[ >]/);
    }
  } finally {
    r.close();
  }
});

test('accept on the other peer keeps the equation on both replicas', async () => {
  const r = await room();
  try {
    await proposeEquation(r.peers[0]!.runtime);
    r.sync();
    await r.peers[1]!.runtime.run(async (c) => {
      c.document.body.revisions.acceptAll();
      await c.sync();
    });
    r.sync();
    for (const peer of r.peers) {
      const xml = await documentXml(peer.editor);
      expect(xml).toContain('<m:oMath>');
      expect(xml).not.toMatch(/<w:ins[ >]/);
    }
  } finally {
    r.close();
  }
});

test('deleting the words around a pending equation on the other peer keeps both replicas equal', async () => {
  const r = await room();
  try {
    r.pair.pause();
    await proposeEquation(r.peers[0]!.runtime);
    await r.peers[1]!.runtime.run(async (c) => {
      c.document.body.search('Let x be').getFirst().delete();
      await c.sync();
    });
    r.sync();
    r.pair.resume();
    r.sync();
    const texts = r.peers.map((peer) => peer.editor.surface!.session.bodyText());
    expect(texts[0]).toBe(texts[1]);
    const read = await Promise.all(r.peers.map((peer) => peer.runtime.run(bodyText)));
    expect(read[0]).toBe(read[1]);
    expect(read[0]).toContain(OBJECT);
  } finally {
    r.close();
  }
});

test('undo and redo of a tracked equation replicate', async () => {
  const r = await room();
  try {
    await proposeEquation(r.peers[0]!.runtime);
    r.sync();
    expect(r.peers[0]!.editor.exec({ type: 'undo' }).ok).toBe(true);
    r.sync();
    for (const peer of r.peers)
      await peer.runtime.run(async (c) => {
        expect(await bodyText(c)).toBe('Let x be real.\rSecond paragraph.');
      });
    expect(r.peers[0]!.editor.exec({ type: 'redo' }).ok).toBe(true);
    r.sync();
    for (const peer of r.peers)
      await peer.runtime.run(async (c) => {
        expect(await bodyText(c)).toBe(`Let x${OBJECT} be real.\rSecond paragraph.`);
      });
  } finally {
    r.close();
  }
});
