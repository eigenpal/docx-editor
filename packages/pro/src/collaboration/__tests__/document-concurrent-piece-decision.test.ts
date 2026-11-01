/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Typing inside another author's insertion splits it into two pieces, and a decision on one
// piece decides that piece only. A peer who accepts the whole insertion at the same time
// still reaches every letter it saw, and the text after the insertion stays out of it.

import { afterEach, expect, test } from 'bun:test';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
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

/** The IDs of the insertion pieces of `author`, in document order. */
function piecesBy(peer: Peer, author: string): string[] {
  const ids: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'textValue' || node.localName !== 'ins') return;
    const by = node.attributes.find((attribute) => attribute.localName === 'author')?.value;
    if (by === author) ids.push(node.id);
  });
  return ids;
}

function paragraphText(peer: Peer): string {
  let text = '';
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'textValue') text += node.value;
  });
  return text;
}

test('accepting a whole insertion reaches the piece a peer did not decide at the same time', async () => {
  const { alice, bob, pause, resume } = await peers.pair(
    zipDocument(
      `<w:p><w:ins w:id="1" w:author="Carol" w:date="${DATE}"><w:r><w:t>lok</w:t></w:r></w:ins>` +
        '<w:r><w:t>top</w:t></w:r></w:p><w:sectPr/>'
    )
  );
  pause();
  // Bob accepts all of Carol's insertion, "lok".
  peers.apply(bob, [{ op: 'acceptAllRevisions' }]);
  // Alice has not seen the accept. She types inside the insertion, which splits it into "lo"
  // and "k", and accepts only the first piece.
  peers.apply(alice, [
    {
      op: 'insertText',
      paragraphId: peers.paragraphIdAt(alice, 0),
      offset: 2,
      text: 're',
      revision: { author: 'Alice', date: DATE },
    },
  ]);
  const [first] = piecesBy(alice, 'Carol');
  expect(piecesBy(alice, 'Carol')).toHaveLength(2);
  peers.apply(alice, [{ op: 'acceptAllRevisions', siteNodeIds: [first!] } as TreeDocOp]);
  expect(insertedBy(alice, 'Carol')).toBe('k');
  resume();
  peers.expectConverged(alice, bob);
  for (const peer of [alice, bob]) {
    expect(insertedBy(peer, 'Carol')).toBe('');
    expect(insertedBy(peer, 'Alice')).toBe('re');
    expect(paragraphText(peer)).toBe('lorektop');
  }

  // Bob's accept stays when Alice undoes and redoes hers.
  expect(alice.room.session.undo()).toBe(true);
  peers.expectConverged(alice, bob);
  expect(insertedBy(bob, 'Carol')).toBe('');
  expect(alice.room.session.redo()).toBe(true);
  peers.expectConverged(alice, bob);
  // Bob's undo brings back the change he decided, and his redo decides it again.
  expect(bob.room.session.undo()).toBe(true);
  peers.expectConverged(alice, bob);
  for (const peer of [alice, bob]) expect(insertedBy(peer, 'Carol')).toContain('k');
  expect(bob.room.session.redo()).toBe(true);
  peers.expectConverged(alice, bob);
  for (const peer of [alice, bob]) {
    expect(insertedBy(peer, 'Carol')).toBe('');
    expect(insertedBy(peer, 'Alice')).toBe('re');
    expect(paragraphText(peer)).toBe('lorektop');
  }
});

for (const offset of [0, 1, 2]) {
  test(`accepting one piece reaches all of it while a peer types at ${offset} inside it`, async () => {
    const { alice, bob, pause, resume } = await peers.pair(
      zipDocument(
        `<w:p><w:ins w:id="1" w:author="Carol" w:date="${DATE}"><w:r><w:t>lok</w:t></w:r></w:ins>` +
          '<w:r><w:t>top</w:t></w:r></w:p><w:sectPr/>'
      )
    );
    peers.apply(alice, [
      {
        op: 'insertText',
        paragraphId: peers.paragraphIdAt(alice, 0),
        offset: 2,
        text: 're',
        revision: { author: 'Alice', date: DATE },
      },
    ]);
    pause();
    // Alice accepts the piece "lo" while Bob, who has not seen the accept, types in it.
    const [first] = piecesBy(alice, 'Carol');
    peers.apply(alice, [{ op: 'acceptAllRevisions', siteNodeIds: [first!] } as TreeDocOp]);
    peers.apply(bob, [
      {
        op: 'insertText',
        paragraphId: peers.paragraphIdAt(bob, 0),
        offset,
        text: 'X',
        revision: { author: 'Bob', date: DATE },
      },
    ]);
    resume();
    peers.expectConverged(alice, bob);
    for (const peer of [alice, bob]) {
      expect(insertedBy(peer, 'Carol')).toBe('k');
      expect(insertedBy(peer, 'Bob')).toBe('X');
    }
  });
}
