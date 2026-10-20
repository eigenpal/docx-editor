/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { collaborationDocx } from './support.ts';
import {
  applyJournal,
  childIdsOf,
  collectKind,
  concurrent,
  destroyReplica,
  expectConverged,
  findText,
  joinReplica,
  loadPackage,
  nodeText,
  packageOf,
  parentOf,
  seedReplica,
  shownParentOf,
  spliceTextJournal,
  WML,
} from './document-support.ts';

describe('deterministic materialization repair', () => {
  test('keeps the first preorder placement and reports duplicate-parent', async () => {
    // Runs live in their paragraph's shared text, so two peers move one paragraph record into
    // two different containers at once.
    const bytes = collaborationDocx();
    const left = await seedReplica(loadPackage(bytes));
    const paragraphs = collectKind(packageOf(left), 'paragraph');
    const moved = paragraphs[1]!;
    const body = shownParentOf(left, moved.id, 'body');
    const containers = [left.mint.take(), left.mint.take()];
    left.doc.transact(() => {
      containers.forEach((id, index) => {
        left.registry.putElement({
          logicalId: id,
          kind: 'generic',
          namespaceUri: WML,
          localName: 'customXml',
          attributes: [],
          bindings: [],
        });
        left.registry.spliceChildren(body, index, 0, [id]);
      });
    });
    const right = joinReplica(left);
    try {
      concurrent(
        left,
        right,
        () =>
          applyJournal(left, {
            effects: [
              {
                kind: 'moveNode',
                logicalId: moved.id,
                destinationParentLogicalId: containers[1]!,
                destinationIndex: 0,
              },
            ],
          }),
        () =>
          applyJournal(right, {
            effects: [
              {
                kind: 'moveNode',
                logicalId: moved.id,
                destinationParentLogicalId: containers[0]!,
                destinationIndex: 0,
              },
            ],
          })
      );
      const matches = collectKind(packageOf(left), 'paragraph').filter(
        (node) => node.id === moved.id
      );
      expect(matches).toHaveLength(1);
      expect(left.materializer.issues.some((issue) => issue.code === 'duplicate-parent')).toBe(
        true
      );
      expect(right.materializer.issues.some((issue) => issue.code === 'duplicate-parent')).toBe(
        true
      );
      expectConverged(left, right);
    } finally {
      destroyReplica(left);
      destroyReplica(right);
    }
  });

  test('deleting a paragraph wins over concurrent typing in it', async () => {
    const left = await seedReplica(loadPackage(collaborationDocx()));
    const right = joinReplica(left);
    try {
      const paragraph = shownParentOf(
        left,
        findText(packageOf(left), 'Bravo paragraph').id,
        'paragraph'
      );
      concurrent(
        left,
        right,
        () => {
          const body = shownParentOf(left, paragraph, 'body');
          applyJournal(left, {
            effects: [
              {
                kind: 'spliceChildren',
                parentLogicalId: body,
                start: childIdsOf(left, body).indexOf(paragraph),
                deleteCount: 1,
                childLogicalIds: [],
              },
            ],
          });
        },
        () =>
          applyJournal(
            right,
            spliceTextJournal(findText(packageOf(right), 'Bravo paragraph').id, 5, '-keep')
          )
      );
      expect(left.registry.isTombstoned(paragraph)).toBe(true);
      expect(left.registry.hasNode(paragraph)).toBe(true);
      expect(collectKind(packageOf(left), 'paragraph').some((node) => node.id === paragraph)).toBe(
        false
      );
      expectConverged(left, right);
    } finally {
      destroyReplica(left);
      destroyReplica(right);
    }
  });

  test('reports deleted-referenced when a child array still lists a tombstone', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const paragraph = parentOf(
        replica.registry,
        findText(packageOf(replica), 'Bravo paragraph').id,
        'paragraph'
      );
      const body = parentOf(
        replica.registry,
        findText(packageOf(replica), 'Alpha paragraph').id,
        'body'
      );
      replica.doc.transact(() => {
        replica.registry.tombstone(paragraph);
      });
      replica.doc.transact(() => {
        replica.registry.childArray(body).push([paragraph]);
      });
      const result = replica.materializer.rebuild();
      if (!result.ok) throw new Error(result.code);
      expect(result.issues.some((issue) => issue.code === 'deleted-referenced')).toBe(true);
    } finally {
      destroyReplica(replica);
    }
  });

  test('ignores a reachable cycle edge without writing Yjs', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const paragraph = parentOf(
        replica.registry,
        findText(packageOf(replica), 'Alpha paragraph').id,
        'paragraph'
      );
      const body = parentOf(replica.registry, paragraph, 'body');
      const snapshot = Y.encodeStateAsUpdate(replica.doc);
      replica.doc.transact(() => {
        replica.registry.childArray(paragraph).push([body]);
      });
      const result = replica.materializer.rebuild();
      if (!result.ok) throw new Error(result.code);
      expect(result.issues.some((issue) => issue.code === 'cycle')).toBe(true);
      expect(Y.encodeStateAsUpdate(replica.doc).byteLength).toBeGreaterThan(snapshot.byteLength);
      const again = replica.materializer.rebuild();
      if (!again.ok) throw new Error(again.code);
      expect(again.issues.some((issue) => issue.code === 'cycle')).toBe(true);
      expect(nodeText(collectKind(again.package, 'paragraph')[0]!)).toContain('Alpha');
    } finally {
      destroyReplica(replica);
    }
  });
});
