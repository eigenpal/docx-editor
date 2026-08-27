/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The materializer's node cache must forget deleted subtrees, or a long session retains the
// frozen tree of every paragraph anyone ever deleted.

import { describe, expect, test } from 'bun:test';
import { collaborationDocx } from './support.ts';
import {
  destroyReplica,
  applyJournal,
  expectConverged,
  findText,
  joinReplica,
  loadPackage,
  packageOf,
  parentOf,
  seedReplica,
  syncOne,
} from './document-support.ts';

describe('materializer node-cache eviction', () => {
  test('a remotely deleted paragraph leaves the node cache on both replicas', async () => {
    const author = await seedReplica(loadPackage(collaborationDocx()));
    const receiver = joinReplica(author);
    try {
      const text = findText(packageOf(author), 'Alpha paragraph');
      const runId = parentOf(author.registry, text.id, 'run');
      const paragraphId = parentOf(author.registry, runId, 'paragraph');
      const bodyId = author.registry.parentOf(paragraphId);
      expect(bodyId).not.toBeNull();
      const record = author.registry.record(bodyId!);
      if (!record || !('childIds' in record)) throw new Error('body record missing');
      const index = record.childIds.indexOf(paragraphId);
      expect(index).toBeGreaterThanOrEqual(0);

      for (const replica of [author, receiver]) {
        const retained = new Set(replica.materializer.retainedNodeIds());
        expect(retained.has(paragraphId)).toBe(true);
        expect(retained.has(runId)).toBe(true);
        expect(retained.has(text.id)).toBe(true);
      }

      applyJournal(author, {
        effects: [
          {
            kind: 'spliceChildren',
            parentLogicalId: bodyId!,
            start: index,
            deleteCount: 1,
            childLogicalIds: [],
          },
        ],
      });
      syncOne(author, receiver);

      for (const replica of [author, receiver]) {
        expect(replica.registry.isTombstoned(paragraphId)).toBe(true);
        const retained = new Set(replica.materializer.retainedNodeIds());
        expect(retained.has(paragraphId)).toBe(false);
        expect(retained.has(runId)).toBe(false);
        expect(retained.has(text.id)).toBe(false);
      }
      expectConverged(author, receiver);
    } finally {
      destroyReplica(author);
      destroyReplica(receiver);
    }
  });
});
