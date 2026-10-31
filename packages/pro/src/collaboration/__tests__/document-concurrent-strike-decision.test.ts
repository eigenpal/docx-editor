/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A strike that removes the author's own insertion from inside another author's insertion
// keeps the other author's letters, not equal letters of the removed text. A peer's
// concurrent decision on the other insertion then reaches every letter it held.

import { afterEach, expect, test } from 'bun:test';
import { createPeerHarness, walk, zipDocument, type Peer } from './document-peer-support.ts';

const DATE = '2026-03-26T11:00:00Z';
const peers = createPeerHarness('concurrent-strike-decision-room');

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

test('accepting an insertion reaches its letters a peer struck around a removed equal letter', async () => {
  const { alice, bob, pause, resume } = await peers.pair(
    zipDocument(
      '<w:p><w:r><w:t>N</w:t></w:r>' +
        `<w:ins w:id="1" w:author="Carol" w:date="${DATE}"><w:r><w:t>ore</w:t></w:r></w:ins>` +
        `<w:ins w:id="2" w:author="Alice" w:date="${DATE}"><w:r><w:t xml:space="preserve">m </w:t></w:r></w:ins>` +
        `<w:ins w:id="1" w:author="Carol" w:date="${DATE}"><w:r><w:t>m</w:t></w:r></w:ins>` +
        '<w:r><w:t>otice</w:t></w:r></w:p><w:sectPr/>'
    )
  );
  pause();
  // Alice strikes "rem otice"[0..4]: her own "m " goes, Carol's letters and "o" are struck.
  peers.apply(alice, [
    {
      op: 'deleteText',
      paragraphId: peers.paragraphIdAt(alice, 0),
      start: 2,
      end: 7,
      revision: { author: 'Alice', date: DATE },
    },
  ]);
  // Bob has not seen the strike and accepts every change.
  peers.apply(bob, [{ op: 'acceptAllRevisions' }]);
  resume();
  peers.expectConverged(alice, bob);
  expect(insertedBy(alice, 'Carol')).toBe('');
  expect(insertedBy(bob, 'Carol')).toBe('');
});
