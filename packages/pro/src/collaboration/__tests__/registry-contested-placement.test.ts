/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The local contested-placement resolution must give the same answers as the full preorder
// walk. A fresh replica joined from the same shared state rebuilds its derived indexes with
// that walk, so it is the oracle: every id's resolved parent has to match it exactly.

import { describe, expect, test } from 'bun:test';
import { collaborationDocx } from './support.ts';
import {
  destroyReplica,
  findText,
  joinReplica,
  loadPackage,
  packageOf,
  parentOf,
  seedReplica,
  type Replica,
} from './document-support.ts';
import { WML } from './document-support.ts';

function expectParentsMatchFullWalk(replica: Replica, clientID: number): void {
  const oracle = joinReplica(replica, clientID);
  try {
    for (const id of replica.registry.allLogicalIds()) {
      expect(replica.registry.parentOf(id)).toBe(oracle.registry.parentOf(id));
    }
  } finally {
    destroyReplica(oracle);
  }
}

describe('contested placement resolves locally to the first-preorder parent', () => {
  test('a run listed by a later paragraph stays with the earlier one', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const bravoText = findText(packageOf(replica), 'Bravo paragraph');
      const bravoRun = parentOf(replica.registry, bravoText.id, 'run');
      const bravoParagraph = parentOf(replica.registry, bravoRun, 'paragraph');
      const charlieText = findText(packageOf(replica), 'Charlie paragraph');
      const charlieParagraph = parentOf(
        replica.registry,
        parentOf(replica.registry, charlieText.id, 'run'),
        'paragraph'
      );

      replica.doc.transact(() => {
        replica.registry.spliceChildren(charlieParagraph, 1, 0, [bravoRun]);
      });

      expect(replica.registry.listingParents(bravoRun).length).toBe(2);
      expect(replica.registry.parentOf(bravoRun)).toBe(bravoParagraph);
      expectParentsMatchFullWalk(replica, 11);
    } finally {
      destroyReplica(replica);
    }
  });

  test('a run listed by an earlier paragraph moves its resolution there', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const charlieText = findText(packageOf(replica), 'Charlie paragraph');
      const charlieRun = parentOf(replica.registry, charlieText.id, 'run');
      const alphaText = findText(packageOf(replica), 'Alpha paragraph');
      const alphaParagraph = parentOf(
        replica.registry,
        parentOf(replica.registry, alphaText.id, 'run'),
        'paragraph'
      );

      replica.doc.transact(() => {
        replica.registry.spliceChildren(alphaParagraph, 0, 0, [charlieRun]);
      });

      expect(replica.registry.parentOf(charlieRun)).toBe(alphaParagraph);
      expectParentsMatchFullWalk(replica, 12);
    } finally {
      destroyReplica(replica);
    }
  });

  test('a lister that reaches no part root never wins the child', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const bravoText = findText(packageOf(replica), 'Bravo paragraph');
      const bravoRun = parentOf(replica.registry, bravoText.id, 'run');
      const bravoParagraph = parentOf(replica.registry, bravoRun, 'paragraph');
      const detached = replica.mint.take();

      replica.doc.transact(() => {
        replica.registry.putElement({
          logicalId: detached,
          kind: 'paragraph',
          namespaceUri: WML,
          localName: 'p',
          attributes: [],
          bindings: [],
        });
        replica.registry.spliceChildren(detached, 0, 0, [bravoRun]);
      });

      expect(replica.registry.listingParents(bravoRun).length).toBe(2);
      expect(replica.registry.parentOf(bravoRun)).toBe(bravoParagraph);
      expectParentsMatchFullWalk(replica, 13);
    } finally {
      destroyReplica(replica);
    }
  });
});
