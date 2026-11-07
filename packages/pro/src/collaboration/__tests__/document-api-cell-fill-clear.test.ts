/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Clearing a cell fill removes its whole `w:shd`, so the table style shows again. Two
// participants: the clear replicates beside typing in the same cell, undoes, and survives
// save and reopen.
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

const shaded = (text: string) =>
  `<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="FFEE00"/></w:tcPr>` +
  `<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const fixture = zipDocument(
  `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
    `<w:tr>${shaded('a')}${shaded('b')}</w:tr></w:tbl><w:p><w:r><w:t>Tail</w:t></w:r></w:p>`
);

const peers: { destroy(): void }[] = [];
afterEach(() => {
  for (const created of peers.splice(0)) created.destroy();
});

async function peer(name: string, host?: { ydoc: Y.Doc }, document_ = fixture) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'api-cell-fill-clear',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: document_ },
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

async function saved(created: Peer) {
  return new Uint8Array(await created.editor.save());
}

/** Each cell of the saved table as its text plus its `w:shd` fill, or `-` with no `w:shd`. */
async function cells(created: Peer): Promise<string[]> {
  const xml = strFromU8(unzipSync(await saved(created))['word/document.xml']!);
  return (xml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map((tc) => {
    const text = [...tc.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
    const shd = tc.match(/<w:shd [^>]*\/>/)?.[0];
    return `${text}:${shd ? (shd.match(/w:fill="([^"]*)"/)?.[1] ?? 'none') : '-'}`;
  });
}

async function fingerprint(created: Peer) {
  const loaded = readOoxmlPackage(await saved(created));
  if (!loaded.ok) throw new Error(loaded.reason);
  return canonicalOoxmlFingerprint(loaded.package.parts.get(loaded.package.mainDocumentPart)!);
}

const FILL = 'FFEE00';

test('a cleared fill replicates beside typing in the same cell, undoes, and reopens', async () => {
  const alice = await peer('Alice');
  const bob = await peer('Bob', alice);
  await alice.runtime.run(async (context) => {
    context.document.body.tables.getFirst().getCell(0, 0).shadingColor = 'auto';
    await context.sync();
  });
  await bob.runtime.run(async (context) => {
    context.document.body.tables.getFirst().getCell(0, 0).body.insertText(' typed', 'End');
    await context.sync();
  });
  sync(alice, bob);
  const expected = ['a typed:-', `b:${FILL}`];
  expect(await cells(alice)).toEqual(expected);
  expect(await cells(bob)).toEqual(expected);
  expect(await fingerprint(alice)).toBe(await fingerprint(bob));

  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  sync(alice, bob);
  expect(await cells(bob)).toEqual([`a typed:${FILL}`, `b:${FILL}`]);
  expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
  sync(alice, bob);
  expect(await cells(bob)).toEqual(expected);
  expect(await fingerprint(alice)).toBe(await fingerprint(bob));

  // Save and reopen as a fresh room: the cell stays without shading.
  const reopened = await peer('Carol', undefined, await saved(bob));
  expect(await cells(reopened)).toEqual(expected);
});

test('a cleared fill and a concurrent new fill of the same cell converge on one', async () => {
  const alice = await peer('Alice');
  const bob = await peer('Bob', alice);
  await alice.runtime.run(async (context) => {
    context.document.body.tables.getFirst().getCell(0, 0).shadingColor = 'auto';
    await context.sync();
  });
  await bob.runtime.run(async (context) => {
    context.document.body.tables.getFirst().getCell(0, 0).shadingColor = '#00FF00';
    await context.sync();
  });
  sync(alice, bob);
  expect(await fingerprint(alice)).toBe(await fingerprint(bob));
  // One of the two writes wins whole: never a mix, never the original fill.
  expect(['a:-', 'a:00FF00']).toContain((await cells(bob))[0]!);
  expect((await cells(bob))[1]).toBe(`b:${FILL}`);
});

test('an undo of a fill while the other participant clears it converges', async () => {
  const alice = await peer('Alice');
  const bob = await peer('Bob', alice);
  await bob.runtime.run(async (context) => {
    context.document.body.tables.getFirst().getCell(0, 0).shadingColor = '#00FF00';
    await context.sync();
  });
  sync(alice, bob);
  await alice.runtime.run(async (context) => {
    context.document.body.tables.getFirst().getCell(0, 0).shadingColor = 'auto';
    await context.sync();
  });
  expect(bob.editor.exec({ type: 'undo' }).ok).toBe(true);
  sync(alice, bob);
  expect(await fingerprint(alice)).toBe(await fingerprint(bob));
  expect((await cells(alice))[0]).not.toBe('a:00FF00');
});

test('a cleared fill and the other participant emptying the cell converge', async () => {
  const alice = await peer('Alice');
  const bob = await peer('Bob', alice);
  await alice.runtime.run(async (context) => {
    context.document.body.tables.getFirst().getCell(0, 1).shadingColor = 'auto';
    await context.sync();
  });
  await bob.runtime.run(async (context) => {
    context.document.body.tables.getFirst().getCell(0, 1).value = '';
    await context.sync();
  });
  sync(alice, bob);
  expect(await fingerprint(alice)).toBe(await fingerprint(bob));
  expect((await cells(bob))[1]).toBe(':-');
});
