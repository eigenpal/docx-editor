/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A survivor shows each joined paragraph's children after its own, in one order on every
// replica. The order came from the order a replica processed the tombstones, so two replicas
// that received the joins differently showed one paragraph's pieces differently, both `ready`.
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { NODE_REPLACED_BY_FIELD, bySurvivorEdge } from '../document/schema.ts';

function join(doc: Y.Doc, id: string): void {
  const nodes = doc.getMap<Y.Map<unknown>>('nodes');
  doc.transact(() => {
    if (!nodes.has(id)) nodes.set(id, new Y.Map());
    nodes.get(id)!.set(NODE_REPLACED_BY_FIELD, 'survivor');
  });
}

describe('bySurvivorEdge', () => {
  test('one author: joins keep the order they were made', () => {
    const doc = new Y.Doc();
    doc.clientID = 7;
    join(doc, 'second');
    join(doc, 'first-made-later');
    const nodes = doc.getMap('nodes');
    expect(bySurvivorEdge(nodes, ['first-made-later', 'second'])).toEqual([
      'second',
      'first-made-later',
    ]);
  });

  test('two authors: replicas that integrated the joins in opposite orders agree', () => {
    const alice = new Y.Doc();
    alice.clientID = 1;
    const carol = new Y.Doc();
    carol.clientID = 2;
    join(alice, 'from-alice');
    join(carol, 'from-carol');
    const fromAlice = Y.encodeStateAsUpdate(alice);
    const fromCarol = Y.encodeStateAsUpdate(carol);

    const bob = new Y.Doc();
    Y.applyUpdate(bob, fromCarol);
    Y.applyUpdate(bob, fromAlice);
    const dave = new Y.Doc();
    Y.applyUpdate(dave, fromAlice);
    Y.applyUpdate(dave, fromCarol);

    const order = (doc: Y.Doc, arrival: string[]) => bySurvivorEdge(doc.getMap('nodes'), arrival);
    expect(order(bob, ['from-carol', 'from-alice'])).toEqual(
      order(dave, ['from-alice', 'from-carol'])
    );
  });
});
