/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { DocumentRegistry } from '../document/registry.ts';
import { asLogicalId, type LogicalId } from '../document/identity.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * Count element comparisons, not wall time.
 *
 * The defect this file guards is a linear scan per child inside a loop over children. That is
 * invisible to a call counter — one `includes` call can be one comparison or ten thousand — so
 * the counter replaces the scan with a counted equivalent. Both originals are restored.
 */
function countScans<T>(run: () => T): { readonly result: T; readonly comparisons: number } {
  const originalIncludes = Array.prototype.includes;
  const originalIndexOf = Array.prototype.indexOf;
  let comparisons = 0;
  Array.prototype.includes = function (this: unknown[], value: unknown): boolean {
    for (let index = 0; index < this.length; index += 1) {
      comparisons += 1;
      if (this[index] === value) return true;
    }
    return false;
  } as typeof Array.prototype.includes;
  Array.prototype.indexOf = function (this: unknown[], value: unknown): number {
    for (let index = 0; index < this.length; index += 1) {
      comparisons += 1;
      if (this[index] === value) return index;
    }
    return -1;
  } as typeof Array.prototype.indexOf;
  try {
    return { result: run(), comparisons };
  } finally {
    Array.prototype.includes = originalIncludes;
    Array.prototype.indexOf = originalIndexOf;
  }
}

/**
 * Count listing writes, not wall time.
 *
 * `addListing` used to run for every child of the parent whose array changed, so appending one
 * block to an 800-block body rewrote all 800 listings to record one.
 */
/** Count writes to the registry's child listings while `run` executes. */
function countListingWrites<T>(
  registry: DocumentRegistry,
  run: () => T
): { readonly result: T; readonly writes: number } {
  const listings = (registry as unknown as { listings: Map<string, Set<string>> }).listings;
  const original = listings.set;
  let writes = 0;
  listings.set = function (this: Map<string, Set<string>>, key, value) {
    writes += 1;
    return original.call(this, key, value);
  };
  try {
    return { result: run(), writes };
  } finally {
    listings.set = original;
  }
}

function element(registry: DocumentRegistry, logicalId: string, localName: string): void {
  registry.putElement({
    logicalId: asLogicalId(logicalId),
    kind: 'generic',
    namespaceUri: W,
    localName,
    attributes: [],
    bindings: [],
  });
}

function wideParent(childCount: number): {
  readonly doc: Y.Doc;
  readonly registry: DocumentRegistry;
} {
  const doc = new Y.Doc();
  const registry = new DocumentRegistry(doc);
  doc.transact(() => {
    element(registry, 'parent', 'body');
    const childIds: LogicalId[] = [];
    for (let index = 0; index < childCount; index += 1) {
      const childId = asLogicalId(`child-${index}`);
      element(registry, childId, 'p');
      childIds.push(childId);
    }
    registry.spliceChildren(asLogicalId('parent'), 0, 0, childIds);
  });
  return { doc, registry };
}

describe('child-listing maintenance is linear in child count', () => {
  test('appending one child to a wide parent does not rescan the whole child list', () => {
    // A body root lists every block in the document. Journal publication is synchronous on the
    // commit, so this runs on the keystroke path: a scan per child made one insert into an
    // 800-block body cost ~640,000 comparisons.
    const childCount = 800;
    const { doc, registry } = wideParent(childCount);

    const { comparisons } = countScans(() => {
      doc.transact(() => {
        element(registry, 'newborn', 'p');
        registry.spliceChildren(asLogicalId('parent'), childCount, 0, [asLogicalId('newborn')]);
      });
    });

    expect(comparisons).toBeLessThan(childCount * 4);
    expect(registry.parentOf(asLogicalId('newborn'))).toBe(asLogicalId('parent'));
    expect(registry.listingParents(asLogicalId('newborn'))).toEqual([asLogicalId('parent')]);
  });

  test('removing one child from a wide parent is linear too', () => {
    const childCount = 800;
    const { doc, registry } = wideParent(childCount);

    const { comparisons } = countScans(() => {
      doc.transact(() => {
        registry.spliceChildren(asLogicalId('parent'), 400, 1, []);
      });
    });

    expect(comparisons).toBeLessThan(childCount * 4);
    expect(registry.parentOf(asLogicalId('child-400'))).toBeNull();
    expect(registry.listingParents(asLogicalId('child-400'))).toEqual([]);
    expect(registry.parentOf(asLogicalId('child-399'))).toBe(asLogicalId('parent'));
    expect(registry.parentOf(asLogicalId('child-401'))).toBe(asLogicalId('parent'));
  });

  test('listings stay correct when the same child id is listed twice and dropped once', () => {
    // `unlistChildren` deletes one occurrence at a time, so a duplicate listing is reachable
    // state. Counting membership rather than scanning must not change what stays listed.
    const doc = new Y.Doc();
    const registry = new DocumentRegistry(doc);
    doc.transact(() => {
      element(registry, 'parent', 'body');
      element(registry, 'twin', 'p');
      registry.spliceChildren(asLogicalId('parent'), 0, 0, [
        asLogicalId('twin'),
        asLogicalId('twin'),
      ]);
    });
    expect(registry.listingParents(asLogicalId('twin'))).toEqual([asLogicalId('parent')]);

    doc.transact(() => {
      registry.spliceChildren(asLogicalId('parent'), 0, 1, []);
    });
    expect(registry.listingParents(asLogicalId('twin'))).toEqual([asLogicalId('parent')]);

    doc.transact(() => {
      registry.spliceChildren(asLogicalId('parent'), 0, 1, []);
    });
    expect(registry.listingParents(asLogicalId('twin'))).toEqual([]);
  });

  test('appending one child writes one listing, not one per sibling', () => {
    const childCount = 800;
    const { doc, registry } = wideParent(childCount);

    const { writes } = countListingWrites(registry, () => {
      doc.transact(() => {
        element(registry, 'newborn', 'p');
        registry.spliceChildren(asLogicalId('parent'), childCount, 0, [asLogicalId('newborn')]);
      });
    });

    expect(writes).toBe(1);
    expect(registry.listingParents(asLogicalId('newborn'))).toEqual([asLogicalId('parent')]);
    expect(registry.listingParents(asLogicalId('child-0'))).toEqual([asLogicalId('parent')]);
    expect(registry.listingParents(asLogicalId(`child-${childCount - 1}`))).toEqual([
      asLogicalId('parent'),
    ]);
  });

  test('a child moved between two wide parents ends up under the destination only', () => {
    const doc = new Y.Doc();
    const registry = new DocumentRegistry(doc);
    doc.transact(() => {
      element(registry, 'left', 'body');
      element(registry, 'right', 'body');
      element(registry, 'mover', 'p');
      registry.spliceChildren(asLogicalId('left'), 0, 0, [asLogicalId('mover')]);
    });
    expect(registry.listingParents(asLogicalId('mover'))).toEqual([asLogicalId('left')]);

    doc.transact(() => {
      registry.moveNode(asLogicalId('mover'), asLogicalId('right'), 0);
    });
    expect(registry.listingParents(asLogicalId('mover'))).toEqual([asLogicalId('right')]);
    expect(registry.parentOf(asLogicalId('mover'))).toBe(asLogicalId('right'));
  });
});

/**
 * `nodeCount` reads a maintained total, because `Y.Map.size` walks every key and allocates an
 * array to measure it — 630us on a 200-page document, once per commit. A count that drifts
 * from `size` either lets a document past its node cap or refuses one that is inside it, so
 * the two are compared after every kind of write.
 */
describe('the maintained node count matches shared state', () => {
  const sizeOf = (registry: DocumentRegistry): number => registry.schema.nodes.size;

  test('counts the nodes a transaction adds before its events are delivered', () => {
    const doc = new Y.Doc();
    const registry = new DocumentRegistry(doc);
    expect(registry.nodeCount()).toBe(0);

    doc.transact(() => {
      element(registry, 'parent', 'body');
      element(registry, 'child', 'p');
      registry.putText(asLogicalId('text'), 'hello');
      // Read inside the transaction: Yjs has not delivered the events yet, and the journal's
      // node cap is checked at exactly this point when one commit publishes two journals.
      expect(registry.nodeCount()).toBe(3);
    });
    expect(registry.nodeCount()).toBe(sizeOf(registry));
    expect(registry.nodeCount()).toBe(3);
  });

  test('a repeated put of the same id does not raise the count', () => {
    const doc = new Y.Doc();
    const registry = new DocumentRegistry(doc);
    doc.transact(() => element(registry, 'node', 'p'));
    doc.transact(() => element(registry, 'node', 'p'));
    doc.transact(() => registry.putText(asLogicalId('node'), 'replaced'));
    expect(registry.nodeCount()).toBe(sizeOf(registry));
    expect(registry.nodeCount()).toBe(1);
  });

  test('a remote update and a rebuild both leave the count exact', () => {
    const doc = new Y.Doc();
    const registry = new DocumentRegistry(doc);
    doc.transact(() => {
      element(registry, 'parent', 'body');
      registry.spliceChildren(asLogicalId('parent'), 0, 0, []);
    });

    const peerDoc = new Y.Doc();
    const peerRegistry = new DocumentRegistry(peerDoc);
    peerDoc.transact(() => {
      element(peerRegistry, 'remote-one', 'p');
      element(peerRegistry, 'remote-two', 'p');
    });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peerDoc));
    expect(registry.nodeCount()).toBe(sizeOf(registry));
    expect(registry.nodeCount()).toBe(3);

    registry.rebuildDerivedIndexes();
    expect(registry.nodeCount()).toBe(sizeOf(registry));

    doc.transact(() => registry.schema.nodes.delete('remote-one'));
    expect(registry.nodeCount()).toBe(sizeOf(registry));
    expect(registry.nodeCount()).toBe(2);
  });

  test('a bulk load ends with the count rebuilt', () => {
    const doc = new Y.Doc();
    const registry = new DocumentRegistry(doc);
    registry.beginBulkLoad();
    doc.transact(() => {
      for (let index = 0; index < 40; index += 1) element(registry, `bulk-${index}`, 'p');
    });
    registry.endBulkLoad();
    expect(registry.nodeCount()).toBe(sizeOf(registry));
    expect(registry.nodeCount()).toBe(40);
  });
});
