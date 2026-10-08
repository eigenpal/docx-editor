/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import {
  readOoxmlPackage,
  canonicalOoxmlFingerprint,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { collaborationDocx } from './support.ts';

const files = unzipSync(collaborationDocx());
const shape =
  '<w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" style="position:absolute;left:12pt;top:18pt;width:0pt;height:18pt;" coordsize="0,360" path="m0,360l0,0e" filled="false" strokeweight="1pt"/></w:pict>';
files['word/document.xml'] = strToU8(
  strFromU8(files['word/document.xml']!).replace('</w:p>', '<w:r>' + shape + '</w:r></w:p>')
);
const fixture = zipSync(files);

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc(),
    awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'zero-extent-vml',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: fixture },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: room.document,
    modules: [collaborationModule({ session: room.session })],
  });
  return {
    ydoc,
    room,
    editor,
    container,
    destroy() {
      editor.destroy();
      container.remove();
      room.destroy();
      awareness.destroy();
      ydoc.destroy();
    },
  };
}
type Peer = Awaited<ReturnType<typeof peer>>;
function sync(a: Peer, b: Peer) {
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc)), 'relay');
  Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc, Y.encodeStateVector(a.ydoc)), 'relay');
}
async function main(peer: Peer) {
  const loaded = readOoxmlPackage(new Uint8Array(await peer.editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package.parts.get(loaded.package.mainDocumentPart)!;
}
async function verify(a: Peer, b: Peer) {
  const left = await main(a),
    right = await main(b);
  expect(canonicalOoxmlFingerprint(left)).toBe(canonicalOoxmlFingerprint(right));
  expect(serializeOoxmlPart(left)).toContain('width:0pt;height:18pt;');
  expect(serializeOoxmlPart(left)).toContain('path="m0,360l0,0e"');
}
test('two editors keep zero-extent VML through concurrent prose edits, undo and reconnect', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  let rejoined: Peer | undefined;
  try {
    for (const [client, text] of [
      [a, 'A'],
      [b, 'B'],
    ] as const) {
      expect(client.container.querySelector('.docx-drawing-shape')).not.toBeNull();
      expect(
        client.editor.surface!.setSelection({
          anchor: { paragraphId: client.editor.surface!.session.paragraphIds()[0]!, offset: 0 },
          head: { paragraphId: client.editor.surface!.session.paragraphIds()[0]!, offset: 0 },
        })
      ).not.toBe(false);
      expect(client.editor.exec({ type: 'insertText', text })).toMatchObject({
        ok: true,
        changed: true,
      });
    }
    sync(a, b);
    await verify(a, b);
    const concurrentXml = serializeOoxmlPart(await main(a));
    const concurrentText = [...concurrentXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
      .map((match) => match[1])
      .join('');
    expect(concurrentText).toMatch(/^(AB|BA)Alpha paragraph/);
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await verify(a, b);
    const undoText = [
      ...serializeOoxmlPart(await main(a)).matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g),
    ]
      .map((match) => match[1])
      .join('');
    expect(undoText).toBe(concurrentText.replace(/^(AB|BA)/, 'B'));
    expect(a.editor.exec({ type: 'redo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await verify(a, b);
    const redoText = [
      ...serializeOoxmlPart(await main(a)).matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g),
    ]
      .map((match) => match[1])
      .join('');
    expect(redoText).toBe(concurrentText);
    a.editor.surface!.setSelection({
      anchor: { paragraphId: a.editor.surface!.session.paragraphIds()[0]!, offset: 1 },
      head: { paragraphId: a.editor.surface!.session.paragraphIds()[0]!, offset: 3 },
    });
    expect(a.editor.surface!.deleteSelection()).toBe(true);
    expect(
      b.editor.surface!.setSelection({
        anchor: { paragraphId: b.editor.surface!.session.paragraphIds()[0]!, offset: 2 },
        head: { paragraphId: b.editor.surface!.session.paragraphIds()[0]!, offset: 2 },
      })
    ).not.toBe(false);
    expect(b.editor.exec({ type: 'insertText', text: ' concurrent' })).toMatchObject({
      ok: true,
      changed: true,
    });
    sync(a, b);
    await verify(a, b);
    rejoined = await peer('Rejoined', a);
    await verify(a, rejoined);
  } finally {
    rejoined?.destroy();
    a.destroy();
    b.destroy();
  }
});
