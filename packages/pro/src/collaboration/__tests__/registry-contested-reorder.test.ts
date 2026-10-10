/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Concurrent splits can leave one child, such as a run's `w:rPr`, listed by two runs. The
// child shows under the lister that comes first in the document. When the listers change
// order and the child's own listings do not, the replica must decide again; otherwise a live
// replica keeps the old answer and disagrees with a replica that reads shared state fresh.
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { DocumentRegistry } from '../document/registry.ts';
import { asLogicalId, type LogicalId } from '../document/identity.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

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

/** A part whose paragraph holds runs `first` and `second`, which both list `shared`. */
function twoListers(): { readonly doc: Y.Doc; readonly registry: DocumentRegistry } {
  const doc = new Y.Doc();
  const registry = new DocumentRegistry(doc);
  doc.transact(() => {
    element(registry, 'root', 'document');
    element(registry, 'paragraph', 'p');
    element(registry, 'first', 'r');
    element(registry, 'second', 'r');
    element(registry, 'shared', 'rPr');
    registry.spliceChildren(asLogicalId('root'), 0, 0, [asLogicalId('paragraph')]);
    registry.spliceChildren(asLogicalId('paragraph'), 0, 0, [
      asLogicalId('first'),
      asLogicalId('second'),
    ]);
    registry.spliceChildren(asLogicalId('first'), 0, 0, [asLogicalId('shared')]);
    registry.spliceChildren(asLogicalId('second'), 0, 0, [asLogicalId('shared')]);
    registry.putXmlPart({
      name: '/word/document.xml',
      id: '/word/document.xml',
      rootLogicalId: asLogicalId('root'),
      contentType: 'application/xml',
    });
  });
  return { doc, registry };
}

function freshParentOf(doc: Y.Doc, id: string): string | null {
  const fresh = new DocumentRegistry(doc);
  fresh.rebuildDerivedIndexes();
  return fresh.parentOf(asLogicalId(id));
}

describe('a child several parents list', () => {
  test('goes to the lister first in the document', () => {
    const { doc, registry } = twoListers();
    expect(registry.parentOf(asLogicalId('shared'))).toBe(asLogicalId('first'));
    expect(freshParentOf(doc, 'shared')).toBe('first');
  });

  test('moves when its listers change order, though its own listings did not', () => {
    const { doc, registry } = twoListers();
    registry.takeReparented();
    doc.transact(() => {
      registry.spliceChildren(asLogicalId('paragraph'), 0, 1, []);
      registry.spliceChildren(asLogicalId('paragraph'), 1, 0, [asLogicalId('first')]);
    });
    expect(registry.parentOf(asLogicalId('shared'))).toBe(asLogicalId('second'));
    expect(freshParentOf(doc, 'shared')).toBe('second');
    // Both runs rebuild: one loses the child, the other gains it.
    expect([...registry.takeReparented()].sort()).toEqual([
      asLogicalId('first'),
      asLogicalId('second'),
    ]);
    expect(registry.takeReparented()).toEqual([]);
  });

  test('stops being contested once only one parent lists it', () => {
    const { doc, registry } = twoListers();
    doc.transact(() => registry.spliceChildren(asLogicalId('first'), 0, 1, []));
    expect(registry.parentOf(asLogicalId('shared'))).toBe(asLogicalId('second'));
    // Later reorders no longer touch it, and its parent stays.
    registry.takeReparented();
    doc.transact(() => {
      registry.spliceChildren(asLogicalId('paragraph'), 0, 1, []);
      registry.spliceChildren(asLogicalId('paragraph'), 1, 0, [asLogicalId('first')]);
    });
    expect(registry.parentOf(asLogicalId('shared'))).toBe(asLogicalId('second'));
    expect(registry.takeReparented()).toEqual([]);
  });

  test('deciding many contests again costs one pass over the body, not one per contest', () => {
    // A peer can list existing runs in a second paragraph, so contests are remote input. Each
    // one climbs to the body root, and scanning that child array per contest made every
    // structural edit cost contests times blocks on every replica.
    const doc = new Y.Doc();
    const registry = new DocumentRegistry(doc);
    const blocks = 2000;
    const contests = 1000;
    doc.transact(() => {
      element(registry, 'root', 'document');
      element(registry, 'body', 'body');
      registry.spliceChildren(asLogicalId('root'), 0, 0, [asLogicalId('body')]);
      const paragraphs: LogicalId[] = [];
      for (let index = 0; index < blocks; index += 1) {
        element(registry, `p${index}`, 'p');
        element(registry, `r${index}`, 'r');
        registry.spliceChildren(asLogicalId(`p${index}`), 0, 0, [asLogicalId(`r${index}`)]);
        paragraphs.push(asLogicalId(`p${index}`));
      }
      element(registry, 'rival', 'p');
      registry.spliceChildren(asLogicalId('body'), 0, 0, [...paragraphs, asLogicalId('rival')]);
      registry.spliceChildren(
        asLogicalId('rival'),
        0,
        0,
        Array.from({ length: contests }, (_, index) => asLogicalId(`r${index}`))
      );
      registry.putXmlPart({
        name: '/word/document.xml',
        id: '/word/document.xml',
        rootLogicalId: asLogicalId('root'),
        contentType: 'application/xml',
      });
    });
    expect(registry.parentOf(asLogicalId('r0'))).toBe(asLogicalId('p0'));
    let comparisons = 0;
    const originalIndexOf = Array.prototype.indexOf;
    Array.prototype.indexOf = function (this: unknown[], value: unknown): number {
      for (let index = 0; index < this.length; index += 1) {
        comparisons += 1;
        if (this[index] === value) return index;
      }
      return -1;
    } as typeof Array.prototype.indexOf;
    try {
      // One structural edit, as Enter is.
      doc.transact(() => {
        element(registry, 'tail', 'p');
        registry.spliceChildren(asLogicalId('body'), blocks, 0, [asLogicalId('tail')]);
      });
    } finally {
      Array.prototype.indexOf = originalIndexOf;
    }
    expect(comparisons).toBeLessThan(blocks * 4);
    expect(registry.parentOf(asLogicalId('r0'))).toBe(asLogicalId('p0'));
  });
});
