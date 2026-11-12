/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `acceptAllRevisions` and `rejectAllRevisions` across two collaborating editors: the decision
// converges, its undo and redo converge, a concurrent edit by the other peer survives the
// decision and its undo, and a decision made offline converges after reconnect.

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { canonicalOoxmlFingerprint, readOoxmlPackage } from '@docx-editor.dev/core/store';
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

const STAMP = 'w:date="2026-01-01T10:00:00Z"';
const fixture = zipDocument(
  '<w:p><w:r><w:t xml:space="preserve">Payment is due in </w:t></w:r>' +
    `<w:ins w:id="1" w:author="Counterparty" ${STAMP}><w:r><w:t>30</w:t></w:r></w:ins>` +
    `<w:del w:id="2" w:author="Counterparty" ${STAMP}><w:r><w:delText>60</w:delText></w:r></w:del>` +
    '<w:r><w:t xml:space="preserve"> days.</w:t></w:r></w:p>' +
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p>' +
    '<w:r><w:t xml:space="preserve">Fee: </w:t></w:r>' +
    `<w:ins w:id="3" w:author="Counterparty" ${STAMP}><w:r><w:t>waived</w:t></w:r></w:ins>` +
    '</w:p></w:tc></w:tr></w:tbl>' +
    '<w:p><w:r><w:t>Notes follow.</w:t></w:r></w:p>'
);

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'accept-all-revisions',
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
  return canonicalOoxmlFingerprint(result.package.parts.get(result.package.mainDocumentPart)!);
}

async function converged(a: Peer, b: Peer): Promise<string> {
  const left = await fingerprint(a);
  expect(await fingerprint(b)).toBe(left);
  return left;
}

const text = (peer: Peer) => peer.editor.surface!.session.bodyText();
const pending = (peer: Peer) => peer.editor.surface!.session.reviewItems().length;

/** Type at the end of the last paragraph, as a reader would. */
function typeAtEnd(peer: Peer, value: string) {
  const ids = peer.editor.surface!.session.paragraphIds();
  const last = ids[ids.length - 1]!;
  const at = { paragraphId: last, offset: 'Notes follow.'.length };
  peer.editor.surface!.setSelection({ anchor: at, head: at });
  expect(peer.editor.exec({ type: 'insertText', text: value }).ok).toBe(true);
}

for (const [type, kept, gone] of [
  ['acceptAllRevisions', '30', '60'],
  ['rejectAllRevisions', '60', '30'],
] as const) {
  test(`${type} converges, and its undo and redo converge on the other peer`, async () => {
    const a = await peer('Alice');
    const b = await peer('Bob', a);
    try {
      const original = await converged(a, b);
      expect(pending(b)).toBe(3);
      expect(a.editor.exec({ type }).ok).toBe(true);
      sync(a, b);
      const decided = await converged(a, b);
      expect(pending(b)).toBe(0);
      expect(text(b)).toContain(`due in ${kept} days`);
      expect(text(b)).not.toContain(gone);

      expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
      sync(a, b);
      expect(await converged(a, b)).toBe(original);
      expect(pending(b)).toBe(3);

      expect(a.editor.exec({ type: 'redo' }).ok).toBe(true);
      sync(a, b);
      expect(await converged(a, b)).toBe(decided);
    } finally {
      b.close();
      a.close();
    }
  });
}

test('a concurrent edit by the other peer survives the decision and its undo', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    // Neither peer has seen the other's write when both commit.
    expect(a.editor.exec({ type: 'acceptAllRevisions' }).ok).toBe(true);
    typeAtEnd(b, ' Bob was here.');
    sync(a, b);
    await converged(a, b);
    expect(text(a)).toContain('Notes follow. Bob was here.');
    expect(text(a)).toContain('due in 30 days');
    expect(pending(a)).toBe(0);

    expect(a.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(text(b)).toContain('Notes follow. Bob was here.');
    expect(pending(b)).toBe(3);
    // Bob's own undo removes only his typing.
    expect(b.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync(a, b);
    await converged(a, b);
    expect(text(a)).not.toContain('Bob was here.');
    expect(pending(a)).toBe(3);
  } finally {
    b.close();
    a.close();
  }
});

test('a change the other peer suggests concurrently stays pending', async () => {
  const a = await peer('Alice');
  const b = await peer('Bob', a);
  try {
    expect(b.editor.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
    expect(a.editor.exec({ type: 'acceptAllRevisions' }).ok).toBe(true);
    typeAtEnd(b, ' Pending.');
    sync(a, b);
    await converged(a, b);
    const items = a.editor.surface!.session.reviewItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'revision', author: 'Bob' });
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
    expect(a.editor.exec({ type: 'rejectAllRevisions' }).ok).toBe(true);
    expect(pending(b)).toBe(3);
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
