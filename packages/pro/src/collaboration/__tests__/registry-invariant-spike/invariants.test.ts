/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { applyRemote, pair, snapshotVector, sync, updateSince, type Replica } from './harness.ts';
import {
  findNode,
  insertChild,
  insertText,
  issueCodes,
  materialize,
  moveNode,
  parentOf,
  ROOT_ID,
  type FrozenNode,
  type ModelKind,
} from './model.ts';

const MODELS: ModelKind[] = ['child-array', 'parent-register'];

function view(replica: Replica, previous?: ReadonlyMap<string, FrozenNode> | null) {
  return materialize(replica.nodes, ROOT_ID, replica.model, previous ?? null);
}

function both(alice: Replica, bob: Replica) {
  return { alice: view(alice), bob: view(bob) };
}

function ids(node: FrozenNode | null): string[] {
  if (!node) return [];
  return [node.id, ...node.children.flatMap(ids)];
}

describe.each(MODELS)('registry invariants (%s)', (model) => {
  test('concurrent move preserves identity and descendant edits', () => {
    const { alice, bob, destroy } = pair(model);
    try {
      const baseline = snapshotVector(alice.doc);
      moveNode(alice.nodes, alice.origin, model, 'p2', 'p1', 1);
      insertText(bob.nodes, bob.origin, 'r2', 3, '-bob');
      applyRemote(alice.doc, updateSince(bob.doc, baseline));
      applyRemote(bob.doc, updateSince(alice.doc, baseline));
      const { alice: left, bob: right } = both(alice, bob);
      expect(left.fingerprint).toBe(right.fingerprint);
      expect(left.quarantined).toBe(false);
      const moved = findNode(left.root!, 'p2');
      const edited = findNode(left.root!, 'r2');
      expect(moved?.id).toBe('p2');
      expect(edited?.id).toBe('r2');
      expect(edited?.text).toBe('two-bob');
      expect(parentOf(left.root!, 'p2')?.id).toBe('p1');
      expect(ids(left.root)).toContain('p3');
    } finally {
      destroy();
    }
  });

  test('two concurrent reparents keep one identity and converge', () => {
    const { alice, bob, destroy } = pair(model);
    try {
      const baseline = snapshotVector(alice.doc);
      moveNode(alice.nodes, alice.origin, model, 'p2', 'p1', 1);
      moveNode(bob.nodes, bob.origin, model, 'p2', 'p3', 1);
      applyRemote(alice.doc, updateSince(bob.doc, baseline));
      applyRemote(bob.doc, updateSince(alice.doc, baseline));
      const { alice: left, bob: right } = both(alice, bob);
      expect(left.fingerprint).toBe(right.fingerprint);
      const matches = ids(left.root).filter((id) => id === 'p2');
      expect(matches).toEqual(['p2']);
      expect(findNode(left.root!, 'r2')?.text).toBe('two');
      const parent = parentOf(left.root!, 'p2')?.id;
      expect(parent === 'p1' || parent === 'p3').toBe(true);
      if (model === 'child-array') {
        expect(parent).toBe('p1');
        expect(issueCodes(left.issues)).toContain('duplicate-parent');
      }
    } finally {
      destroy();
    }
  });

  test('reversed and duplicated deliveries converge', () => {
    const { alice, bob, destroy } = pair(model);
    try {
      const baseline = snapshotVector(alice.doc);
      moveNode(alice.nodes, alice.origin, model, 'p2', 'p1', 1);
      insertText(bob.nodes, bob.origin, 'r3', 0, 'x');
      const aliceUpdate = updateSince(alice.doc, baseline);
      const bobUpdate = updateSince(bob.doc, baseline);
      applyRemote(alice.doc, bobUpdate);
      applyRemote(alice.doc, bobUpdate);
      applyRemote(bob.doc, aliceUpdate);
      applyRemote(bob.doc, aliceUpdate);
      const { alice: left, bob: right } = both(alice, bob);
      expect(left.fingerprint).toBe(right.fingerprint);
      expect(findNode(left.root!, 'r3')?.text).toBe('xthree');
      expect(parentOf(left.root!, 'p2')?.id).toBe('p1');
    } finally {
      destroy();
    }
  });

  test('mutual reparent creates an unreachable cycle and quarantines', () => {
    const { alice, bob, destroy } = pair(model);
    try {
      moveNode(alice.nodes, alice.origin, model, 'p1', 'p2', 1);
      moveNode(bob.nodes, bob.origin, model, 'p2', 'p1', 1);
      sync(alice.doc, bob.doc);
      const { alice: left, bob: right } = both(alice, bob);
      expect(left.fingerprint).toBe(right.fingerprint);
      expect(left.quarantined).toBe(true);
      expect(issueCodes(left.issues)).toContain('orphan-with-content');
      expect(issueCodes(left.issues)).toContain('unreachable-cycle');
      expect(ids(left.root)).not.toContain('p1');
      expect(ids(left.root)).not.toContain('p2');
      expect(alice.nodes.has('p1')).toBe(true);
      expect(alice.nodes.has('r1')).toBe(true);
    } finally {
      destroy();
    }
  });

  test('concurrent inserts at the same index converge in one order', () => {
    const { alice, bob, destroy } = pair(model);
    try {
      const baseline = snapshotVector(alice.doc);
      insertChild(alice.nodes, alice.origin, model, ROOT_ID, 0, 'pA', 'p', '');
      insertChild(bob.nodes, bob.origin, model, ROOT_ID, 0, 'pB', 'p', '');
      applyRemote(bob.doc, updateSince(alice.doc, baseline));
      applyRemote(alice.doc, updateSince(bob.doc, baseline));
      const { alice: left, bob: right } = both(alice, bob);
      expect(left.fingerprint).toBe(right.fingerprint);
      const names = left.root!.children.map((child) => child.id);
      expect(names).toContain('pA');
      expect(names).toContain('pB');
      expect(new Set(names).size).toBe(names.length);
    } finally {
      destroy();
    }
  });

  test('materialization reuses unaffected node identities', () => {
    const { alice, bob, destroy } = pair(model);
    try {
      const before = view(alice);
      const p3 = findNode(before.root!, 'p3');
      const r3 = findNode(before.root!, 'r3');
      const p1 = findNode(before.root!, 'p1');
      insertText(alice.nodes, alice.origin, 'r2', 3, '!');
      const after = view(alice, before.cache);
      expect(findNode(after.root!, 'p3')).toBe(p3);
      expect(findNode(after.root!, 'r3')).toBe(r3);
      expect(findNode(after.root!, 'p1')).toBe(p1);
      expect(findNode(after.root!, 'r2')).not.toBe(findNode(before.root!, 'r2'));
      expect(findNode(after.root!, 'p2')).not.toBe(findNode(before.root!, 'p2'));
      expect(after.root).not.toBe(before.root);
      expect(after.allocated).toBe(3);
      sync(alice.doc, bob.doc);
      expect(view(bob).fingerprint).toBe(after.fingerprint);
    } finally {
      destroy();
    }
  });

  test('fresh and incremental materialization match', () => {
    const { alice, destroy } = pair(model);
    try {
      const first = view(alice);
      insertText(alice.nodes, alice.origin, 'r1', 0, '[');
      moveNode(alice.nodes, alice.origin, model, 'p3', 'p1', 2);
      const incremental = view(alice, first.cache);
      const fresh = view(alice);
      expect(incremental.fingerprint).toBe(fresh.fingerprint);
      expect(incremental.quarantined).toBe(false);
    } finally {
      destroy();
    }
  });
});

describe('cycle edges by model', () => {
  test('child-array drops a reachable back-edge on first visit', () => {
    const { alice, bob, destroy } = pair('child-array');
    try {
      moveNode(alice.nodes, alice.origin, 'child-array', 'p2', 'p1', 1);
      sync(alice.doc, bob.doc);
      const record = alice.nodes.get('p2');
      if (!(record instanceof Y.Map)) throw new Error('missing p2');
      const array = record.get('children');
      if (!(array instanceof Y.Array)) throw new Error('missing children');
      alice.doc.transact(() => array.push(['p1']), alice.origin);
      sync(alice.doc, bob.doc);
      const left = view(alice);
      expect(left.fingerprint).toBe(view(bob).fingerprint);
      expect(left.quarantined).toBe(false);
      expect(issueCodes(left.issues)).toContain('cycle');
      expect(parentOf(left.root!, 'p2')?.id).toBe('p1');
      expect(findNode(left.root!, 'r2')?.text).toBe('two');
    } finally {
      destroy();
    }
  });

  test('parent-register treats a child-array back-edge as a stale hint', () => {
    const { alice, bob, destroy } = pair('parent-register');
    try {
      moveNode(alice.nodes, alice.origin, 'parent-register', 'p2', 'p1', 1);
      sync(alice.doc, bob.doc);
      const record = alice.nodes.get('p2');
      if (!(record instanceof Y.Map)) throw new Error('missing p2');
      const array = record.get('children');
      if (!(array instanceof Y.Array)) throw new Error('missing children');
      alice.doc.transact(() => array.push(['p1']), alice.origin);
      sync(alice.doc, bob.doc);
      const left = view(alice);
      expect(left.fingerprint).toBe(view(bob).fingerprint);
      expect(left.quarantined).toBe(false);
      expect(issueCodes(left.issues)).toContain('stale-child-hint');
      expect(issueCodes(left.issues)).not.toContain('cycle');
      expect(parentOf(left.root!, 'p2')?.id).toBe('p1');
    } finally {
      destroy();
    }
  });
});

describe('parent-register stale hints', () => {
  test('filters child-array membership by parentId', () => {
    const { alice, bob, destroy } = pair('parent-register');
    try {
      const p1 = alice.nodes.get('p1');
      const p3 = alice.nodes.get('p3');
      if (!(p1 instanceof Y.Map) || !(p3 instanceof Y.Map)) throw new Error('missing nodes');
      const p1Children = p1.get('children');
      const p3Children = p3.get('children');
      if (!(p1Children instanceof Y.Array) || !(p3Children instanceof Y.Array)) {
        throw new Error('missing children');
      }
      alice.doc.transact(() => p1Children.push(['p2']), alice.origin);
      sync(alice.doc, bob.doc);
      const left = view(alice);
      expect(parentOf(left.root!, 'p2')?.id).toBe(ROOT_ID);
      expect(issueCodes(left.issues)).toContain('stale-child-hint');
      expect(ids(left.root).filter((id) => id === 'p2')).toEqual(['p2']);
      const p2 = alice.nodes.get('p2');
      if (!(p2 instanceof Y.Map)) throw new Error('missing p2');
      alice.doc.transact(() => p2.set('parentId', 'p3'), alice.origin);
      sync(alice.doc, bob.doc);
      const next = view(alice);
      expect(issueCodes(next.issues)).toContain('missing-parent-hint');
      expect(parentOf(next.root!, 'p2')?.id).toBe('p3');
      expect(view(bob).fingerprint).toBe(next.fingerprint);
    } finally {
      destroy();
    }
  });
});
