import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { collaborationDocx } from './support.ts';
import {
  applyJournal,
  collectKind,
  concurrent,
  destroyReplica,
  findText,
  joinReplica,
  loadPackage,
  nodeText,
  packageOf,
  parentOf,
  seedReplica,
  spliceTextJournal,
} from './document-support.ts';
import { isElementRecord } from '../document/index.ts';

describe('deterministic materialization repair', () => {
  test('keeps the first preorder placement and reports duplicate-parent', async () => {
    const bytes = collaborationDocx();
    const left = await seedReplica(loadPackage(bytes));
    const right = joinReplica(left);
    try {
      const run = collectKind(packageOf(left), 'run')[0]!;
      const first = collectKind(packageOf(left), 'paragraph')[0]!;
      const second = collectKind(packageOf(left), 'paragraph')[1]!;
      concurrent(
        left,
        right,
        () =>
          applyJournal(left, {
            effects: [
              {
                kind: 'moveNode',
                logicalId: run.id,
                destinationParentLogicalId: second.id,
                destinationIndex: 0,
              },
            ],
          }),
        () =>
          applyJournal(right, {
            effects: [
              {
                kind: 'moveNode',
                logicalId: run.id,
                destinationParentLogicalId: first.id,
                destinationIndex: 0,
              },
            ],
          })
      );
      const matches = collectKind(packageOf(left), 'run').filter((node) => node.id === run.id);
      expect(matches).toHaveLength(1);
      expect(left.materializer.issues.some((issue) => issue.code === 'duplicate-parent')).toBe(
        true
      );
      expect(right.materializer.issues.some((issue) => issue.code === 'duplicate-parent')).toBe(
        true
      );
    } finally {
      destroyReplica(left);
      destroyReplica(right);
    }
  });

  test('tombstone delete reports orphan-with-content for concurrent descendant text', async () => {
    const left = await seedReplica(loadPackage(collaborationDocx()));
    const right = joinReplica(left);
    try {
      const paragraph = parentOf(
        left.registry,
        findText(packageOf(left), 'Bravo paragraph').id,
        'paragraph'
      );
      concurrent(
        left,
        right,
        () => {
          const body = parentOf(left.registry, paragraph, 'body');
          const bodyRecord = left.registry.record(body);
          if (!bodyRecord || !isElementRecord(bodyRecord)) throw new Error('body');
          applyJournal(left, {
            effects: [
              {
                kind: 'spliceChildren',
                parentLogicalId: body,
                start: bodyRecord.childIds.indexOf(paragraph),
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
      expect(left.materializer.issues.some((issue) => issue.code === 'orphan-with-content')).toBe(
        true
      );
      expect(left.registry.hasNode(paragraph)).toBe(true);
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
