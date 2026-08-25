import { describe, expect, test } from 'bun:test';
import { pair, snapshotVector, sync, updateSince, applyRemote, type Replica } from './harness.ts';
import {
  deleteNode,
  findNode,
  insertChild,
  insertText,
  issueCodes,
  joinNodes,
  materialize,
  moveNode,
  nodeRecord,
  nodeText,
  parentOf,
  ROOT_ID,
  type FrozenNode,
  type ModelKind,
} from './model.ts';

const MODELS: ModelKind[] = ['child-array', 'parent-register'];

function view(
  replica: Replica,
  previous?: ReadonlyMap<string, FrozenNode> | null,
  followReplacedBy = true
) {
  return materialize(replica.nodes, ROOT_ID, replica.model, previous ?? null, {
    followReplacedBy,
  });
}

describe.each(MODELS)('delete versus edit (%s)', (model) => {
  test('tombstone delete drops the subtree and keeps the descendant record', () => {
    const { alice, bob, destroy } = pair(model);
    try {
      const baseline = snapshotVector(alice.doc);
      deleteNode(alice.nodes, alice.origin, model, 'p2', 'tombstone');
      insertText(bob.nodes, bob.origin, 'r2', 3, '-keep');
      applyRemote(alice.doc, updateSince(bob.doc, baseline));
      applyRemote(bob.doc, updateSince(alice.doc, baseline));
      const left = view(alice);
      expect(left.fingerprint).toBe(view(bob).fingerprint);
      expect(idsOf(left.root)).not.toContain('p2');
      expect(idsOf(left.root)).not.toContain('r2');
      expect(alice.nodes.has('r2')).toBe(true);
      expect(nodeText(nodeRecord(alice.nodes, 'r2')!)?.toString()).toBe('two-keep');
      expect(left.quarantined).toBe(true);
      expect(issueCodes(left.issues)).toContain('orphan-with-content');
    } finally {
      destroy();
    }
  });

  test('unlink delete without a tombstone also quarantines edited descendants', () => {
    const { alice, bob, destroy } = pair(model);
    try {
      deleteNode(alice.nodes, alice.origin, model, 'p2', 'unlink');
      insertText(bob.nodes, bob.origin, 'r2', 0, '*');
      sync(alice.doc, bob.doc);
      const left = view(alice);
      expect(left.quarantined).toBe(true);
      expect(issueCodes(left.issues)).toContain('orphan-with-content');
      expect(findNode(left.root!, 'p3')?.id).toBe('p3');
    } finally {
      destroy();
    }
  });

  test('map-delete of a parent leaves descendant records as orphans', () => {
    const { alice, bob, destroy } = pair(model);
    try {
      deleteNode(alice.nodes, alice.origin, model, 'p2', 'map-delete');
      insertText(bob.nodes, bob.origin, 'r2', 3, '-keep');
      sync(alice.doc, bob.doc);
      const left = view(alice);
      expect(left.fingerprint).toBe(view(bob).fingerprint);
      expect(alice.nodes.has('p2')).toBe(false);
      expect(alice.nodes.has('r2')).toBe(true);
      expect(nodeText(nodeRecord(alice.nodes, 'r2')!)?.toString()).toBe('two-keep');
      expect(idsOf(left.root)).not.toContain('r2');
      expect(left.quarantined).toBe(true);
    } finally {
      destroy();
    }
  });

  test('map-delete of the edited node drops concurrent text', () => {
    const { alice, bob, destroy } = pair(model);
    try {
      deleteNode(alice.nodes, alice.origin, model, 'r2', 'map-delete');
      insertText(bob.nodes, bob.origin, 'r2', 3, '-lost');
      sync(alice.doc, bob.doc);
      expect(alice.nodes.has('r2')).toBe(false);
      expect(bob.nodes.has('r2')).toBe(false);
      expect(idsOf(view(alice).root)).not.toContain('r2');
    } finally {
      destroy();
    }
  });
});

describe.each(MODELS)('join versus edit (%s)', (model) => {
  test('join plus descendant text edit keeps the run under the survivor', () => {
    const { alice, bob, destroy } = pair(model);
    try {
      joinNodes(alice.nodes, alice.origin, model, 'p1', 'p2');
      insertText(bob.nodes, bob.origin, 'r2', 3, '-bob');
      sync(alice.doc, bob.doc);
      const left = view(alice);
      expect(left.fingerprint).toBe(view(bob).fingerprint);
      expect(left.quarantined).toBe(false);
      expect(parentOf(left.root!, 'r2')?.id).toBe('p1');
      expect(findNode(left.root!, 'r2')?.text).toBe('two-bob');
      expect(idsOf(left.root)).not.toContain('p2');
      expect(alice.nodes.has('p2')).toBe(true);
    } finally {
      destroy();
    }
  });

  test('join plus concurrent child insert needs replacedBy adoption', () => {
    const { alice, bob, destroy } = pair(model);
    try {
      joinNodes(alice.nodes, alice.origin, model, 'p1', 'p2');
      insertChild(bob.nodes, bob.origin, model, 'p2', 1, 'r2b', 'r', 'extra');
      sync(alice.doc, bob.doc);
      const without = view(alice, null, false);
      expect(without.quarantined).toBe(true);
      expect(idsOf(without.root)).not.toContain('r2b');
      const withRepair = view(alice, null, true);
      expect(withRepair.fingerprint).toBe(view(bob, null, true).fingerprint);
      expect(withRepair.quarantined).toBe(false);
      expect(parentOf(withRepair.root!, 'r2')?.id).toBe('p1');
      expect(parentOf(withRepair.root!, 'r2b')?.id).toBe('p1');
      expect(findNode(withRepair.root!, 'r2b')?.text).toBe('extra');
    } finally {
      destroy();
    }
  });
});

describe.each(MODELS)('actor undo (%s)', (model) => {
  test('undo of a move restores placement and keeps remote descendant text', () => {
    const { alice, bob, destroy } = pair(model);
    try {
      moveNode(alice.nodes, alice.origin, model, 'p2', 'p1', 1);
      insertText(bob.nodes, bob.origin, 'r2', 3, '-bob');
      sync(alice.doc, bob.doc);
      expect(parentOf(view(alice).root!, 'p2')?.id).toBe('p1');
      expect(alice.undo.undoStack.length).toBeGreaterThan(0);
      alice.undo.undo();
      sync(alice.doc, bob.doc);
      const left = view(alice);
      expect(left.fingerprint).toBe(view(bob).fingerprint);
      expect(parentOf(left.root!, 'p2')?.id).toBe(ROOT_ID);
      expect(findNode(left.root!, 'r2')?.text).toBe('two-bob');
      expect(left.quarantined).toBe(false);
    } finally {
      destroy();
    }
  });

  test('undo of a join restores the removed paragraph without dropping remote text', () => {
    const { alice, bob, destroy } = pair(model);
    try {
      joinNodes(alice.nodes, alice.origin, model, 'p1', 'p2');
      insertText(bob.nodes, bob.origin, 'r2', 3, '-bob');
      sync(alice.doc, bob.doc);
      expect(idsOf(view(alice).root)).not.toContain('p2');
      alice.undo.undo();
      sync(alice.doc, bob.doc);
      const left = view(alice);
      expect(left.fingerprint).toBe(view(bob).fingerprint);
      expect(left.quarantined).toBe(false);
      expect(idsOf(left.root)).toContain('p2');
      expect(findNode(left.root!, 'r2')?.text).toBe('two-bob');
    } finally {
      destroy();
    }
  });

  test('remote edits are not in the local undo stack', () => {
    const { alice, bob, destroy } = pair(model);
    try {
      const before = alice.undo.undoStack.length;
      insertText(bob.nodes, bob.origin, 'r3', 0, 'z');
      sync(alice.doc, bob.doc);
      expect(alice.undo.undoStack.length).toBe(before);
      expect(findNode(view(alice).root!, 'r3')?.text).toBe('zthree');
      alice.undo.undo();
      expect(findNode(view(alice).root!, 'r3')?.text).toBe('zthree');
    } finally {
      destroy();
    }
  });
});

describe('smallest passing model', () => {
  test('child-array authority is sufficient for move identity', () => {
    const { alice, bob, destroy } = pair('child-array');
    try {
      moveNode(alice.nodes, alice.origin, 'child-array', 'p2', 'p3', 0);
      insertText(bob.nodes, bob.origin, 'r2', 0, 'X');
      sync(alice.doc, bob.doc);
      const left = view(alice);
      expect(left.quarantined).toBe(false);
      expect(findNode(left.root!, 'p2')?.id).toBe('p2');
      expect(findNode(left.root!, 'r2')?.text).toBe('Xtwo');
      expect(parentOf(left.root!, 'p2')?.id).toBe('p3');
    } finally {
      destroy();
    }
  });

  test('parent-register is not required for exclusive membership after materialization', () => {
    const childArrayPair = pair('child-array');
    const parentPair = pair('parent-register');
    try {
      moveNode(
        childArrayPair.alice.nodes,
        childArrayPair.alice.origin,
        'child-array',
        'p2',
        'p1',
        1
      );
      moveNode(childArrayPair.bob.nodes, childArrayPair.bob.origin, 'child-array', 'p2', 'p3', 1);
      moveNode(parentPair.alice.nodes, parentPair.alice.origin, 'parent-register', 'p2', 'p1', 1);
      moveNode(parentPair.bob.nodes, parentPair.bob.origin, 'parent-register', 'p2', 'p3', 1);
      sync(childArrayPair.alice.doc, childArrayPair.bob.doc);
      sync(parentPair.alice.doc, parentPair.bob.doc);
      const childView = view(childArrayPair.alice);
      const parentView = view(parentPair.alice);
      expect(idsOf(childView.root).filter((id) => id === 'p2')).toEqual(['p2']);
      expect(idsOf(parentView.root).filter((id) => id === 'p2')).toEqual(['p2']);
      expect(childView.issues.some((issue) => issue.code === 'duplicate-parent')).toBe(true);
      expect(parentView.issues.some((issue) => issue.code === 'duplicate-parent')).toBe(false);
    } finally {
      childArrayPair.destroy();
      parentPair.destroy();
    }
  });
});

function idsOf(node: FrozenNode | null): string[] {
  if (!node) return [];
  return [node.id, ...node.children.flatMap(idsOf)];
}
