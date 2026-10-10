/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A contested placement used to force a full pass on every rebuild that ran into it, which a
// hostile peer can sustain with one doubly listed child. Once a full pass has decided the
// contest, a keystroke that reproduces the decided placement must not pay for the document.

import { describe, expect, test } from 'bun:test';
import { materializedPassCounts } from '../document/materialize.ts';
import { collaborationDocx } from './support.ts';
import {
  applyJournal,
  childIdsOf,
  destroyReplica,
  expectConverged,
  findText,
  joinReplica,
  loadPackage,
  packageOf,
  seedReplica,
  shownParentOf,
  spliceTextJournal,
  walk,
  WML,
  type Replica,
} from './document-support.ts';
import type { LogicalId } from '../document/index.ts';

function container(replica: Replica, id: LogicalId): void {
  replica.registry.putElement({
    logicalId: id,
    kind: 'generic',
    namespaceUri: WML,
    localName: 'customXml',
    attributes: [],
    bindings: [],
  });
}

function countOf(replica: Replica, id: string): number {
  const pkg = packageOf(replica);
  let count = 0;
  walk(pkg.parts.get(pkg.mainDocumentPart)!.root, (node) => {
    if (node.id === id) count += 1;
  });
  return count;
}

// Runs live in their paragraph's shared text, so these contest a paragraph record between
// the body and a container element.
describe('contested placement across materializer passes', () => {
  test('a settled contest stops forcing full passes for the winner', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const bravoText = findText(packageOf(replica), 'Bravo paragraph');
      const bravo = shownParentOf(replica, bravoText.id, 'paragraph');
      const body = shownParentOf(replica, bravo, 'body');
      const loser = replica.mint.take();

      // A hostile peer lists the paragraph under a second container after it. The first pass
      // that sees the contest still earns its full pass: that pass decides the placement.
      replica.doc.transact(() => {
        container(replica, loser);
        replica.registry.spliceChildren(loser, 0, 0, [bravo]);
        replica.registry.spliceChildren(body, childIdsOf(replica, body).length, 0, [loser]);
      });
      expect(replica.registry.parentOf(bravo)).toBe(body);
      const settled = replica.materializer.rebuild();
      if (!settled.ok) throw new Error(settled.code);

      // Steady state: typing in the contested paragraph reproduces the decided placement.
      const steady: { passes: number; full: number }[] = [];
      for (let at = 0; at < 3; at += 1) {
        const before = materializedPassCounts();
        applyJournal(replica, spliceTextJournal(bravoText.id, 0, 'X'));
        const after = materializedPassCounts();
        steady.push({ passes: after.passes - before.passes, full: after.full - before.full });
      }
      for (const sample of steady) {
        expect(sample.passes).toBe(1);
        if (sample.full > 0) {
          throw new Error(
            'A keystroke in the contested paragraph forced a full placement pass. The ' +
              'contest was already decided, and the losing listing did not change.'
          );
        }
      }

      // The paragraph appears exactly once, under the first-preorder parent, and a replica
      // that joins fresh, deciding the contest with a full walk, sees the same document.
      expect(countOf(replica, bravo)).toBe(1);
      const joined = joinReplica(replica, 21);
      try {
        expectConverged(replica, joined);
      } finally {
        destroyReplica(joined);
      }

      // A change to the LOSING lister keeps the decided placement.
      applyJournal(replica, {
        effects: [
          {
            kind: 'setAttribute',
            logicalId: loser,
            qname: { namespaceUri: WML, localName: 'element', prefix: 'w' },
            value: 'x',
          },
        ],
      });
      expect(countOf(replica, bravo)).toBe(1);
      expect(replica.registry.parentOf(bravo)).toBe(body);
    } finally {
      destroyReplica(replica);
    }
  });

  test('an adoption-involved contest never takes the settled-contest skip', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const charlieText = findText(packageOf(replica), 'Charlie paragraph');
      const charlie = shownParentOf(replica, charlieText.id, 'paragraph');
      const body = shownParentOf(replica, charlie, 'body');
      const survivor = replica.mint.take();
      const t = replica.mint.take();

      // A tombstoned lister T routes the contested paragraph through survivor ADOPTION: the
      // full pass places it under the survivor, while `parentOf` nulls the dead chain and
      // resolves to the live lister. The lister must be dead at resolution time (a fresh
      // node, tombstoned in a SECOND transaction so its child-array events fire) or the
      // registry resolves to it and the mismatch honestly forces the full pass.
      replica.doc.transact(() => {
        container(replica, survivor);
        replica.registry.spliceChildren(body, 0, 0, [survivor]);
        container(replica, t);
        replica.registry.spliceChildren(t, 0, 0, [charlie]);
      });
      replica.doc.transact(() => {
        replica.registry.tombstone(t, survivor);
      });

      expect(replica.registry.listingParents(charlie).length).toBe(2);
      expect(replica.registry.parentOf(charlie)).toBe(body);
      expect(replica.registry.adoptedChildren(survivor)).toContain(charlie);

      // One settle pass decides the placement: first preorder wins, the survivor adopts it.
      const settled = replica.materializer.rebuild();
      if (!settled.ok) throw new Error(settled.code);
      expect(countOf(replica, charlie)).toBe(1);

      // A keystroke inside the contested paragraph rebuilds it only.
      applyJournal(replica, spliceTextJournal(charlieText.id, 0, 'Z'));
      expect(countOf(replica, charlie)).toBe(1);

      const joined = joinReplica(replica, 23);
      try {
        expectConverged(replica, joined);
      } finally {
        destroyReplica(joined);
      }
    } finally {
      destroyReplica(replica);
    }
  });
});
