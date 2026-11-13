/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `replaceAcceptedText` between two editors in one shared room.
//
// The command commits plain text ops through the surface's ordinary lane, so the session sees
// ordinary edits. A fix to a word that another author's tracked deletion splits must converge
// with that deletion still in the word, undo and redo must travel, a joining peer must reopen
// the same document, and concurrent edits and deletions must converge.

import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPackage,
  revisionItemsOf,
} from '@docx-editor.dev/core/store';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createDocumentCollaboration } from '../document-session.ts';
import { zipDocument } from './document-peer-support.ts';

const fixture = zipDocument(
  '<w:p><w:r><w:t xml:space="preserve">The agre</w:t></w:r>' +
    '<w:del w:id="1" w:author="Reviewer" w:date="2026-10-07T00:00:00Z"><w:r><w:delText>e</w:delText></w:r></w:del>' +
    '<w:r><w:t xml:space="preserve">ment holds.</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Second paragraph.</w:t></w:r></w:p>'
);

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'replace-accepted-text',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: fixture },
    offlineEditing: true,
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: room.document,
    author: name,
    modules: [reviewModule(), collaborationModule({ session: room.session })],
  });
  return {
    ydoc,
    room,
    editor,
    close() {
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
  a.room.session.flushPendingJournals();
  b.room.session.flushPendingJournals();
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc)), 'relay');
  Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc, Y.encodeStateVector(a.ydoc)), 'relay');
}

async function savedPart(peer: Peer) {
  const result = readOoxmlPackage(new Uint8Array(await peer.editor.save()));
  if (!result.ok) throw new Error(result.reason);
  return result.package.parts.get(result.package.mainDocumentPart)!;
}

async function converged(a: Peer, b: Peer) {
  expect(canonicalOoxmlFingerprint(await savedPart(a))).toBe(
    canonicalOoxmlFingerprint(await savedPart(b))
  );
}

async function revisions(peer: Peer) {
  return revisionItemsOf(await savedPart(peer))
    .map((item) => `${item.revisionKind} ${item.author}`)
    .sort();
}

const first = (peer: Peer) => peer.editor.getParagraphs()[0]!;

/** Fix "agrement" (accepted text 4 to 12) to "agreement". */
function fix(peer: Peer, expectedText = 'agrement') {
  return peer.editor.exec({
    type: 'replaceAcceptedText',
    blockId: first(peer).blockId,
    start: 4,
    length: 8,
    text: 'agreement',
    expectedText,
  });
}

test('a fix synchronizes with the deletion still in the word, undoes, redoes, and reopens', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  let joined: Peer | undefined;
  try {
    expect(first(a).acceptedText).toBe('The agrement holds.');
    expect(fix(a)).toEqual({ ok: true, changed: true });
    sync(a, b);
    await converged(a, b);
    expect(first(b).acceptedText).toBe('The agreement holds.');
    // "agree" + the reviewer's deleted "e" + "ment": only one letter was written.
    expect(first(b).text).toBe('The agreeement holds.');
    expect(await revisions(b)).toEqual(['delete Reviewer']);

    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(first(b).acceptedText).toBe('The agrement holds.');
    expect(a.editor.exec({ type: 'redo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(first(b).acceptedText).toBe('The agreement holds.');

    joined = await peer('Carol', b);
    await converged(a, joined);
    expect(first(joined).acceptedText).toBe('The agreement holds.');
  } finally {
    joined?.close();
    b.close();
    a.close();
  }
});

test('a suggested fix is one tracked insertion that every peer sees', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    expect(a.editor.setEditingMode('suggesting').ok).toBe(true);
    expect(fix(a).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(await revisions(b)).toEqual(['delete Reviewer', 'insert Alice']);
    expect(first(b).acceptedText).toBe('The agreement holds.');
    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(await revisions(b)).toEqual(['delete Reviewer']);
  } finally {
    b.close();
    a.close();
  }
});

test('concurrent typing in the same paragraph survives a fix', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    const paragraphId = first(b).blockId;
    const end = { paragraphId, offset: first(b).text.length - 1 };
    b.editor.surface!.setSelection({ anchor: end, head: end });
    expect(b.editor.exec({ type: 'insertText', text: ' today' }).ok).toBe(true);
    expect(fix(a).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(first(a).acceptedText).toBe('The agreement holds today.');
  } finally {
    b.close();
    a.close();
  }
});

test('a peer deleting the paragraph while it is fixed converges, and a stale fix refuses', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    const [paragraph, second] = b.editor.getParagraphs();
    b.editor.surface!.setSelection({
      anchor: { paragraphId: paragraph!.blockId, offset: 0 },
      head: { paragraphId: second!.blockId, offset: 0 },
    });
    expect(b.editor.exec({ type: 'deleteText' }).ok).toBe(true);
    expect(fix(a).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    const texts = (peer: Peer) => peer.editor.getParagraphs().map((p) => p.acceptedText);
    expect(texts(a)).toEqual(texts(b));
    expect(texts(a).join('')).not.toContain('agre');
    // The fixed word is gone for both peers, so a second fix finds nothing to replace.
    const revision = a.editor.getDocumentHandle().revision;
    const again = a.editor.exec({
      type: 'replaceAcceptedText',
      blockId: paragraph!.blockId,
      start: 4,
      length: 9,
      text: 'agreement',
      expectedText: 'agreement',
    });
    expect(again).toMatchObject({ ok: false, code: 'notFound' });
    expect(a.editor.getDocumentHandle().revision).toBe(revision);
  } finally {
    b.close();
    a.close();
  }
});

test('a fix made stale by a remote edit refuses on the peer that issues it', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    const blockId = first(b).blockId;
    expect(
      b.editor.exec({
        type: 'replaceAcceptedText',
        blockId,
        start: 0,
        length: 3,
        text: 'This',
      }).ok
    ).toBe(true);
    sync(a, b);
    const before = first(a).text;
    expect(fix(a)).toMatchObject({ ok: false, code: 'notFound' });
    expect(first(a).text).toBe(before);
    // Read again, the fix lands for both peers.
    const at = first(a).acceptedText.indexOf('agrement');
    expect(
      a.editor.exec({
        type: 'replaceAcceptedText',
        blockId,
        start: at,
        length: 8,
        text: 'agreement',
        expectedText: 'agrement',
      }).ok
    ).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(first(b).acceptedText).toBe('This agreement holds.');
  } finally {
    b.close();
    a.close();
  }
});
