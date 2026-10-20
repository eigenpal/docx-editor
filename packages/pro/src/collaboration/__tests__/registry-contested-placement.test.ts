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
  childIdsOf,
  packageOf,
  seedReplica,
  shownParentOf,
  type Replica,
} from './document-support.ts';
import { WML } from './document-support.ts';
import type { LogicalId } from '../document/index.ts';

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

/** A new container element listed in the body at `index`, listing `paragraph` too. */
function listInContainer(replica: Replica, index: number, paragraph: LogicalId): LogicalId {
  const body = shownParentOf(replica, paragraph, 'body');
  const container = replica.mint.take();
  replica.doc.transact(() => {
    replica.registry.putElement({
      logicalId: container,
      kind: 'generic',
      namespaceUri: WML,
      localName: 'customXml',
      attributes: [],
      bindings: [],
    });
    replica.registry.spliceChildren(container, 0, 0, [paragraph]);
    replica.registry.spliceChildren(body, index, 0, [container]);
  });
  return container;
}

function paragraphOf(replica: Replica, text: string): LogicalId {
  return shownParentOf(replica, findText(packageOf(replica), text).id, 'paragraph');
}

// Runs live in their paragraph's shared text, so these contest a paragraph record instead.
describe('contested placement resolves locally to the first-preorder parent', () => {
  test('a paragraph listed by a later container stays with the earlier parent', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const bravo = paragraphOf(replica, 'Bravo paragraph');
      const body = shownParentOf(replica, bravo, 'body');
      listInContainer(replica, childIdsOf(replica, body).length, bravo);
      expect(replica.registry.listingParents(bravo).length).toBe(2);
      expect(replica.registry.parentOf(bravo)).toBe(body);
      expectParentsMatchFullWalk(replica, 11);
    } finally {
      destroyReplica(replica);
    }
  });

  test('a paragraph listed by an earlier container moves its resolution there', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const charlie = paragraphOf(replica, 'Charlie paragraph');
      const container = listInContainer(replica, 0, charlie);
      expect(replica.registry.parentOf(charlie)).toBe(container);
      expectParentsMatchFullWalk(replica, 12);
    } finally {
      destroyReplica(replica);
    }
  });

  test('a lister that reaches no part root never wins the child', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const bravo = paragraphOf(replica, 'Bravo paragraph');
      const body = shownParentOf(replica, bravo, 'body');
      const detached = replica.mint.take();

      replica.doc.transact(() => {
        replica.registry.putElement({
          logicalId: detached,
          kind: 'generic',
          namespaceUri: WML,
          localName: 'customXml',
          attributes: [],
          bindings: [],
        });
        replica.registry.spliceChildren(detached, 0, 0, [bravo]);
      });

      expect(replica.registry.listingParents(bravo).length).toBe(2);
      expect(replica.registry.parentOf(bravo)).toBe(body);
      expectParentsMatchFullWalk(replica, 13);
    } finally {
      destroyReplica(replica);
    }
  });
});
