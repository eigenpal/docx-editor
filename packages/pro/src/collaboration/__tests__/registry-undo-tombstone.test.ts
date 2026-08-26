/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { DocumentRegistry } from '../document/registry.ts';
import { NODE_DELETED_FIELD, NODE_SHELL_FIELD } from '../document/schema.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const LOCAL_ORIGIN = Object.freeze({ kind: 'test-local' });

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

/** The item that holds a type, and the first item inside one. Yjs keeps both off its API. */
function itemBehind(type: unknown): Y.Item {
  const item = (type as { _item?: Y.Item | null } | undefined)?._item;
  if (!item) throw new Error('type is not held by an item');
  return item;
}

function firstCharacterItem(text: Y.Text): Y.Item {
  const start = (text as unknown as { _start?: Y.Item | null })._start;
  if (!start) throw new Error('text has no content');
  return start;
}

function firstListItem(array: Y.Array<string>): Y.Item {
  const start = (array as unknown as { _start?: Y.Item | null })._start;
  if (!start) throw new Error('array has no content');
  return start;
}

/** The item holding one key of a record, which for a plain value has no type to reach through. */
function fieldItemOf(nodes: Y.Map<Y.Map<unknown>>, logicalId: string, field: string): Y.Item {
  const record = nodes.get(logicalId);
  const item = (record as unknown as { _map?: Map<string, Y.Item> } | undefined)?._map?.get(field);
  if (!item) throw new Error(`no item for ${logicalId}.${field}`);
  return item;
}

interface Pair {
  readonly aliceDoc: Y.Doc;
  readonly alice: DocumentRegistry;
  readonly bobDoc: Y.Doc;
  readonly bob: DocumentRegistry;
  readonly undo: Y.UndoManager;
}

/** Alice inserts a paragraph under a body that already existed; Bob joins after that. */
function pairWithInsertedParagraph(): Pair {
  const aliceDoc = new Y.Doc();
  aliceDoc.clientID = 1;
  const alice = new DocumentRegistry(aliceDoc);
  aliceDoc.transact(() => {
    element(alice, 'body', 'body');
  }, 'seed');

  // Built the way `document-session.ts` builds it, plus the filter that keeps undo from
  // map-deleting node records.
  const undo = new Y.UndoManager([...alice.trackedTypes()], {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: 0,
    deleteFilter: alice.undoDeleteFilter(),
  });

  aliceDoc.transact(() => {
    element(alice, 'para', 'p');
    element(alice, 'run', 'r');
    alice.putText('text', '');
    alice.spliceChildren('run', 0, 0, ['text']);
    alice.spliceChildren('para', 0, 0, ['run']);
    alice.spliceChildren('body', 0, 0, ['para']);
  }, LOCAL_ORIGIN);

  const bobDoc = new Y.Doc();
  bobDoc.clientID = 2;
  const bob = new DocumentRegistry(bobDoc);
  bob.beginBulkLoad();
  Y.applyUpdate(bobDoc, Y.encodeStateAsUpdate(aliceDoc), 'join');
  bob.endBulkLoad();

  return { aliceDoc, alice, bobDoc, bob, undo };
}

function exchange(left: Y.Doc, right: Y.Doc): void {
  const leftVector = Y.encodeStateVector(left);
  const rightVector = Y.encodeStateVector(right);
  const leftUpdate = Y.encodeStateAsUpdate(left, rightVector);
  const rightUpdate = Y.encodeStateAsUpdate(right, leftVector);
  Y.applyUpdate(right, leftUpdate, 'sync');
  Y.applyUpdate(left, rightUpdate, 'sync');
}

describe('undo keeps node records out of the delete set', () => {
  test('undoing an insert unlists the node but keeps its record', () => {
    // A node record is never map-deleted, because a peer editing inside it anchors its
    // characters there. Undo reverses the `nodes.set` that created the record, which is
    // exactly that delete, so the filter has to hold the record back while still letting the
    // id that listed it under its parent go.
    const { alice, undo } = pairWithInsertedParagraph();
    expect(alice.parentOf('para')).toBe('body');

    undo.undo();

    expect(alice.hasNode('para')).toBe(true);
    expect(alice.hasNode('run')).toBe(true);
    expect(alice.hasNode('text')).toBe(true);
    // Gone from the document: nothing lists it any more.
    expect(alice.listingParents('para')).toEqual([]);
    expect(alice.parentOf('para')).toBeNull();
    expect(alice.childArray('body').toArray()).toEqual([]);
  });

  test('redo puts the node back where it was', () => {
    const { alice, undo } = pairWithInsertedParagraph();
    undo.undo();

    undo.redo();

    expect(alice.childArray('body').toArray()).toEqual(['para']);
    expect(alice.parentOf('para')).toBe('body');
    expect(alice.childArray('run').toArray()).toEqual(['text']);
  });

  test("undoing an insert does not destroy a peer's concurrent typing inside it", () => {
    const { aliceDoc, alice, bobDoc, bob, undo } = pairWithInsertedParagraph();

    // Concurrent: Bob types into the paragraph while Alice undoes the insert of it.
    bobDoc.transact(() => {
      bob.spliceText('text', 0, 0, 'hello');
    }, 'bob-local');
    undo.undo();

    exchange(aliceDoc, bobDoc);

    // The characters must stay reachable on both replicas. An orphaned subtree can be audited
    // or rescued; a deleted one is gone from every API there is.
    for (const registry of [alice, bob]) {
      expect(registry.hasNode('text')).toBe(true);
      const record = registry.record('text');
      expect(record?.kind).toBe('textValue');
      expect((record as { value: string }).value).toBe('hello');
    }
  });

  test('the filter holds back record containers only, not their plain fields', () => {
    // The plain fields are the line between closing the hazard and breaking everyday undo. A
    // container can hold a peer's write, so pinning it prevents loss; `deleted` and the packed
    // shell hold nobody else's content, and pinning those strands a superseded node instead.
    const doc = new Y.Doc();
    const registry = new DocumentRegistry(doc);
    doc.transact(() => {
      element(registry, 'body', 'body');
      registry.putText('text', 'ab');
      registry.spliceChildren('body', 0, 0, ['text']);
      registry.tombstone('body');
    });
    const filter = registry.undoDeleteFilter();
    const nodes = registry.schema.nodes;

    const recordItem = itemBehind(nodes.get('text'));
    const textFieldItem = itemBehind(registry.textOf('text'));
    const childrenFieldItem = itemBehind(registry.childArray('body'));
    const characterItem = firstCharacterItem(registry.textOf('text'));
    const childIdItem = firstListItem(registry.childArray('body'));

    expect(filter(recordItem)).toBe(false);
    expect(filter(textFieldItem)).toBe(false);
    expect(filter(childrenFieldItem)).toBe(false);
    expect(filter(fieldItemOf(nodes, 'body', NODE_DELETED_FIELD))).toBe(true);
    expect(filter(fieldItemOf(nodes, 'body', NODE_SHELL_FIELD))).toBe(true);
    expect(filter(characterItem)).toBe(true);
    expect(filter(childIdItem)).toBe(true);
  });
});
