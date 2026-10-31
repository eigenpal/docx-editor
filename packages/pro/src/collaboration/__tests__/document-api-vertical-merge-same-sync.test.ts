/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A vertical merge edited in the same sync, between two participants.
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

const p = (text: string) => (text ? `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` : '<w:p/>');
const row = (a: string, b: string) => `<w:tr><w:tc>${p(a)}</w:tc><w:tc>${p(b)}</w:tc></w:tr>`;
const fixture = zipDocument(
  `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>${row('a', 'b')}${row('', 'd')}${row('e', 'f')}</w:tbl>${p('Tail')}`
);

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
    documentId: 'api-vertical-merge-same-sync',
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

async function converged(a: Peer, b: Peer) {
  expect(canonicalOoxmlFingerprint(await main(a))).toBe(canonicalOoxmlFingerprint(await main(b)));
}

/** The saved table's cells by row, with `^` for a merge start and `|` for its continuation. */
async function cells(peer: Peer): Promise<string[]> {
  const xml = strFromU8(unzipSync(new Uint8Array(await peer.editor.save()))['word/document.xml']!);
  const rows = xml.match(/<w:tr(?: [^>]*)?>[\s\S]*?<\/w:tr>/g) ?? [];
  return rows.map((tr) =>
    (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? [])
      .map((tc) => {
        const text = [...tc.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)]
          .map((match) => match[1])
          .join('');
        const mark = tc.includes('w:vMerge w:val="restart"')
          ? '^'
          : tc.includes('<w:vMerge')
            ? '|'
            : '';
        return (text || '_') + mark;
      })
      .join(' ')
  );
}

test('the merge and its edits replicate beside concurrent typing, undo, and redo', async () => {
  const alice = await peer('Alice');
  const bob = await peer('Bob', alice);
  await alice.runtime.run(async (context) => {
    const table = context.document.body.tables.getFirst();
    const merged = table.mergeCells(0, 0, 1, 0);
    merged.value = 'merged';
    merged.verticalAlignment = 'Center';
    merged.shadingColor = '#FFEE00';
    await context.sync();
  });
  await bob.runtime.run(async (context) => {
    context.document.body.tables.getFirst().getCell(2, 1).body.insertText(' typed', 'End');
    await context.sync();
  });
  sync(alice, bob);
  const expected = ['merged^ b', '_| d', 'e f typed'];
  expect(await cells(alice)).toEqual(expected);
  expect(await cells(bob)).toEqual(expected);
  const xml = strFromU8(unzipSync(new Uint8Array(await bob.editor.save()))['word/document.xml']!);
  expect(xml.match(/<w:vAlign w:val="center"\/>/g)?.length).toBe(2);
  expect(xml.match(/w:fill="FFEE00"/g)?.length).toBe(2);
  await converged(alice, bob);

  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  sync(alice, bob);
  expect(await cells(bob)).toEqual(['a b', '_ d', 'e f typed']);
  expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
  sync(alice, bob);
  expect(await cells(bob)).toEqual(expected);
  await converged(alice, bob);
});

test('a participant typing into the lower cell while the merge lands converges', async () => {
  const alice = await peer('Alice');
  const bob = await peer('Bob', alice);
  await bob.runtime.run(async (context) => {
    context.document.body.tables.getFirst().getCell(1, 0).value = 'late';
    await context.sync();
  });
  await alice.runtime.run(async (context) => {
    const merged = context.document.body.tables.getFirst().mergeCells(0, 0, 1, 0);
    merged.value = 'merged';
    merged.verticalAlignment = 'Bottom';
    await context.sync();
  });
  sync(alice, bob);
  sync(alice, bob);
  await converged(alice, bob);
  expect((await cells(bob))[0]).toBe('merged^ b');
});
