/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A reject that removes a deletion around text it also removes, an insertion nested in the
// deletion, must not leave the deletion around text a peer typed there at the same time.

import { afterEach, expect, test } from 'bun:test';
import { createPeerHarness, walk, zipDocument, type Peer } from './document-peer-support.ts';

const DATE = '2026-03-26T11:00:00Z';
const peers = createPeerHarness('concurrent-decision-span-room');

afterEach(() => peers.cleanup());

function deletedText(peer: Peer): string {
  let text = '';
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'textValue' || node.localName !== 'del') return;
    walk(node, (inner) => {
      if (inner.kind === 'textValue') text += inner.value;
    });
  });
  return text;
}

for (const offset of [10, 11, 12, 13])
  test(`rejecting a deletion reaches text a peer typed into a nested insertion at ${offset}`, async () => {
    const { alice, bob, pause, resume } = await peers.pair(
      zipDocument(
        '<w:p><w:r><w:t xml:space="preserve">Notice goe</w:t></w:r>' +
          `<w:ins w:id="1" w:author="Bob" w:date="${DATE}"><w:r><w:t>mid</w:t></w:r></w:ins>` +
          '<w:r><w:t xml:space="preserve">s to each party.</w:t></w:r></w:p><w:sectPr/>'
      )
    );
    const paragraphId = peers.paragraphIdAt(alice, 0);
    pause();
    // Alice strikes " goe", the insertion and "s " in one tracked deletion.
    peers.apply(alice, [
      {
        op: 'deleteText',
        paragraphId,
        start: 6,
        end: 15,
        revision: { author: 'Alice', date: DATE },
      },
    ]);
    // Bob has not seen the deletion and types inside his insertion.
    peers.apply(bob, [
      { op: 'insertText', paragraphId: peers.paragraphIdAt(bob, 0), offset, text: 'Z' },
    ]);
    // Alice rejects everything she sees: her deletion and Bob's insertion.
    peers.apply(alice, [{ op: 'rejectAllRevisions' }]);
    resume();
    peers.expectConverged(alice, bob);
    expect(deletedText(alice)).not.toContain('Z');
    expect(deletedText(bob)).not.toContain('Z');
  });
