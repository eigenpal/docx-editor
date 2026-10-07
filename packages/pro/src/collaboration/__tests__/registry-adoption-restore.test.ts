/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A join survivor shows the live children of the paragraph it replaced. When one of those
// children comes back (an undone delete), the survivor shows it again on a live replica, as a
// replica that reads shared state fresh does. The event names the child, not the survivor.
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { DocumentRegistry } from '../document/registry.ts';
import { NODE_DELETED_FIELD } from '../document/schema.ts';
import { asLogicalId, type LogicalId } from '../document/identity.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function element(registry: DocumentRegistry, logicalId: string, localName: string): void {
  registry.putElement({
    logicalId: asLogicalId(logicalId),
    kind: localName === 'r' ? 'run' : 'generic',
    namespaceUri: W,
    localName,
    attributes: [],
    bindings: [],
  });
}

function freshAdoptees(doc: Y.Doc, survivor: string): readonly LogicalId[] {
  const fresh = new DocumentRegistry(doc);
  fresh.rebuildDerivedIndexes();
  return fresh.adoptedChildren(asLogicalId(survivor));
}

describe('a join survivor and a restored child', () => {
  test('a child deleted before the join and restored after it is adopted again', () => {
    const doc = new Y.Doc();
    const registry = new DocumentRegistry(doc);
    doc.transact(() => {
      element(registry, 'root', 'document');
      element(registry, 'survivor', 'p');
      element(registry, 'joined', 'p');
      element(registry, 'run', 'r');
      registry.spliceChildren(asLogicalId('root'), 0, 0, [
        asLogicalId('survivor'),
        asLogicalId('joined'),
      ]);
      registry.spliceChildren(asLogicalId('joined'), 0, 0, [asLogicalId('run')]);
    });
    const run = registry.schema.nodes.get('run')!;
    // The run is deleted while still listed, as a journal's delete leaves it for undo.
    doc.transact(() => run.set(NODE_DELETED_FIELD, true));
    doc.transact(() => registry.tombstone(asLogicalId('joined'), asLogicalId('survivor')));
    expect(registry.adoptedChildren(asLogicalId('survivor'))).toEqual([]);
    // Undo removes the delete mark from the run's own record.
    doc.transact(() => run.delete(NODE_DELETED_FIELD));
    expect(registry.adoptedChildren(asLogicalId('survivor'))).toEqual([asLogicalId('run')]);
    expect(freshAdoptees(doc, 'survivor')).toEqual([asLogicalId('run')]);
  });

  test('a paragraph that arrives already joined hands its children to the survivor', () => {
    const author = new Y.Doc();
    const authorRegistry = new DocumentRegistry(author);
    author.transact(() => {
      element(authorRegistry, 'root', 'document');
      element(authorRegistry, 'survivor', 'p');
      authorRegistry.spliceChildren(asLogicalId('root'), 0, 0, [asLogicalId('survivor')]);
    });
    const reader = new Y.Doc();
    const registry = new DocumentRegistry(reader);
    Y.applyUpdate(reader, Y.encodeStateAsUpdate(author));
    const before = Y.encodeStateVector(author);
    // Created, filled and joined before the reader hears of it: one update.
    author.transact(() => {
      element(authorRegistry, 'joined', 'p');
      element(authorRegistry, 'run', 'r');
      authorRegistry.spliceChildren(asLogicalId('joined'), 0, 0, [asLogicalId('run')]);
      authorRegistry.tombstone(asLogicalId('joined'), asLogicalId('survivor'));
    });
    Y.applyUpdate(reader, Y.encodeStateAsUpdate(author, before));
    expect(registry.adoptedChildren(asLogicalId('survivor'))).toEqual([asLogicalId('run')]);
    expect(freshAdoptees(reader, 'survivor')).toEqual([asLogicalId('run')]);
  });

  test('a child whose record arrives after its listing is adopted when it arrives', () => {
    const author = new Y.Doc();
    const authorRegistry = new DocumentRegistry(author);
    author.transact(() => {
      element(authorRegistry, 'root', 'document');
      element(authorRegistry, 'survivor', 'p');
      element(authorRegistry, 'joined', 'p');
      authorRegistry.spliceChildren(asLogicalId('root'), 0, 0, [
        asLogicalId('survivor'),
        asLogicalId('joined'),
      ]);
      authorRegistry.spliceChildren(asLogicalId('joined'), 0, 0, [asLogicalId('run')]);
    });
    author.transact(() => authorRegistry.tombstone(asLogicalId('joined'), asLogicalId('survivor')));
    const reader = new Y.Doc();
    const registry = new DocumentRegistry(reader);
    Y.applyUpdate(reader, Y.encodeStateAsUpdate(author));
    // `joined` arrived already joined into `survivor`; its listed run has no record yet.
    expect(registry.adoptedChildren(asLogicalId('survivor'))).toEqual([]);
    const before = Y.encodeStateVector(author);
    author.transact(() => element(authorRegistry, 'run', 'r'));
    Y.applyUpdate(reader, Y.encodeStateAsUpdate(author, before));
    expect(registry.adoptedChildren(asLogicalId('survivor'))).toEqual([asLogicalId('run')]);
    expect(freshAdoptees(reader, 'survivor')).toEqual([asLogicalId('run')]);
  });
});
