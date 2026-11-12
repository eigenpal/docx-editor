/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A body that a file ends with a table reads an empty paragraph after it. Two participants:
// both see it, type into it beside typing in the table, undo and redo, delete the table while
// the other types below it, and save a file that reopens with one paragraph after the table.
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

const cell = (text: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
// No paragraph after the table, as some generators write it.
const fixture = zipDocument(
  `<w:p><w:r><w:t>Lead</w:t></w:r></w:p>` +
    `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
    `<w:tr>${cell('a')}${cell('b')}</w:tr></w:tbl>`
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
    documentId: 'story-end-paragraph',
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

const saved = async (created: Peer) => new Uint8Array(await created.editor.save());

async function fingerprint(created: Peer) {
  const loaded = readOoxmlPackage(await saved(created));
  if (!loaded.ok) throw new Error(loaded.reason);
  return canonicalOoxmlFingerprint(loaded.package.parts.get(loaded.package.mainDocumentPart)!);
}

/** The body's top-level blocks as saved: `p:text` for a paragraph, `tbl` for a table. */
async function blocks(created: Peer): Promise<string[]> {
  const xml = strFromU8(unzipSync(await saved(created))['word/document.xml']!);
  const body = xml.slice(xml.indexOf('<w:body>') + 8, xml.lastIndexOf('<w:sectPr'));
  const out: string[] = [];
  for (const match of body.matchAll(
    /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g
  )) {
    const block = match[0];
    if (block.startsWith('<w:tbl>')) out.push('tbl');
    else
      out.push(
        `p:${[...block.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')}`
      );
  }
  return out;
}

/** Plain paragraph texts through the editing API, cells included. */
async function texts(created: Peer): Promise<string[]> {
  return created.runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items/text');
    await context.sync();
    return paragraphs.items.map((paragraph) => paragraph.text);
  });
}

test('both participants type below the table and in it, through undo, redo and reopen', async () => {
  const alice = await peer('Alice');
  const bob = await peer('Bob', alice);
  expect(await blocks(alice)).toEqual(['p:Lead', 'tbl', 'p:']);
  expect(await texts(bob)).toEqual(['Lead', 'a', 'b', '']);

  await alice.runtime.run(async (context) => {
    context.document.body.paragraphs.getLast().insertText('below', 'End');
    await context.sync();
  });
  await bob.runtime.run(async (context) => {
    context.document.body.tables.getFirst().getCell(0, 0).body.insertText(' typed', 'End');
    await context.sync();
  });
  sync(alice, bob);
  expect(await texts(alice)).toEqual(['Lead', 'a typed', 'b', 'below']);
  expect(await texts(bob)).toEqual(await texts(alice));
  expect(await fingerprint(alice)).toBe(await fingerprint(bob));

  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  sync(alice, bob);
  expect(await texts(bob)).toEqual(['Lead', 'a typed', 'b', '']);
  expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
  sync(alice, bob);
  expect(await texts(bob)).toEqual(['Lead', 'a typed', 'b', 'below']);

  // The saved file holds the paragraph, so a reopen reads one paragraph, not a second.
  const reopened = await peer('Carol', undefined, await saved(bob));
  expect(await blocks(reopened)).toEqual(['p:Lead', 'tbl', 'p:below']);
  expect(await fingerprint(reopened)).toBe(await fingerprint(bob));
});

test('deleting the table while the other participant types below it keeps the text', async () => {
  const alice = await peer('Alice');
  const bob = await peer('Bob', alice);
  await alice.runtime.run(async (context) => {
    context.document.body.tables.getFirst().delete();
    await context.sync();
  });
  await bob.runtime.run(async (context) => {
    context.document.body.paragraphs.getLast().insertText('kept', 'End');
    await context.sync();
  });
  sync(alice, bob);
  expect(await blocks(alice)).toEqual(['p:Lead', 'p:kept']);
  expect(await blocks(bob)).toEqual(await blocks(alice));
  expect(await fingerprint(alice)).toBe(await fingerprint(bob));
});

test('the paragraph after the final table refuses deletion on either participant', async () => {
  const alice = await peer('Alice');
  const bob = await peer('Bob', alice);
  const refusal = await bob.runtime
    .run(async (context) => {
      context.document.body.paragraphs.getLast().delete();
      await context.sync();
    })
    .then(
      () => null,
      (error: { code?: string; debugInfo?: { innerError?: { code?: string } } }) => [
        error.code,
        error.debugInfo?.innerError?.code,
      ]
    );
  expect(refusal).toEqual(['NotSupported', 'edit.operation-unsupported']);
  sync(alice, bob);
  expect(await blocks(alice)).toEqual(['p:Lead', 'tbl', 'p:']);
  expect(await fingerprint(alice)).toBe(await fingerprint(bob));
});
