/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { DocumentRegistry } from '../document/registry.ts';

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

function element(registry: DocumentRegistry, logicalId: string, localName: string): void {
  registry.putElement({
    logicalId,
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
    const childIds: string[] = [];
    for (let index = 0; index < childCount; index += 1) {
      const childId = `child-${index}`;
      element(registry, childId, 'p');
      childIds.push(childId);
    }
    registry.spliceChildren('parent', 0, 0, childIds);
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
        registry.spliceChildren('parent', childCount, 0, ['newborn']);
      });
    });

    expect(comparisons).toBeLessThan(childCount * 4);
    expect(registry.parentOf('newborn')).toBe('parent');
    expect(registry.listingParents('newborn')).toEqual(['parent']);
  });

  test('removing one child from a wide parent is linear too', () => {
    const childCount = 800;
    const { doc, registry } = wideParent(childCount);

    const { comparisons } = countScans(() => {
      doc.transact(() => {
        registry.spliceChildren('parent', 400, 1, []);
      });
    });

    expect(comparisons).toBeLessThan(childCount * 4);
    expect(registry.parentOf('child-400')).toBeNull();
    expect(registry.listingParents('child-400')).toEqual([]);
    expect(registry.parentOf('child-399')).toBe('parent');
    expect(registry.parentOf('child-401')).toBe('parent');
  });

  test('listings stay correct when the same child id is listed twice and dropped once', () => {
    // `unlistChildren` deletes one occurrence at a time, so a duplicate listing is reachable
    // state. Counting membership rather than scanning must not change what stays listed.
    const doc = new Y.Doc();
    const registry = new DocumentRegistry(doc);
    doc.transact(() => {
      element(registry, 'parent', 'body');
      element(registry, 'twin', 'p');
      registry.spliceChildren('parent', 0, 0, ['twin', 'twin']);
    });
    expect(registry.listingParents('twin')).toEqual(['parent']);

    doc.transact(() => {
      registry.spliceChildren('parent', 0, 1, []);
    });
    expect(registry.listingParents('twin')).toEqual(['parent']);

    doc.transact(() => {
      registry.spliceChildren('parent', 0, 1, []);
    });
    expect(registry.listingParents('twin')).toEqual([]);
  });

  test('a child moved between two wide parents ends up under the destination only', () => {
    const doc = new Y.Doc();
    const registry = new DocumentRegistry(doc);
    doc.transact(() => {
      element(registry, 'left', 'body');
      element(registry, 'right', 'body');
      element(registry, 'mover', 'p');
      registry.spliceChildren('left', 0, 0, ['mover']);
    });
    expect(registry.listingParents('mover')).toEqual(['left']);

    doc.transact(() => {
      registry.moveNode('mover', 'right', 0);
    });
    expect(registry.listingParents('mover')).toEqual(['right']);
    expect(registry.parentOf('mover')).toBe('right');
  });
});
