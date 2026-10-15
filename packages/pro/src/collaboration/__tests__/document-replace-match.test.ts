/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A tracked `replaceMatch` between two editors in one shared room.
//
// The command writes through the surface's ordinary commit lane, so the collaboration session
// sees plain tracked text ops. Both peers must converge on the same strike and insertion, undo
// and redo must travel, a joining peer must reopen the same document, and concurrent edits in
// the same paragraph must survive.

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
  '<w:p><w:r><w:t>The supplier ships the goods.</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Second paragraph.</w:t></w:r></w:p>'
);

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'replace-match',
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
  return revisionItemsOf(await savedPart(peer)).map((item) => [item.revisionKind, item.author]);
}

function replace(peer: Peer, query: string, text: string) {
  const [match] = peer.editor.findMatches(query);
  if (!match) throw new Error(`no match for ${query}`);
  return peer.editor.exec({ type: 'replaceMatch', match, text });
}

test('a tracked replaceMatch synchronizes, undoes, redoes, and reopens', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  let joined: Peer | undefined;
  try {
    expect(a.editor.setEditingMode('suggesting').ok).toBe(true);
    const selection = a.editor.surface!.state().selection;
    expect(replace(a, 'supplier', 'vendor')).toEqual({ ok: true, changed: true });
    expect(a.editor.surface!.state().selection).toEqual(selection);
    sync(a, b);
    await converged(a, b);
    expect(await revisions(b)).toEqual([
      ['delete', 'Alice'],
      ['insert', 'Alice'],
    ]);
    expect(b.editor.surface!.session.bodyText()).toContain('supplier');
    expect(b.editor.surface!.session.bodyText()).toContain('vendor');

    // One undo step takes back both halves for every peer.
    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(await revisions(b)).toEqual([]);
    expect(a.editor.exec({ type: 'redo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(await revisions(b)).toHaveLength(2);

    joined = await peer('Carol', b);
    await converged(a, joined);
    expect(await revisions(joined)).toHaveLength(2);
  } finally {
    joined?.close();
    b.close();
    a.close();
  }
});

test('concurrent typing in the same paragraph survives a tracked replaceMatch', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    expect(a.editor.setEditingMode('suggesting').ok).toBe(true);
    const paragraphId = b.editor.surface!.session.paragraphIds()[0]!;
    const end = { paragraphId, offset: 'The supplier ships the goods'.length };
    b.editor.surface!.setSelection({ anchor: end, head: end });
    expect(b.editor.exec({ type: 'insertText', text: ' today' }).ok).toBe(true);
    expect(replace(a, 'supplier', 'vendor').ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    const text = a.editor.surface!.session.bodyText();
    expect(text).toContain('vendor');
    expect(text).toContain('goods today.');
    expect(await revisions(a)).toEqual([
      ['delete', 'Alice'],
      ['insert', 'Alice'],
    ]);
  } finally {
    b.close();
    a.close();
  }
});

test('a peer deleting the matched text while it is replaced converges', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    expect(a.editor.setEditingMode('suggesting').ok).toBe(true);
    const paragraphId = b.editor.surface!.session.paragraphIds()[0]!;
    b.editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 'The supplier ships'.length },
    });
    expect(b.editor.exec({ type: 'deleteText' }).ok).toBe(true);
    expect(replace(a, 'supplier', 'vendor').ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(a.editor.surface!.session.bodyText()).toContain('the goods.');
  } finally {
    b.close();
    a.close();
  }
});
