/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two peers join the same paragraphs at once, so the first paragraph holds the second one's
// text twice and shows it once. A third peer typed into the second paragraph meanwhile, and
// its next edit writes that typing into the first paragraph as a copy. A join of a paragraph
// split off from there then moves a line break out from between the hidden duplicate and the
// copy, and the copy shows beside the duplicate as following text of its own paragraph. The
// join writes it once, not once as the copy and once typed again.

import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const BODY =
  '<w:p><w:r><w:t>One</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>abcdefghij</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Last</w:t></w:r></w:p><w:sectPr/>';

function paragraphTexts(peer: Peer): string[] {
  const texts: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'paragraph') texts.push(nodeText(node));
  });
  return texts;
}

/** Give `to` every update of `from` that it lacks. */
function deliver(from: Peer, to: Peer): void {
  Y.applyUpdate(to.ydoc, Y.encodeStateAsUpdate(from.ydoc, Y.encodeStateVector(to.ydoc)), 'relay');
}

function syncAll(peers: readonly Peer[]): void {
  for (const from of peers) for (const to of peers) if (from !== to) deliver(from, to);
}

// Both orders of the two joins' copies in the first paragraph. In one of them, the first
// paragraph adopts before the paragraph whose adoption changes what it shows.
for (const [name, clientIds] of [
  ['alice first', { alice: 101, bob: 202, carol: 303 }],
  ['carol first', { alice: 303, bob: 202, carol: 101 }],
] as const) {
  describe(`a join after a copy shows beside a hidden duplicate (${name})`, () => {
    const harness = createPeerHarness(`join-adopts-beside-duplicate-${name}`, {}, clientIds);
    afterEach(() => harness.cleanup());

    test('text a peer typed shows once, on every replica and after a reopen', async () => {
      const { alice, bob, pause, resume } = await harness.pair(zipDocument(BODY));
      pause();
      const carol = await harness.joinDetached(alice, 'carol');
      const peers = [alice, bob, carol];
      const join = (peer: Peer, first: number) =>
        harness.apply(peer, [
          {
            op: 'joinParagraphs',
            firstId: harness.paragraphIdAt(peer, first),
            secondId: harness.paragraphIdAt(peer, first + 1),
          },
        ]);
      join(alice, 0);
      join(carol, 0);
      harness.apply(bob, [
        { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 1), offset: 8, text: 'x' },
      ]);
      deliver(carol, bob);
      expect(paragraphTexts(bob)).toEqual(['Oneabcdefghxij', 'Last']);
      harness.apply(carol, [
        { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(carol, 0), offset: 8 },
      ]);
      harness.apply(bob, [
        { op: 'insertHardBreak', paragraphId: harness.paragraphIdAt(bob, 0), offset: 10 },
      ]);
      deliver(alice, bob);
      deliver(carol, bob);
      join(bob, 0);
      resume();
      syncAll(peers);
      harness.expectConverged(alice, bob);
      harness.expectConverged(alice, carol);
      const late = await harness.join(alice, 'late');
      for (const peer of [...peers, late]) {
        const texts = paragraphTexts(peer);
        expect(texts.join('|').split('x').length - 1).toBe(1);
        expect(texts.at(-1)).toBe('Last');
      }
    });
  });
}
