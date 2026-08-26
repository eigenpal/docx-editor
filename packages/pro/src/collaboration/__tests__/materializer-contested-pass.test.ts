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
  destroyReplica,
  expectConverged,
  findText,
  joinReplica,
  loadPackage,
  packageOf,
  parentOf,
  seedReplica,
  spliceTextJournal,
  walk,
  WML,
} from './document-support.ts';

describe('contested placement across materializer passes', () => {
  test('a settled contest stops forcing full passes for the winner', async () => {
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

      // A hostile peer lists the run under a second paragraph. The first pass that sees the
      // contest still earns its full pass — that pass decides the placement.
      applyJournal(replica, {
        effects: [
          {
            kind: 'spliceChildren',
            parentLogicalId: charlieParagraph,
            start: 1,
            deleteCount: 0,
            childLogicalIds: [bravoRun],
          },
        ],
      });
      expect(replica.registry.parentOf(bravoRun)).toBe(bravoParagraph);

      // Steady state: typing in the winning paragraph reproduces the decided placement.
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
            'A keystroke in the contest winner forced a full placement pass. The contest was ' +
              'already decided, the pass placed the child under the parent the registry ' +
              'resolves, and the losing listing did not change — the decision holds.'
          );
        }
      }

      // The child appears exactly once, under the first-preorder parent, and a replica that
      // joins fresh — deciding the contest with a full walk — sees the same document.
      const pkg = packageOf(replica);
      const main = pkg.parts.get(pkg.mainDocumentPart);
      expect(main).toBeDefined();
      let listed = 0;
      walk(main!.root, (node) => {
        if (node.id === bravoRun) listed += 1;
      });
      expect(listed).toBe(1);

      const joined = joinReplica(replica, 21);
      try {
        expectConverged(replica, joined);
      } finally {
        destroyReplica(joined);
      }

      // A keystroke in the LOSING paragraph rebuilds a lister the decision excluded, and that
      // honestly still needs the full pass.
      const before = materializedPassCounts();
      applyJournal(replica, spliceTextJournal(charlieText.id, 0, 'Y'));
      const after = materializedPassCounts();
      expect(after.full - before.full).toBe(1);
      expect(replica.registry.parentOf(bravoRun)).toBe(bravoParagraph);
    } finally {
      destroyReplica(replica);
    }
  });

  test('an adoption-involved contest never takes the settled-contest skip', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const alphaText = findText(packageOf(replica), 'Alpha paragraph');
      const alphaParagraph = parentOf(
        replica.registry,
        parentOf(replica.registry, alphaText.id, 'run'),
        'paragraph'
      );
      const charlieText = findText(packageOf(replica), 'Charlie paragraph');
      const charlieRun = parentOf(replica.registry, charlieText.id, 'run');
      const charlieParagraph = parentOf(replica.registry, charlieRun, 'paragraph');

      // A tombstoned lister T routes the contested run through survivor ADOPTION: the full
      // pass places it under the survivor, while `parentOf` nulls the dead chain and
      // resolves to the live lister. The settled-contest skip trusted `parentOf` and
      // emitted the run under BOTH parents on the next keystroke in the live lister. The
      // lister must be dead at resolution time (a fresh node, tombstoned in a SECOND
      // transaction so its child-array events fire) or the registry resolves to it and the
      // mismatch honestly forces the full pass.
      const t = replica.mint.take();
      replica.doc.transact(() => {
        replica.registry.putElement({
          logicalId: t,
          kind: 'paragraph',
          namespaceUri: WML,
          localName: 'p',
          attributes: [],
          bindings: [],
        });
        replica.registry.spliceChildren(t, 0, 0, [charlieRun]);
      });
      replica.doc.transact(() => {
        replica.registry.tombstone(t, alphaParagraph);
      });

      expect(replica.registry.listingParents(charlieRun).length).toBe(2);
      expect(replica.registry.parentOf(charlieRun)).toBe(charlieParagraph);
      expect(replica.registry.adoptedChildren(alphaParagraph)).toContain(charlieRun);

      // One settle pass decides the placement: first preorder wins, alpha adopts the run.
      const settled = replica.materializer.rebuild();
      if (!settled.ok) throw new Error(settled.code);
      const pkg1 = packageOf(replica);
      let count = 0;
      walk(pkg1.parts.get(pkg1.mainDocumentPart)!.root, (node) => {
        if (node.id === charlieRun) count += 1;
      });
      expect(count).toBe(1);

      // A keystroke inside the LOSING lister's subtree rebuilds charlieParagraph only.
      applyJournal(replica, spliceTextJournal(charlieText.id, 0, 'Z'));

      const pkg2 = packageOf(replica);
      let after = 0;
      walk(pkg2.parts.get(pkg2.mainDocumentPart)!.root, (node) => {
        if (node.id === charlieRun) after += 1;
      });
      expect(after).toBe(1);

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
