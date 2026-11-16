/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The document vocabulary's comment and revision commands across two collaborating editors:
// `replyComment`, `resolveComment`, and `acceptRevision` converge, their undo converges, and a
// concurrent edit by the other peer survives them.

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { canonicalOoxmlFingerprint, readOoxmlPackage } from '@docx-editor.dev/core/store';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createDocumentCollaboration } from '../document-session.ts';
import { R, W, zipDocument } from './document-peer-support.ts';

let registeredDom = false;
beforeAll(() => {
  if (typeof document !== 'undefined') return;
  GlobalRegistrator.register();
  registeredDom = true;
});
afterAll(() => {
  if (registeredDom) GlobalRegistrator.unregister();
});

const STAMP = 'w:date="2026-01-01T10:00:00Z"';
const fixture = zipDocument(
  '<w:p><w:r><w:t xml:space="preserve">Payment is due in </w:t></w:r>' +
    `<w:ins w:id="1" w:author="Counterparty" ${STAMP}><w:r><w:t>30</w:t></w:r></w:ins>` +
    `<w:del w:id="2" w:author="Counterparty" ${STAMP}><w:r><w:delText>60</w:delText></w:r></w:del>` +
    '<w:r><w:t xml:space="preserve"> days.</w:t></w:r></w:p>' +
    '<w:p><w:commentRangeStart w:id="7"/><w:r><w:t>Delivery is free.</w:t></w:r>' +
    '<w:commentRangeEnd w:id="7"/><w:r><w:commentReference w:id="7"/></w:r></w:p>' +
    '<w:p><w:r><w:t>Notes follow.</w:t></w:r></w:p>',
  {
    overrides:
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
    documentRels: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="c" Type="${R}/comments" Target="comments.xml"/></Relationships>`,
    extraXml: {
      'word/comments.xml': `<w:comments xmlns:w="${W}"><w:comment w:id="7" w:author="Counterparty" ${STAMP}><w:p><w:r><w:t>Why free?</w:t></w:r></w:p></w:comment></w:comments>`,
    },
  }
);

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'document-review-commands',
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
const revisions = (peer: Peer) =>
  peer.editor.getReviewItems({ pairReplacements: false }).filter((e) => e.kind === 'revision');
const comments = (peer: Peer) =>
  peer.editor.getReviewItems().filter((entry) => entry.kind === 'comment');

/** Type at the end of the last paragraph, as a reader would. */
function typeAtEnd(peer: Peer, value: string) {
  const ids = peer.editor.surface!.session.paragraphIds();
  const at = { paragraphId: ids[ids.length - 1]!, offset: 'Notes follow.'.length };
  peer.editor.surface!.setSelection({ anchor: at, head: at });
  expect(peer.editor.exec({ type: 'insertText', text: value }).ok).toBe(true);
}

test('acceptRevision converges, a concurrent edit survives, and its undo converges', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    expect(a.editor.exec({ type: 'acceptRevision', id: 1 }).ok).toBe(true);
    typeAtEnd(b, ' Bob was here.');
    sync(a, b);
    await converged(a, b);
    expect(revisions(b)).toHaveLength(1);
    expect(text(b)).toContain('Notes follow. Bob was here.');

    // Bob decides the other change by its id, as Alice decided hers.
    expect(b.editor.exec({ type: 'rejectRevision', id: 2 }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(revisions(a)).toHaveLength(0);
    expect(text(a)).toContain('due in 3060 days');

    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(revisions(b)).toHaveLength(1);
    expect(text(b)).toContain('Bob was here.');
  } finally {
    b.close();
    a.close();
  }
});

test('replyComment and resolveComment converge, and their undo converges', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    const original = await converged(a, b);
    expect(a.editor.exec({ type: 'replyComment', commentId: '7', text: 'It is.' }).ok).toBe(true);
    typeAtEnd(b, ' Bob was here.');
    sync(a, b);
    await converged(a, b);
    expect(comments(b)).toHaveLength(2);

    expect(b.editor.exec({ type: 'resolveComment', commentId: '7' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    const thread = comments(a).find(
      (entry) => entry.item.kind === 'comment' && entry.item.comment.id === '7'
    );
    expect(thread?.item.kind === 'comment' && thread.item.resolved).toBe(true);

    expect(b.editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(b.editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    expect(await converged(a, b)).toBe(original);
  } finally {
    b.close();
    a.close();
  }
});
