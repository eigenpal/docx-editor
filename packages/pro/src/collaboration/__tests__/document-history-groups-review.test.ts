/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// One review decision across two collaborating editors: resolve the counterparty's change,
// write a counter-proposal through the browser runtime, and comment, all in one history
// group. The decision is one shared undo item on the deciding peer; its undo and redo
// converge on the other peer, a concurrent remote edit survives the undo, and a peer that
// made the decision offline converges after it reconnects.

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
  '<w:p><w:r><w:t xml:space="preserve">Payment is due in </w:t></w:r>' +
    '<w:ins w:id="1" w:author="Counterparty" w:date="2026-01-01T10:00:00Z"><w:r><w:t>30</w:t></w:r></w:ins>' +
    '<w:r><w:t xml:space="preserve"> days.</w:t></w:r></w:p>' +
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
    documentId: 'history-groups-review',
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

async function fingerprint(peer: Peer): Promise<string> {
  const result = readOoxmlPackage(new Uint8Array(await peer.editor.save()));
  if (!result.ok) throw new Error(result.reason);
  const pkg = result.package;
  const comments = pkg.parts.get('/word/comments.xml');
  return (
    canonicalOoxmlFingerprint(pkg.parts.get(pkg.mainDocumentPart)!) +
    (comments ? canonicalOoxmlFingerprint(comments) : '')
  );
}

async function converged(a: Peer, b: Peer): Promise<string> {
  const left = await fingerprint(a);
  expect(await fingerprint(b)).toBe(left);
  return left;
}

const text = (peer: Peer) => peer.editor.surface!.session.bodyText();
const comments = (peer: Peer) =>
  peer.editor.getReviewItems().filter((item) => item.kind === 'comment');

function select(peer: Peer, paragraph: number, start: number, end: number) {
  const id = peer.editor.surface!.session.paragraphIds()[paragraph]!;
  peer.editor.surface!.setSelection({
    anchor: { paragraphId: id, offset: start },
    head: { paragraphId: id, offset: end },
  });
}

async function counterPropose(context: RequestContext): Promise<void> {
  const ranges = context.document.body.search('free', { matchCase: true });
  ranges.load('items');
  await context.sync();
  ranges.items[0]!.insertText('charged at cost', 'Replace');
  await context.sync();
}

/** The decision: three lanes, one group. */
async function decide(a: Peer): Promise<void> {
  const decision = a.editor.beginHistoryGroup();
  expect(
    a.editor.exec(
      { type: 'resolveAllReviewChanges', action: 'reject', scope: 'document' },
      { historyGroup: decision }
    ).ok
  ).toBe(true);
  await a.runtime.run({ historyGroup: decision }, counterPropose);
  select(a, 1, 0, 8);
  expect(a.editor.addComment('Counter-proposal.', undefined, { historyGroup: decision }).ok).toBe(
    true
  );
  decision.end();
}

test('a grouped decision is one undo and one redo, and both converge on the other peer', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    const original = await converged(a, b);
    await decide(a);
    sync(a, b);
    const decided = await converged(a, b);
    expect(text(b)).toContain('charged at cost');
    expect(comments(b)).toHaveLength(1);

    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    expect(await converged(a, b)).toBe(original);
    expect(a.editor.snapshot().canUndo).toBe(false);

    expect(a.editor.exec({ type: 'redo' }).ok).toBe(true);
    sync(a, b);
    expect(await converged(a, b)).toBe(decided);
  } finally {
    b.close();
    a.close();
  }
});

test('control: the same writes without a group are separate undo steps', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    const original = await converged(a, b);
    a.editor.exec({ type: 'resolveAllReviewChanges', action: 'reject', scope: 'document' });
    await a.runtime.run(counterPropose);
    select(a, 1, 0, 8);
    expect(a.editor.addComment('Counter-proposal.').ok).toBe(true);
    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    expect(await converged(a, b)).not.toBe(original);
    expect(a.editor.snapshot().canUndo).toBe(true);
  } finally {
    b.close();
    a.close();
  }
});

test('a remote edit made during the decision survives its undo', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    const decision = a.editor.beginHistoryGroup();
    a.editor.exec(
      { type: 'resolveAllReviewChanges', action: 'accept', scope: 'document' },
      { historyGroup: decision }
    );
    sync(a, b);
    // Bob edits another paragraph while Alice's decision is still open.
    await b.runtime.run(async (context) => {
      const ranges = context.document.body.search('Notes', { matchCase: true });
      ranges.load('items');
      await context.sync();
      ranges.items[0]!.insertText('Bob notes', 'Replace');
      await context.sync();
    });
    sync(a, b);
    await a.runtime.run({ historyGroup: decision }, counterPropose);
    select(a, 1, 0, 8);
    expect(a.editor.addComment('Counter-proposal.', undefined, { historyGroup: decision }).ok).toBe(
      true
    );
    decision.end();
    sync(a, b);
    await converged(a, b);

    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(text(b)).toContain('Bob notes');
    expect(text(b)).toContain('Delivery is free.');
    expect(comments(b)).toHaveLength(0);
    expect(b.editor.getReviewItems()).toHaveLength(1);
  } finally {
    b.close();
    a.close();
  }
});

test('a decision made offline converges after reconnect, and so does its undo', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  let rejoined: Peer | undefined;
  try {
    const original = await converged(a, b);
    // No relay while Alice decides: she is offline.
    await decide(a);
    expect(text(b)).not.toContain('charged at cost');
    sync(a, b);
    const decided = await converged(a, b);
    rejoined = await peer('Carol', b);
    expect(await fingerprint(rejoined)).toBe(decided);

    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    sync(b, rejoined);
    expect(await converged(a, b)).toBe(original);
    expect(await fingerprint(rejoined)).toBe(original);
  } finally {
    rejoined?.close();
    b.close();
    a.close();
  }
});
