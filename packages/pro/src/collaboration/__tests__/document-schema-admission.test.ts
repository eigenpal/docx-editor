/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { ORIGIN_IDS } from '@docx-editor.dev/core/store';
import { createPeerHarness, nodeText, zipDocument, type Peer } from './document-peer-support.ts';
import { PACKAGE_META_KEY } from '../document/schema.ts';

const harness = createPeerHarness('schema-admission-592');
afterEach(() => harness.cleanup());
const document = () => zipDocument('<w:p><w:r><w:t>hello</w:t></w:r></w:p><w:sectPr/>');

/** An attached custom port can publish directly, without the optional editor operation gate. */
function directInsert(peer: Peer, text: string): void {
  const result = peer.store.transact({ kind: 'body' }, (context) => {
    context.apply({
      op: 'insertText',
      paragraphId: harness.paragraphIdAt(peer, 0),
      offset: 0,
      text,
    });
  });
  expect(result.ok).toBe(true);
  peer.port.flushPendingJournals();
}

for (const version of [2, 4]) {
  test(`the final journal boundary rejects direct store writes after schema ${version} mismatch`, async () => {
    const { alice, bob } = await harness.pair(document());
    alice.ydoc.getMap(PACKAGE_META_KEY).set('sharedSchemaVersion', version);
    expect(bob.room.session.statusSnapshot().reason?.code).toBe('schema-version-mismatch');
    const before = Y.encodeStateVector(bob.ydoc);
    directInsert(bob, 'BLOCKED');
    // A bypassed operation gate already committed to the custom store. Keep those local
    // bytes recoverable, but never synchronize them into an incompatible representation.
    expect(nodeText(bob.store.bodyStore().part.root)).toBe('BLOCKEDhello');
    expect(nodeText(alice.store.bodyStore().part.root)).toBe('hello');
    expect(bob.room.session.statusSnapshot().reason).toMatchObject({
      code: 'schema-version-mismatch',
      detail: `sharedSchemaVersion: expected 3, received ${version}`,
    });
    bob.port.flushPendingJournals();
    bob.detach();
    expect(Y.encodeStateVector(bob.ydoc)).toEqual(before);
    expect(bob.room.session.statusSnapshot().reason?.code).toBe('schema-version-mismatch');
  });
}

test('a detached session observes incompatibility and cannot undo into the room', async () => {
  const { alice, bob } = await harness.pair(document());
  harness.apply(alice, [
    { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 0), offset: 0, text: 'A' },
  ]);
  expect(alice.room.session.canUndo()).toBe(true);
  alice.detach();
  bob.ydoc.getMap(PACKAGE_META_KEY).set('sharedSchemaVersion', 2);
  expect(alice.room.session.statusSnapshot().reason?.code).toBe('schema-version-mismatch');
  const before = Y.encodeStateVector(alice.ydoc);
  expect(alice.room.session.canUndo()).toBe(false);
  expect(alice.room.session.undo()).toBe(false);
  expect(alice.room.session.canRedo()).toBe(false);
  expect(alice.room.session.redo()).toBe(false);
  expect(Y.encodeStateVector(alice.ydoc)).toEqual(before);
});

test('admission checks the current metadata before its transaction event is delivered', async () => {
  const { bob } = await harness.pair(document());
  bob.ydoc.transact(() => {
    bob.ydoc.getMap(PACKAGE_META_KEY).set('sharedSchemaVersion', 2);
    const before = Y.encodeStateVector(bob.ydoc);
    directInsert(bob, 'BLOCKED');
    expect(Y.encodeStateVector(bob.ydoc)).toEqual(before);
    expect(bob.room.session.statusSnapshot().reason?.code).toBe('schema-version-mismatch');
  });
});

test('journals held during a remote install cannot drain after a schema mismatch', async () => {
  const { alice, bob } = await harness.pair(document());
  let reacted = false;
  let afterMismatch: Uint8Array | undefined;
  const stop = bob.store.subscribe((change) => {
    if (reacted || change.origin !== ORIGIN_IDS.mutationRemote) return;
    reacted = true;
    bob.ydoc.getMap(PACKAGE_META_KEY).set('sharedSchemaVersion', 2);
    afterMismatch = Y.encodeStateVector(bob.ydoc);
    directInsert(bob, 'BLOCKED');
  });
  try {
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 0), offset: 0, text: 'A' },
    ]);
    expect(reacted).toBe(true);
    expect(Y.encodeStateVector(bob.ydoc)).toEqual(afterMismatch!);
    expect(bob.room.session.statusSnapshot().reason?.code).toBe('schema-version-mismatch');
  } finally {
    stop();
  }
});
