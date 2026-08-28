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
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { DocumentRegistry, PackageMaterializer, MemoryBlobStore } from '../document/index.ts';
import { createPeerHarness, walk } from './document-peer-support.ts';
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

  test('a map-shaped node record with no children array does not crash materialize', async () => {
    // isNodeMap passes but the inner `children` is missing: the materializer's record reader
    // reaches childArray, which throws `no children at ...`. Same impact as #567, a different
    // crafted shape. Overwrite a real reachable element record (a part root) with a bare map.
    const { alice } = await harness.pair(collaborationDocx());
    const mirror = new Y.Doc();
    Y.applyUpdate(mirror, Y.encodeStateAsUpdate(alice.ydoc));
    const nodes = mirror.getMap<Y.Map<unknown>>(NODES);
    let victim: string | undefined;
    nodes.forEach((_record, id) => {
      if (!victim) victim = id;
    });
    expect(victim).toBeTruthy();
    const bare = new Y.Map<unknown>();
    bare.set('s', 'generic-p');
    mirror.transact(() => nodes.set(victim!, bare));
    const registry = new DocumentRegistry(mirror);
    expect(() => registry.rebuildDerivedIndexes()).not.toThrow();
    const materializer = new PackageMaterializer(registry, new MemoryBlobStore());
    expect(() => materializer.current()).not.toThrow();
    materializer.destroy();
    registry.destroy();
    mirror.destroy();
  });

  test('a contested placement with a malformed record does not crash resolution', async () => {
    // Two parents list one child (a contest), and that child's record is a scalar. The
    // contested-placement walk reads it during resolveParents on the receive path.
    const { alice, bob } = await harness.pair(collaborationDocx());
    const bodyRootId = alice.store.bodyStore().part.root.id;
    let childId: string | undefined;
    walk(alice.store.bodyStore().part.root, (node: OoxmlNode) => {
      if (!childId && node.kind === 'paragraph') childId = node.id;
    });
    expect(childId).toBeTruthy();
    expect(() =>
      deliverHostile(alice.ydoc, bob.ydoc, (doc) => {
        const nodes = doc.getMap<Y.Map<unknown>>(NODES);
        // A second parent that also lists the child — the contest — plus the child turned
        // into a scalar.
        const rogue = new Y.Map<unknown>();
        rogue.set('s', 'generic-rogue');
        const kids = new Y.Array<string>();
        kids.insert(0, [childId!]);
        rogue.set('children', kids);
        nodes.set('rogue-parent', rogue);
        const bodyChildren = nodes.get(bodyRootId)?.get('children');
        if (bodyChildren instanceof Y.Array)
          bodyChildren.insert(bodyChildren.length, ['rogue-parent']);
        nodes.set(childId!, 'not-a-map' as never);
      })
    ).not.toThrow();
    expect(() => harness.packageOf(bob)).not.toThrow();
  });
});
