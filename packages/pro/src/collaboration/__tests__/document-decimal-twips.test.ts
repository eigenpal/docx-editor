/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Decimal twips values (`w:pos="1440.5"`, `w:w="2000.6"`) read as truncated whole twips. An
// edit that rewrites one writes the whole value, which every participant already reads. These
// cases pin that two collaborating editors converge on the rewritten values through
// concurrent typing, undo, redo, reconnect, and save and reopen.
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

const p = (text: string, pPr = '') => `<w:p>${pPr}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const fixture = zipDocument(
  p('alpha', '<w:pPr><w:tabs><w:tab w:val="left" w:pos="1440.5"/></w:tabs></w:pPr>') +
    '<w:tbl><w:tblGrid><w:gridCol w:w="2000.6"/><w:gridCol w:w="2000.6"/></w:tblGrid>' +
    `<w:tr><w:tc>${p('A')}</w:tc><w:tc>${p('B')}</w:tc></w:tr></w:tbl>` +
    p('Tail')
);

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'decimal-twips',
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

async function mainXml(peer: Peer) {
  const loaded = readOoxmlPackage(new Uint8Array(await peer.editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  return { fingerprint: canonicalOoxmlFingerprint(main), xml: serializeOoxmlPart(main) };
}

async function converged(a: Peer, b: Peer): Promise<string> {
  const [left, right] = [await mainXml(a), await mainXml(b)];
  expect(left.fingerprint).toBe(right.fingerprint);
  return left.xml;
}

function selectStart(peer: Peer, index: number) {
  const surface = peer.editor.surface!;
  const id = surface.session.paragraphIds()[index]!;
  surface.setSelection({
    anchor: { paragraphId: id, offset: 0 },
    head: { paragraphId: id, offset: 0 },
  });
}

test('a decimal tab stop edit converges through concurrent typing, undo, redo and reconnect', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  expect(a.editor.surface!.formatting().tabStops).toEqual([
    { positionTwips: 1440, alignment: 'left' },
  ]);

  selectStart(a, 0);
  selectStart(b, 0);
  const edited = a.editor.exec({
    type: 'setParagraphFormat',
    tabStops: [
      { positionTwips: 1440, alignment: 'center' },
      { positionTwips: 2880, alignment: 'right' },
    ],
  });
  expect(edited.ok).toBe(true);
  expect(b.editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
  sync(a, b);
  const after = await converged(a, b);
  expect(after).not.toContain('1440.5');
  expect(after).toContain('w:pos="1440" w:val="center"');
  expect(after).toContain('Xalpha');

  expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
  sync(a, b);
  const undone = await converged(a, b);
  expect(undone).toContain('w:pos="1440.5"');
  expect(undone).toContain('Xalpha');

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

test('a column inserted next to a decimal grid width converges with whole twips', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  selectStart(a, 1);
  selectStart(b, 2);
  expect(a.editor.exec({ type: 'insertColumn', where: 'right' }).ok).toBe(true);
  expect(b.editor.exec({ type: 'insertText', text: 'Y' }).ok).toBe(true);
  sync(a, b);
  const after = await converged(a, b);
  expect(after).toContain('YB');
  expect([...after.matchAll(/<w:gridCol w:w="([^"]+)"/g)].map((match) => match[1])).toEqual([
    '2000.6',
    '2000',
    '2000.6',
  ]);

  expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
  sync(a, b);
  expect([...(await converged(a, b)).matchAll(/<w:gridCol /g)]).toHaveLength(2);
  expect(a.editor.exec({ type: 'redo' }).ok).toBe(true);
  sync(a, b);
  expect(await converged(a, b)).toBe(after);
});
