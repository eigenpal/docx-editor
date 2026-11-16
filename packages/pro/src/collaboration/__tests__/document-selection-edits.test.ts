/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `replaceText`, `splitParagraph`, `mergeParagraphs`, and `applyFormatting` between two
// editors in one shared room.
//
// Each command commits through an existing lane (paste, Enter, a join op, the run-property
// write), so the session sees ordinary operations. Both peers must converge, undo must travel,
// a joining peer must reopen the same document, and a concurrent edit must survive.

import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { canonicalOoxmlFingerprint, readOoxmlPackage } from '@docx-editor.dev/core/store';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createDocumentCollaboration } from '../document-session.ts';
import { zipDocument } from './document-peer-support.ts';

const fixture = zipDocument(
  '<w:p><w:r><w:t xml:space="preserve">Alpha beta gamma</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Second line</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Third line</w:t></w:r></w:p>'
);

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'selection-edits',
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

async function fingerprint(peer: Peer) {
  const result = readOoxmlPackage(new Uint8Array(await peer.editor.save()));
  if (!result.ok) throw new Error(result.reason);
  return canonicalOoxmlFingerprint(result.package.parts.get(result.package.mainDocumentPart)!);
}

async function converged(a: Peer, b: Peer) {
  expect(await fingerprint(a)).toBe(await fingerprint(b));
}

/** Select `[from, to)` of the paragraph that starts with `prefix`. */
function select(peer: Peer, prefix: string, from: number, to = from) {
  const session = peer.editor.surface!.session;
  const lines = session.bodyText().split('\n');
  const paragraphId = session.paragraphIds()[lines.findIndex((line) => line.startsWith(prefix))]!;
  peer.editor.surface!.setSelection({
    anchor: { paragraphId, offset: from },
    head: { paragraphId, offset: to },
  });
}

const text = (peer: Peer) => peer.editor.surface!.session.bodyText();

test('replaceText synchronizes, undoes, survives concurrent typing, and reopens', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  let joined: Peer | undefined;
  try {
    // Bob types at the end of the same paragraph while Alice replaces a word.
    select(b, 'Alpha', 'Alpha beta gamma'.length);
    expect(b.editor.exec({ type: 'insertText', text: ' delta' }).ok).toBe(true);
    select(a, 'Alpha', 6, 10);
    expect(a.editor.exec({ type: 'replaceText', text: 'BETA' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(text(b).split('\n')[0]).toBe('Alpha BETA gamma delta');

    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(text(b).split('\n')[0]).toBe('Alpha beta gamma delta');
    expect(a.editor.exec({ type: 'redo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);

    joined = await peer('Carol', b);
    await converged(a, joined);
    expect(text(joined).split('\n')[0]).toBe('Alpha BETA gamma delta');
  } finally {
    joined?.close();
    b.close();
    a.close();
  }
});

test('a tracked replaceText reaches the other peer as a proposal', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    expect(a.editor.setEditingMode('suggesting').ok).toBe(true);
    select(a, 'Alpha', 6, 10);
    expect(a.editor.exec({ type: 'replaceText', text: 'BETA' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(b.editor.getTrackedChanges().map((change) => `${change.kind}:${change.author}`)).toEqual(
      ['delete:Alice', 'insert:Alice']
    );
  } finally {
    b.close();
    a.close();
  }
});

test('splitParagraph and mergeParagraphs synchronize and undo for every peer', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    select(a, 'Alpha', 5);
    expect(a.editor.exec({ type: 'splitParagraph' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(text(b)).toBe('Alpha\n beta gamma\nSecond line\nThird line');

    select(b, 'Second', 0);
    expect(b.editor.exec({ type: 'mergeParagraphs' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(text(a)).toBe('Alpha\n beta gamma\nSecond lineThird line');

    expect(b.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(text(a)).toBe('Alpha\n beta gamma\nSecond line\nThird line');
    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(text(b)).toBe('Alpha beta gamma\nSecond line\nThird line');
  } finally {
    b.close();
    a.close();
  }
});

test('applyFormatting synchronizes and undoes for every peer', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    const original = await fingerprint(b);
    select(a, 'Alpha', 0, 5);
    expect(
      a.editor.exec({ type: 'applyFormatting', marks: { bold: true, fontSizePt: 14 } }).ok
    ).toBe(true);
    sync(a, b);
    await converged(a, b);
    select(b, 'Alpha', 1, 3);
    expect(b.editor.getSelectionFormatting()).toMatchObject({ bold: true, fontSizeHalfPoints: 28 });
    // Both writes are one undo step.
    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(await fingerprint(b)).toBe(original);
  } finally {
    b.close();
    a.close();
  }
});

test('mergeParagraphs while the other peer types in the joined paragraph converges', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    select(b, 'Third', 'Third line'.length);
    expect(b.editor.exec({ type: 'insertText', text: ' end' }).ok).toBe(true);
    select(a, 'Second', 0);
    expect(a.editor.exec({ type: 'mergeParagraphs' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(text(b)).toBe('Alpha beta gamma\nSecond lineThird line end');
  } finally {
    b.close();
    a.close();
  }
});
