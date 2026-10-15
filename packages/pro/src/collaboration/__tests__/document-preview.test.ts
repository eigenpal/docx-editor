/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A browser runtime preview between two collaborating editors. The preview is a fork: the
// previewing peer's room never sees it, a remote edit during it marks it stale and refuses its
// commit, and a commit is one shared undo item that converges on the other peer, including
// after a reconnect.

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { canonicalOoxmlFingerprint, readOoxmlPackage } from '@docx-editor.dev/core/store';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import type { RequestContext } from '@docx-editor.dev/editor-api';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createDocumentCollaboration } from '../document-session.ts';
import { zipDocument } from './document-peer-support.ts';

let registeredDom = false;
beforeAll(() => {
  if (typeof document !== 'undefined') return;
  GlobalRegistrator.register();
  registeredDom = true;
});
afterAll(() => {
  if (registeredDom) GlobalRegistrator.unregister();
});

const fixture = zipDocument(
  '<w:p><w:r><w:t>Notice is due within thirty (30) days of receipt.</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Delivery is free.</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Notes follow.</w:t></w:r></w:p>'
);

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'runtime-preview',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: fixture },
    offlineEditing: true,
  });
  const parent = document.createElement('div');
  const container = document.createElement('div');
  parent.append(container);
  document.body.append(parent);
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
    parent,
    close() {
      runtime.dispose();
      editor.destroy();
      parent.remove();
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

async function fingerprint(peer: Peer): Promise<string> {
  const result = readOoxmlPackage(new Uint8Array(await peer.editor.save()));
  if (!result.ok) throw new Error(result.reason);
  return canonicalOoxmlFingerprint(result.package.parts.get(result.package.mainDocumentPart)!);
}

async function converged(a: Peer, b: Peer): Promise<string> {
  const left = await fingerprint(a);
  expect(await fingerprint(b)).toBe(left);
  return left;
}

const text = (peer: Peer) => peer.editor.surface!.session.bodyText();
const previewText = (peer: Peer) =>
  peer.parent.querySelector('[data-docx-preview] .docx-pages')?.textContent ?? '';

async function counterProposal(context: RequestContext): Promise<void> {
  context.document.changeTrackingMode = 'TrackMineOnly';
  const range = context.document.body.search('thirty (30) days of receipt').getFirst();
  range.insertText('forty-five (45) days of receipt', 'Replace');
  await context.sync();
}

async function bobEditsNotes(b: Peer): Promise<void> {
  await b.runtime.run(async (context) => {
    const ranges = context.document.body.search('Notes', { matchCase: true });
    ranges.load('items');
    await context.sync();
    ranges.items[0]!.insertText('Bob notes', 'Replace');
    await context.sync();
  });
}

test('a preview never reaches the other peer, and discarding it leaves both unchanged', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    const original = await converged(a, b);
    const preview = await a.runtime.preview(counterProposal);
    expect(previewText(a)).toContain('forty-five (45) days of receipt');
    sync(a, b);
    expect(text(b)).not.toContain('forty-five');
    expect(await fingerprint(b)).toBe(original);
    expect(await fingerprint(a)).toBe(original);
    preview.discard();
    sync(a, b);
    expect(await converged(a, b)).toBe(original);
    expect(a.editor.snapshot().canUndo).toBe(false);
    await expect(preview.commit()).rejects.toMatchObject({ code: 'PreviewEnded' });
  } finally {
    b.close();
    a.close();
  }
});

test('a remote edit marks a preview stale; commit refuses, and a rebase converges', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    const preview = await a.runtime.preview(counterProposal);
    await bobEditsNotes(b);
    sync(a, b);
    expect(preview.status).toBe('stale');
    // The remote edit landed in Alice's live document behind the preview.
    expect(text(a)).toContain('Bob notes');
    await expect(preview.commit()).rejects.toMatchObject({ code: 'StaleDocument' });
    expect(preview.status).toBe('stale');
    sync(a, b);
    await converged(a, b);
    expect(text(b)).not.toContain('forty-five');
    // Bob edited another paragraph: the preview replays on the current document.
    await preview.commit({ rebase: true });
    sync(a, b);
    await converged(a, b);
    expect(text(b)).toContain('Bob notes');
    expect(text(b)).toContain('forty-five (45) days of receipt');
    // One undo takes back Alice's commit and leaves Bob's edit.
    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(text(b)).toContain('Bob notes');
    expect(text(b)).not.toContain('forty-five');
  } finally {
    b.close();
    a.close();
  }
});

test('a committed preview is one shared undo item that converges on the other peer', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    const original = await converged(a, b);
    const preview = await a.runtime.preview(counterProposal);
    await preview.commit();
    sync(a, b);
    const committed = await converged(a, b);
    expect(text(b)).toContain('forty-five (45) days of receipt');
    expect(b.editor.getReviewItems().some((item) => item.author === 'Alice')).toBe(true);

    // Bob edits elsewhere; Alice's one undo takes back exactly her commit.
    await bobEditsNotes(b);
    sync(a, b);
    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(text(b)).toContain('Bob notes');
    expect(text(b)).toContain('thirty (30) days of receipt');
    expect(text(b)).not.toContain('forty-five');
    expect(a.editor.snapshot().canUndo).toBe(false);
    expect(committed).not.toBe(original);
  } finally {
    b.close();
    a.close();
  }
});

test('a preview committed offline converges after reconnect', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  let rejoined: Peer | undefined;
  try {
    // No relay while Alice previews and commits: she is offline.
    const preview = await a.runtime.preview(counterProposal);
    await preview.commit();
    expect(text(b)).not.toContain('forty-five');
    sync(a, b);
    const committed = await converged(a, b);
    expect(text(b)).toContain('forty-five (45) days of receipt');
    rejoined = await peer('Carol', b);
    expect(await fingerprint(rejoined)).toBe(committed);
  } finally {
    rejoined?.close();
    b.close();
    a.close();
  }
});

test('a preview open while offline turns stale when the peer reconnects with an edit', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    const preview = await a.runtime.preview(counterProposal);
    // Bob edits while Alice is disconnected; nothing has moved under her preview yet.
    await bobEditsNotes(b);
    expect(preview.status).toBe('active');
    sync(a, b);
    expect(preview.status).toBe('stale');
    preview.discard();
    sync(a, b);
    await converged(a, b);
    // A new preview over the reconnected document commits normally.
    const again = await a.runtime.preview(counterProposal);
    await again.commit();
    sync(a, b);
    await converged(a, b);
    expect(text(b)).toContain('Bob notes');
    expect(text(b)).toContain('forty-five (45) days of receipt');
  } finally {
    b.close();
    a.close();
  }
});

test('a remote edit to the previewed text makes a rebase refuse without writing', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    const preview = await a.runtime.preview(counterProposal);
    await b.runtime.run(async (context) => {
      const range = context.document.body.search('thirty (30) days').getFirst();
      range.insertText('sixty (60) days', 'Replace');
      await context.sync();
    });
    sync(a, b);
    const moved = await converged(a, b);
    await expect(preview.commit({ rebase: true })).rejects.toMatchObject({
      code: 'StaleDocument',
    });
    sync(a, b);
    expect(await converged(a, b)).toBe(moved);
    expect(text(a)).not.toContain('forty-five');
  } finally {
    b.close();
    a.close();
  }
});

test('ids the preview mints are the ids its commit writes', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    let previewed = '';
    const preview = await a.runtime.preview(async (context) => {
      const range = context.document.body.search('Delivery').getFirst();
      const comment = range.insertComment('Why free?');
      await context.sync();
      comment.load('id');
      await context.sync();
      previewed = comment.id;
    });
    await preview.commit();
    sync(a, b);
    await converged(a, b);
    const committed = await b.runtime.run(async (context) => {
      const comments = context.document.body.getComments();
      comments.load('items');
      await context.sync();
      for (const comment of comments.items) comment.load('id');
      await context.sync();
      return comments.items.map((comment) => comment.id);
    });
    expect(previewed).not.toBe('');
    expect(committed).toEqual([previewed]);
  } finally {
    b.close();
    a.close();
  }
});

test('in suggesting mode a preview commits the same suggestion to both peers', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    a.editor.exec({ type: 'setEditingMode', mode: 'suggesting' });
    const preview = await a.runtime.preview(async (context) => {
      context.document.body.search('free').getFirst().insertText('charged', 'Replace');
      await context.sync();
    });
    expect(previewText(a)).toContain('charged');
    await preview.commit();
    sync(a, b);
    await converged(a, b);
    const authors = b.editor.getReviewItems().map((item) => item.author);
    expect(authors).toContain('Alice');
  } finally {
    b.close();
    a.close();
  }
});
