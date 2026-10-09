/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Tab over a selection of whole paragraphs indents them and keeps the text. The indent is an
// ordinary paragraph property write, so two collaborating editors must converge on it through
// concurrent typing, undo, redo, a remote deletion, reconnect, and save and reopen.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { afterEach, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPackage,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { zipDocument } from './document-peer-support.ts';

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const fixture = zipDocument(p('Alpha beta') + p('Second line') + p('Tail'));

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'tab-selection-indent',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: fixture },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: room.document,
    modules: [collaborationModule({ session: room.session })],
    author: name,
  });
  const destroy = () => {
    editor.destroy();
    container.remove();
    room.destroy();
    awareness.destroy();
    ydoc.destroy();
  };
  opened.push(destroy);
  return { ydoc, editor, destroy };
}
type Peer = Awaited<ReturnType<typeof peer>>;

const opened: (() => void)[] = [];
afterEach(() => {
  for (const destroy of opened.splice(0)) destroy();
});

function sync(a: Peer, b: Peer) {
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc)), 'relay');
  Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc, Y.encodeStateVector(a.ydoc)), 'relay');
}

async function converged(a: Peer, b: Peer): Promise<string> {
  const xml = async (peer: Peer) => {
    const loaded = readOoxmlPackage(new Uint8Array(await peer.editor.save()));
    if (!loaded.ok) throw new Error(loaded.reason);
    const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    return { fingerprint: canonicalOoxmlFingerprint(main), xml: serializeOoxmlPart(main) };
  };
  const [left, right] = [await xml(a), await xml(b)];
  expect(left.fingerprint).toBe(right.fingerprint);
  return left.xml;
}

function select(peer: Peer, from: [number, number], to: [number, number]) {
  const surface = peer.editor.surface!;
  const ids = surface.session.paragraphIds();
  surface.setSelection({
    anchor: { paragraphId: ids[from[0]]!, offset: from[1] },
    head: { paragraphId: ids[to[0]]!, offset: to[1] },
  });
}

const indents = (xml: string) => [...xml.matchAll(/<w:ind [^>]*\/>/g)].map((match) => match[0]);

test('Tab over two paragraphs converges through typing, undo, redo and reconnect', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);

  select(a, [0, 2], [1, 3]);
  select(b, [2, 0], [2, 0]);
  expect(a.editor.surface!.indentWithTab()).toBe(true);
  expect(b.editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
  sync(a, b);
  const after = await converged(a, b);
  expect(after).toContain('Alpha beta');
  expect(after).toContain('Second line');
  expect(after).toContain('XTail');
  expect(indents(after)).toHaveLength(2);
  expect(indents(after).every((ind) => ind.includes('w:left="720"'))).toBe(true);

  expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
  sync(a, b);
  const undone = await converged(a, b);
  expect(indents(undone)).toHaveLength(0);
  expect(undone).toContain('XTail');

  expect(a.editor.exec({ type: 'redo' }).ok).toBe(true);
  sync(a, b);
  expect(await converged(a, b)).toBe(after);

  // Bob disconnects and reconnects from his own saved state.
  const saved = new Y.Doc();
  Y.applyUpdate(saved, Y.encodeStateAsUpdate(b.ydoc));
  b.destroy();
  opened.splice(opened.indexOf(b.destroy), 1);
  const reconnected = await peer('Bob', { ydoc: saved });
  saved.destroy();
  expect(await converged(a, reconnected)).toBe(after);
});

test('a first-line indent from Tab converges with a remote deletion in the paragraph', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);

  select(a, [0, 0], [0, 10]);
  select(b, [0, 5], [0, 10]);
  expect(a.editor.surface!.indentWithTab()).toBe(true);
  b.editor.surface!.deleteBackward();
  sync(a, b);
  const after = await converged(a, b);
  expect(after).toContain('Alpha');
  expect(after).not.toContain('beta');
  expect(indents(after)).toEqual([expect.stringContaining('w:firstLine="720"')]);

  const reopened = readOoxmlPackage(new Uint8Array(await a.editor.save()));
  expect(reopened.ok).toBe(true);
});
