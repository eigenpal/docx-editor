/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPackage,
  revisionItemsOf,
} from '@docx-editor.dev/core/store';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createDocumentCollaboration } from '../document-session.ts';
import { zipDocument } from './document-peer-support.ts';

const fixture = zipDocument(
  '<w:p><w:del w:id="1" w:author="Reviewer" w:date="2026-01-02T10:00:00Z"><w:r><w:delText>old</w:delText></w:r></w:del>' +
    '<w:ins w:id="2" w:author="Reviewer" w:date="2026-01-01T10:00:00Z"><w:r><w:t>new</w:t></w:r></w:ins>' +
    '<w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>'
);
async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'replacement-times',
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
  const runtime = DocxEditor.createBrowser(editor, { author: name });
  return {
    ydoc,
    room,
    editor,
    runtime,
    close() {
      runtime.dispose();
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
  expect(a.editor.getReviewItems()).toEqual(b.editor.getReviewItems());
}
function card(peer: Peer, kind: 'insert' | 'delete') {
  const item = peer.editor
    .getReviewItems()
    .find((item) => item.kind === 'revision' && item.revisionKind === kind);
  if (!item) throw new Error(`missing ${kind} card`);
  return item;
}

for (const action of ['acceptReviewItem', 'rejectReviewItem'] as const) {
  for (const kind of ['insert', 'delete'] as const) {
    test(`${action} of independent ${kind} synchronizes, undoes, redoes, and reopens`, async () => {
      const a = await peer('Alice');
      const b = await peer('Bob', a);
      let joined: Peer | undefined;
      try {
        expect(a.editor.getReviewItems()).toHaveLength(2);
        expect(a.editor[action](card(a, kind).key).ok).toBe(true);
        sync(a, b);
        await converged(a, b);
        const remainingKind = kind === 'insert' ? 'delete' : 'insert';
        expect(revisionItemsOf(await savedPart(b)).map((item) => item.revisionKind)).toEqual([
          remainingKind,
        ]);
        expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
        sync(a, b);
        await converged(a, b);
        expect(b.editor.getReviewItems()).toHaveLength(2);
        expect(a.editor.exec({ type: 'redo' }).ok).toBe(true);
        sync(a, b);
        await converged(a, b);
        expect(b.editor.getReviewItems()).toHaveLength(1);
        joined = await peer('Rejoined', b);
        await converged(a, joined);
        expect(joined.editor.getReviewItems()).toHaveLength(1);
      } finally {
        joined?.close();
        b.close();
        a.close();
      }
    });
  }
}

test('concurrent decisions on independent halves converge', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    expect(a.editor.acceptReviewItem(card(a, 'delete').key).ok).toBe(true);
    expect(b.editor.rejectReviewItem(card(b, 'insert').key).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(b.editor.getReviewItems()).toHaveLength(0);
    expect(b.editor.surface!.session.bodyText()).toBe(' tail');
  } finally {
    b.close();
    a.close();
  }
});

test('resolving a deletion while a participant edits the adjacent insertion keeps both decisions', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    expect(a.editor.acceptReviewItem(card(a, 'delete').key).ok).toBe(true);
    await b.runtime.run(async (context) => {
      const found = context.document.body.search('new');
      found.load('items');
      await context.sync();
      found.items[0]!.insertText('changed', 'Replace');
      await context.sync();
    });
    sync(a, b);
    await converged(a, b);
    expect(b.editor.surface!.session.bodyText()).toContain('changed');
    expect(b.editor.surface!.session.bodyText()).not.toContain('old');
    expect(
      b.editor
        .getReviewItems()
        .some((item) => item.kind === 'revision' && item.revisionKind === 'delete')
    ).toBe(false);
  } finally {
    b.close();
    a.close();
  }
});

test('deleting a revision while another participant edits its text converges', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    expect(a.editor.rejectReviewItem(card(a, 'insert').key).ok).toBe(true);
    await b.runtime.run(async (context) => {
      const found = context.document.body.search('new');
      found.load('items');
      await context.sync();
      found.items[0]!.insertText('changed', 'Replace');
      await context.sync();
    });
    sync(a, b);
    await converged(a, b);
    expect(
      b.editor
        .getReviewItems()
        .some((item) => item.kind === 'revision' && item.revisionKind === 'insert')
    ).toBe(false);
    expect(b.editor.surface!.session.bodyText()).toBe('old tail');
  } finally {
    b.close();
    a.close();
  }
});

test('a caret activates only its independent revision', async () => {
  const a = await peer('Alice');
  try {
    const fragment = a.editor.surface!.layout().pages[0]!.fragments[0]!;
    if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph');
    const activeAt = (offset: number) => {
      const position = { paragraphId: fragment.paragraphId, offset };
      a.editor.surface!.setSelection({ anchor: position, head: position });
      return a.editor
        .getReviewItems()
        .filter((item) => item.isActive)
        .map((item) => (item.kind === 'revision' ? item.revisionKind : item.kind));
    };
    expect(activeAt(1)).toEqual(['delete']);
    expect(activeAt(4)).toEqual(['insert']);
    expect(activeAt(7)).toEqual([]);
  } finally {
    a.close();
  }
});
