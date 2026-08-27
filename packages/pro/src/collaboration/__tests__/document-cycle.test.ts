/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two peers cross-nesting concurrently merge to a parent-index cycle: parentOf(X)=Y and
// parentOf(Y)=X. Every derived-index climb on the receive path must terminate on that
// input — an unguarded walk spins forever on every replica.

import { describe, expect, test } from 'bun:test';
import { collaborationDocx } from './support.ts';
import {
  destroyReplica,
  expectConverged,
  findText,
  joinReplica,
  loadPackage,
  packageOf,
  parentOf,
  seedReplica,
  syncOne,
} from './document-support.ts';

describe('cross-nesting cycles', () => {
  test('a merged parent-index cycle cannot hang materialization', async () => {
    const alice = await seedReplica(loadPackage(collaborationDocx()));
    const bob = joinReplica(alice, 31);
    try {
      const alphaText = findText(packageOf(alice), 'Alpha paragraph');
      const alpha = parentOf(alice.registry, parentOf(alice.registry, alphaText.id, 'run'), 'paragraph');
      const bravoText = findText(packageOf(alice), 'Bravo paragraph');
      const bravo = parentOf(alice.registry, parentOf(alice.registry, bravoText.id, 'run'), 'paragraph');
      const body = alice.registry.parentOf(alpha);
      expect(body).not.toBeNull();

      const unlist = (replica: typeof alice, parent: string, child: string): void => {
        const record = replica.registry.record(parent);
        if (!record || record.kind === 'textValue') throw new Error('parent record missing');
        const at = record.childIds.indexOf(child);
        expect(at).toBeGreaterThanOrEqual(0);
        replica.registry.spliceChildren(parent, at, 1, []);
      };

      // Concurrently: Alice nests bravo under alpha while Bob nests alpha under bravo.
      alice.doc.transact(() => {
        unlist(alice, body!, bravo);
        alice.registry.spliceChildren(alpha, 0, 0, [bravo]);
      });
      bob.doc.transact(() => {
        unlist(bob, body!, alpha);
        bob.registry.spliceChildren(bravo, 0, 0, [alpha]);
      });

      // The merge leaves each of the two paragraphs listed only by the other.
      syncOne(alice, bob);
      syncOne(bob, alice);

      // The materializer already ran inside syncOne's publish; reaching these assertions
      // means no climb spun. The cycle's nodes are unreachable content, so the oracle is
      // the emitted canonical package: every replica, including a fresh join whose derived
      // indexes come from a full walk, must materialize the same document.
      for (const replica of [alice, bob]) {
        const pkg = packageOf(replica);
        expect(pkg.parts.get(pkg.mainDocumentPart)).toBeDefined();
      }
      expectConverged(alice, bob);
      const joined = joinReplica(alice, 32);
      try {
        expectConverged(alice, joined);
      } finally {
        destroyReplica(joined);
      }
    } finally {
      destroyReplica(alice);
      destroyReplica(bob);
    }
  }, 20000);
});
