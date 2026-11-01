/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A reviewer accepts a whole pending insertion while a peer types inside it and accepts only
// the piece before its typing. The accept reaches every letter its reviewer saw, the piece
// after the typing too, and its undo puts back only what it decided.

import { afterEach, expect, test } from 'bun:test';
import { createPeerHarness, walk, zipDocument, type Peer } from './document-peer-support.ts';

const DATE = '2026-03-26T11:00:00Z';
const peers = createPeerHarness('concurrent-piece-decision-room');

afterEach(() => peers.cleanup());

function insertedBy(peer: Peer, author: string): string {
  let text = '';
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'textValue' || node.localName !== 'ins') return;
    const by = node.attributes.find((attribute) => attribute.localName === 'author')?.value;
    if (by !== author) return;
    walk(node, (inner) => {
      if (inner.kind === 'textValue') text += inner.value;
    });
  });
  return text;
}

/** The IDs of the `w:ins` elements of `author`, in document order. */
function insertionsBy(peer: Peer, author: string): string[] {
  const ids: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'textValue' || node.localName !== 'ins') return;
    const by = node.attributes.find((attribute) => attribute.localName === 'author')?.value;
    if (by === author) ids.push(node.id);
  });
  return ids;
}

const DOCUMENT = zipDocument(
  '<w:p><w:r><w:t xml:space="preserve">Say </w:t></w:r>' +
    `<w:ins w:id="1" w:author="Carol" w:date="${DATE}"><w:r><w:t>lore</w:t></w:r></w:ins>` +
    '<w:r><w:t xml:space="preserve"> now</w:t></w:r></w:p><w:sectPr/>'
);

async function decideConcurrently(): Promise<{ alice: Peer; bob: Peer }> {
  const { alice, bob, pause, resume } = await peers.pair(DOCUMENT);
  pause();
  // Alice sees the insertion whole and accepts it.
  peers.apply(alice, [{ op: 'acceptAllRevisions' }]);
  // Bob types inside it, which splits it into two pieces, and accepts the first piece.
  peers.apply(bob, [
    {
      op: 'insertText',
      paragraphId: peers.paragraphIdAt(bob, 0),
      offset: 6,
      text: 'X',
      revision: { author: 'Bob', date: DATE },
    },
  ]);
  const pieces = insertionsBy(bob, 'Carol');
  expect(pieces).toHaveLength(2);
  peers.apply(bob, [{ op: 'acceptAllRevisions', siteNodeIds: [pieces[0]!] }]);
  expect(insertedBy(bob, 'Carol')).toBe('re');
  resume();
  peers.expectConverged(alice, bob);
  return { alice, bob };
}

test('an accept reaches the piece of an insertion after a peer typed into it', async () => {
  const { alice, bob } = await decideConcurrently();
  expect(insertedBy(alice, 'Carol')).toBe('');
  expect(insertedBy(bob, 'Carol')).toBe('');
  expect(insertedBy(alice, 'Bob')).toBe('X');
});

test('undoing the whole accept puts back only the piece the peer did not accept', async () => {
  const { alice, bob } = await decideConcurrently();
  expect(alice.room.session.undo()).toBe(true);
  peers.expectConverged(alice, bob);
  expect(insertedBy(alice, 'Carol')).toBe('re');
  expect(insertedBy(bob, 'Carol')).toBe('re');
});
