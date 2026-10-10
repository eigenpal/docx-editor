/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What it costs to RECEIVE one remote character, in work rather than in milliseconds.
//
// The gates here are deterministic counters, because the number that matters is not how long
// the machine took but how much of the document the replica had to touch. A duration passes
// on a fast machine while the algorithm is still linear in the document.

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canonicalFingerprintNodeVisits,
  canonicalTreeDifference,
} from '../../../../core/src/store/package/ooxml-serialize.ts';
import { paragraphTextOf, type OoxmlNode, type TreeModelChange } from '@docx-editor.dev/core/store';
import { createPeerHarness, walk, zipDocument, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('remote-receive-cost');

afterEach(() => {
  harness.cleanup();
});

function longFixtureBytes(): Uint8Array {
  const fixture = resolve(import.meta.dir, '../../../../../e2e/fixtures/synthetic-long-edit.docx');
  return new Uint8Array(readFileSync(fixture));
}

function paragraphIds(peer: Peer): string[] {
  const ids: string[] = [];
  walk(peer.store.bodyStore().part.root, (node: OoxmlNode) => {
    if (node.kind === 'paragraph') ids.push(node.id);
  });
  return ids;
}

function bodyNodeCount(peer: Peer): number {
  let count = 0;
  walk(peer.store.bodyStore().part.root, () => {
    count += 1;
  });
  return count;
}

/** Type one character into `peer` and report what the OTHER replica had to do to receive it. */
function typeOneCharacter(
  author: Peer,
  receiver: Peer,
  paragraphId: string,
  offset: number
): {
  readonly fingerprintedNodes: number;
  readonly change: TreeModelChange | null;
  readonly elapsedMs: number;
} {
  let change: TreeModelChange | null = null;
  const stop = receiver.store.subscribe((published) => {
    change = published;
  });
  const before = canonicalFingerprintNodeVisits();
  const started = performance.now();
  harness.apply(author, [{ op: 'insertText', paragraphId, offset, text: 'X' }]);
  const elapsedMs = performance.now() - started;
  const fingerprintedNodes = canonicalFingerprintNodeVisits() - before;
  stop();
  return { fingerprintedNodes, change, elapsedMs };
}

describe('cost of receiving one remote character', () => {
  test(
    'a received keystroke never walks the whole document',
    async () => {
      const { alice, bob } = await harness.pair(longFixtureBytes());
      const documentNodes = bodyNodeCount(bob);
      const ids = paragraphIds(alice);
      const target = ids[Math.floor((ids.length - 1) * 0.5)];
      if (!target) throw new Error('no middle paragraph');
      const length = paragraphTextOf(alice.store.bodyStore().part, target)?.length ?? 0;

      // Reported for contrast: the first received edit is the one that could still find a
      // cold cache on either side. The gates below are the steady state that follows it.
      const first = typeOneCharacter(alice, bob, target, length);
      const steady = [
        typeOneCharacter(alice, bob, target, length + 1),
        typeOneCharacter(alice, bob, target, length + 2),
        typeOneCharacter(alice, bob, target, length + 3),
      ];

      const previous = bob.store.currentPackage();
      const nextRoot = bob.store.bodyStore().part.root;
      const difference = canonicalTreeDifference(
        previous.parts.get(previous.mainDocumentPart)!.root,
        nextRoot
      );

      console.log(
        JSON.stringify({
          fixture: 'synthetic-long-edit.docx',
          documentNodes,
          firstReceive: {
            fingerprintedNodes: first.fingerprintedNodes,
            impact: first.change?.impact,
            elapsedMs: Number(first.elapsedMs.toFixed(3)),
          },
          steadyReceive: steady.map((sample) => ({
            fingerprintedNodes: sample.fingerprintedNodes,
            impact: sample.change?.impact,
            dirty: sample.change?.dirty.length,
            elapsedMs: Number(sample.elapsedMs.toFixed(3)),
          })),
          identicalPackageWalk: difference.visited,
        })
      );

      for (const sample of steady) {
        if (sample.fingerprintedNodes !== 0) {
          throw new Error(
            `Receiving one remote character walked ${sample.fingerprintedNodes} nodes through ` +
              'the canonical fingerprint. That oracle has to materialize and stringify a whole ' +
              `part before it can answer, so reaching it makes a received keystroke cost the ` +
              `size of the document — ${documentNodes} nodes in this fixture — instead of the ` +
              'size of the edit, and it reaches that cost only to conclude that two packages ' +
              'differ before installing one of them anyway. Decide by object identity and stop ' +
              'at the first difference instead.'
          );
        }
        expect(sample.change).not.toBeNull();
        expect(sample.change?.impact).toBe('text-local');
        expect(sample.change?.dirty).toEqual([target]);
      }
      harness.expectConverged(alice, bob);
    },
    { timeout: 120_000 }
  );

  test('a received keystroke publishes the same change a local one does', async () => {
    const bytes = zipDocument(
      '<w:p><w:r><w:t>alpha</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>beta</w:t></w:r></w:p>' +
        '<w:sectPr/>'
    );
    const { alice, bob } = await harness.pair(bytes);
    const authored = harness.paragraphIdAt(alice, 1);
    harness.apply(alice, [{ op: 'insertText', paragraphId: authored, offset: 4, text: 'X' }]);

    let received: TreeModelChange | null = null;
    const stop = bob.store.subscribe((change) => {
      received = change;
    });
    harness.apply(alice, [{ op: 'insertText', paragraphId: authored, offset: 5, text: 'Y' }]);
    stop();

    const published = received as TreeModelChange | null;
    expect(published).not.toBeNull();
    expect(published?.impact).toBe('text-local');
    expect(published?.created).toEqual([]);
    expect(published?.deleted).toEqual([]);
    expect(published?.splitJoin).toEqual([]);
    expect(published?.dirty).toHaveLength(1);
    const dirtyId = published?.dirty[0] ?? '';
    expect(paragraphTextOf(bob.store.bodyStore().part, dirtyId)).toBe('betaXY');
    harness.expectConverged(alice, bob);
  });

  test('a structural remote edit stays wholesale', async () => {
    const bytes = zipDocument(
      '<w:p><w:r><w:t>alpha</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>beta</w:t></w:r></w:p>' +
        '<w:sectPr/>'
    );
    const { alice, bob } = await harness.pair(bytes);
    const authored = harness.paragraphIdAt(alice, 1);
    harness.apply(alice, [{ op: 'insertText', paragraphId: authored, offset: 4, text: 'X' }]);

    let received: TreeModelChange | null = null;
    const stop = bob.store.subscribe((change) => {
      received = change;
    });
    const previous = bob.store.currentPackage();
    harness.apply(alice, [{ op: 'splitParagraph', paragraphId: authored, offset: 2 }]);
    stop();

    const published = received as TreeModelChange | null;
    expect(published).not.toBeNull();
    expect(published?.impact).toBe('global');
    expect(published?.dirty).toEqual([]);
    expect(bob.store.currentPackage()).not.toBe(previous);
  });
});
