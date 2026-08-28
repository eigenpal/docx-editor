/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A peer is not a trust boundary (issue #567). The shared node map is peer-writable, so a
// hostile update can plant a scalar where a record belongs. The receive path — the registry
// observers that fire during `applyUpdate`, the derived-index rebuild, and the materializer —
// must treat a malformed value as an absent node and keep running, never throw synchronously
// into the provider's message handler and take down every replica in the room.

import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { DocumentRegistry, PackageMaterializer, MemoryBlobStore } from '../document/index.ts';
import { createPeerHarness } from './document-peer-support.ts';
import { collaborationDocx } from './support.ts';

const harness = createPeerHarness('hostile-shapes-room');

afterEach(() => {
  harness.cleanup();
});

const NODES = 'docx-package-nodes-v1';
const PARTS = 'docx-package-parts-v1';

/** Apply a hostile mutation on a doc mirroring the room, then deliver it to `target`. */
function deliverHostile(source: Y.Doc, target: Y.Doc, mutate: (doc: Y.Doc) => void): void {
  const attacker = new Y.Doc();
  Y.applyUpdate(attacker, Y.encodeStateAsUpdate(source));
  mutate(attacker);
  const update = Y.encodeStateAsUpdate(attacker, Y.encodeStateVector(target));
  Y.applyUpdate(target, update, 'relay');
}

describe('hostile shared shapes on the receive path', () => {
  test('a non-map node record does not crash a receiving replica', async () => {
    const { alice, bob } = await harness.pair(collaborationDocx());
    // Before the fix this threw `record.get is not a function` inside applyUpdate, escaping
    // into the provider and downing bob.
    expect(() =>
      deliverHostile(alice.ydoc, bob.ydoc, (doc) => {
        doc.getMap(NODES).set('junk-node', 'not-a-map' as never);
      })
    ).not.toThrow();
    // The room stays usable: the honest author can still edit and bob still materializes.
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 0), offset: 0, text: 'ok ' },
    ]);
    expect(() => harness.packageOf(bob)).not.toThrow();
  });

  test('a non-map part entry does not crash the receiver', async () => {
    const { alice, bob } = await harness.pair(collaborationDocx());
    expect(() =>
      deliverHostile(alice.ydoc, bob.ydoc, (doc) => {
        doc.getMap(PARTS).set('junk-part', 42 as never);
      })
    ).not.toThrow();
    expect(() => harness.packageOf(bob)).not.toThrow();
  });

  test('a scalar node survives a fresh join and materialize without throwing', async () => {
    const { alice } = await harness.pair(collaborationDocx());
    // A joiner rebuilds derived indexes from shared state and materializes — the other place
    // a malformed record is read. Plant the junk, then stand up a fresh registry over a
    // mirror the way a joiner does.
    const mirror = new Y.Doc();
    Y.applyUpdate(mirror, Y.encodeStateAsUpdate(alice.ydoc));
    mirror.getMap(NODES).set('junk-node', 'not-a-map' as never);
    const registry = new DocumentRegistry(mirror);
    expect(() => registry.rebuildDerivedIndexes()).not.toThrow();
    const materializer = new PackageMaterializer(registry, new MemoryBlobStore());
    expect(() => materializer.current()).not.toThrow();
    materializer.destroy();
    registry.destroy();
    mirror.destroy();
  });
});
