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
});
