/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A paragraph inserted at the start of a body that opens with a table, between two participants.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { afterEach, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import { canonicalOoxmlFingerprint, readOoxmlPackage } from '@docx-editor.dev/core/store';
import { reviewModule } from '../../review/review-module.ts';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { zipDocument } from './document-peer-support.ts';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const fixture = zipDocument(`<w:tbl><w:tr><w:tc>${p('Cell')}</w:tc></w:tr></w:tbl>${p('Tail')}`);

const peers: { destroy(): void }[] = [];
afterEach(() => {
  for (const peer of peers.splice(0)) peer.destroy();
});

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'api-paragraph-beside-table',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: fixture },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: room.document,
    modules: [reviewModule(), collaborationModule({ session: room.session })],
    author: name,
  });
  const runtime = DocxEditor.createBrowser(editor, { author: name });
  const created = {
    ydoc,
    editor,
    runtime,
    destroy() {
      runtime.dispose();
      editor.destroy();
      container.remove();
      room.destroy();
      awareness.destroy();
      ydoc.destroy();
    },
  };
  peers.push(created);
  return created;
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

/** The saved body's blocks: a paragraph's text, or `[…]` with a table's text. */
async function blocks(peer: Peer): Promise<string[]> {
  const xml = strFromU8(unzipSync(new Uint8Array(await peer.editor.save()))['word/document.xml']!);
  const body = xml.slice(xml.indexOf('<w:body>') + 8, xml.indexOf('</w:body>'));
  const pattern = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?: [^>]*)?\/>|<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g;
  const text = (block: string) =>
    (block.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g) ?? [])
      .map((t) => t.replace(/<[^>]+>/g, ''))
      .join('');
  return (body.match(pattern) ?? []).map((block) =>
    block.startsWith('<w:tbl>') ? `[${text(block)}]` : text(block)
  );
}

async function converged(a: Peer, b: Peer) {
  expect(canonicalOoxmlFingerprint(await main(a))).toBe(canonicalOoxmlFingerprint(await main(b)));
}

test('the paragraph replicates, survives concurrent cell typing, and undoes', async () => {
  const alice = await peer('Alice');
  const bob = await peer('Bob', alice);
  await alice.runtime.run(async (context) => {
    context.document.body.insertParagraph('Lead', 'Start');
    await context.sync();
  });
  await bob.runtime.run(async (context) => {
    context.document.body.tables.getFirst().getCell(0, 0).body.insertText(' typed', 'End');
    await context.sync();
  });
  sync(alice, bob);
  expect(await blocks(alice)).toEqual(['Lead', '[Cell typed]', 'Tail']);
  expect(await blocks(bob)).toEqual(['Lead', '[Cell typed]', 'Tail']);
  await converged(alice, bob);

  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  sync(alice, bob);
  expect(await blocks(bob)).toEqual(['[Cell typed]', 'Tail']);
  expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
  sync(alice, bob);
  expect(await blocks(bob)).toEqual(['Lead', '[Cell typed]', 'Tail']);
  await converged(alice, bob);

  // Saved and opened again, the paragraph stays before the table.
  const reopened = readOoxmlPackage(new Uint8Array(await bob.editor.save()));
  expect(reopened.ok).toBe(true);
});

test('a proposed paragraph replicates and the other participant can reject it', async () => {
  const alice = await peer('Alice');
  const bob = await peer('Bob', alice);
  await alice.runtime.run(async (context) => {
    context.document.changeTrackingMode = 'TrackMineOnly';
    context.document.body.insertParagraph('Lead', 'Start');
    await context.sync();
  });
  sync(alice, bob);
  expect(await blocks(bob)).toEqual(['Lead', '[Cell]', 'Tail']);
  await bob.runtime.run(async (context) => {
    context.document.body.revisions.rejectAll();
    await context.sync();
  });
  sync(alice, bob);
  expect(await blocks(alice)).toEqual(['[Cell]', 'Tail']);
  await converged(alice, bob);
});
