/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { DocumentRegistry } from '../document/registry.ts';
import type { EncodedRelationship } from '../document/schema.ts';

const HYPERLINK = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

function rel(
  ownerPart: string,
  id: string,
  rawTarget: string,
  type = HYPERLINK
): EncodedRelationship {
  return { ownerPart, id, type, rawTarget, targetMode: 'External', order: 0 };
}

function idsFor(registry: DocumentRegistry, ownerPart: string): string[] {
  return registry
    .relationships()
    .filter((record) => record.ownerPart === ownerPart)
    .map((record) => record.id)
    .sort();
}

function exchange(left: Y.Doc, right: Y.Doc): void {
  const leftVector = Y.encodeStateVector(left);
  const rightVector = Y.encodeStateVector(right);
  const leftUpdate = Y.encodeStateAsUpdate(left, rightVector);
  const rightUpdate = Y.encodeStateAsUpdate(right, leftVector);
  Y.applyUpdate(right, leftUpdate, 'sync');
  Y.applyUpdate(left, rightUpdate, 'sync');
}

describe('relationship writes survive a concurrent first-create', () => {
  test('two peers adding the first relationship of a part both keep their id', () => {
    // The part has no relationships yet, so both peers take the "create the owner map" branch.
    // Nested `Y.Map` creation is last-writer-wins on the part key: the loser's map, and the
    // rId inside it, used to become unreachable — a permanently broken image or dead link.
    const alice = new Y.Doc();
    alice.clientID = 1;
    const bob = new Y.Doc();
    bob.clientID = 2;
    const aliceRegistry = new DocumentRegistry(alice);
    const bobRegistry = new DocumentRegistry(bob);
    const part = 'word/comments.xml';

    alice.transact(() => {
      aliceRegistry.putRelationship(rel(part, 'rId1', 'https://alice.example/'));
    });
    bob.transact(() => {
      bobRegistry.putRelationship(rel(part, 'rId2', 'https://bob.example/'));
    });

    exchange(alice, bob);

    expect(idsFor(aliceRegistry, part)).toEqual(['rId1', 'rId2']);
    expect(idsFor(bobRegistry, part)).toEqual(['rId1', 'rId2']);
    const targets = aliceRegistry
      .relationships()
      .filter((record) => record.ownerPart === part)
      .map((record) => record.rawTarget)
      .sort();
    expect(targets).toEqual(['https://alice.example/', 'https://bob.example/']);
  });

  test('a concurrent first-create on two different parts keeps both parts', () => {
    const alice = new Y.Doc();
    alice.clientID = 1;
    const bob = new Y.Doc();
    bob.clientID = 2;
    const aliceRegistry = new DocumentRegistry(alice);
    const bobRegistry = new DocumentRegistry(bob);

    alice.transact(() => {
      aliceRegistry.putRelationship(rel('word/footnotes.xml', 'rId1', 'media/a.png', IMAGE));
    });
    bob.transact(() => {
      bobRegistry.putRelationship(rel('word/endnotes.xml', 'rId1', 'media/b.png', IMAGE));
    });

    exchange(alice, bob);

    expect(idsFor(aliceRegistry, 'word/footnotes.xml')).toEqual(['rId1']);
    expect(idsFor(aliceRegistry, 'word/endnotes.xml')).toEqual(['rId1']);
    expect(idsFor(bobRegistry, 'word/footnotes.xml')).toEqual(['rId1']);
    expect(idsFor(bobRegistry, 'word/endnotes.xml')).toEqual(['rId1']);
  });

  test('delete removes the relationship on both replicas', () => {
    const alice = new Y.Doc();
    alice.clientID = 1;
    const bob = new Y.Doc();
    bob.clientID = 2;
    const aliceRegistry = new DocumentRegistry(alice);
    const bobRegistry = new DocumentRegistry(bob);
    const part = 'word/document.xml';

    alice.transact(() => {
      aliceRegistry.putRelationship(rel(part, 'rId1', 'https://one.example/'));
      aliceRegistry.putRelationship(rel(part, 'rId2', 'https://two.example/'));
    });
    exchange(alice, bob);
    expect(idsFor(bobRegistry, part)).toEqual(['rId1', 'rId2']);

    alice.transact(() => {
      aliceRegistry.deleteRelationship(part, 'rId1');
    });
    exchange(alice, bob);

    expect(idsFor(aliceRegistry, part)).toEqual(['rId2']);
    expect(idsFor(bobRegistry, part)).toEqual(['rId2']);
  });

  test('the same id written twice for one part stays one record', () => {
    const doc = new Y.Doc();
    const registry = new DocumentRegistry(doc);
    const part = 'word/document.xml';
    doc.transact(() => {
      registry.putRelationship(rel(part, 'rId1', 'https://first.example/'));
      registry.putRelationship(rel(part, 'rId1', 'https://second.example/'));
    });
    const records = registry.relationships().filter((record) => record.ownerPart === part);
    expect(records).toHaveLength(1);
    expect(records[0]?.rawTarget).toBe('https://second.example/');
  });
});
