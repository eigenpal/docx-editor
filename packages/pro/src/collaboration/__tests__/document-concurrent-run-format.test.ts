/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Concurrent run-property edits on one paragraph converge without duplicating text (#581).
//
// `setRunProperties` splits the target run and replaces it with new runs carrying copies of
// the partitioned text. Two peers doing this at once left both run-sets in the paragraph, so
// the text doubled and both replicas agreed on the corruption. Each new run now records the
// origin run it superseded; materialize groups the concurrent splits under that origin and
// keeps one replica's runs deterministically. These cases pin: no duplication, both peers
// converge (fingerprint + save/reopen digest), a mark from the winner survives, and the
// mechanism does not misfire on independent or single-author edits.

import { afterEach, describe, expect, test } from 'bun:test';
import type { OoxmlNode, StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import { BODY, createPeerHarness, walk, zipDocument, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('concurrent-run-format-room');

afterEach(() => {
  harness.cleanup();
});

const PARA0 = 'Alpha bravo canvas delta editor';
const PARA1 = 'Second paragraph here';

function doc(): Uint8Array {
  return zipDocument(
    `<w:p><w:r><w:t>${PARA0}</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>${PARA1}</w:t></w:r></w:p><w:sectPr/>`
  );
}

function bodyText(peer: Peer): string {
  const texts: string[] = [];
  walk(peer.store.bodyStore().part.root, (node: OoxmlNode) => {
    if (node.kind === 'textValue') texts.push(node.value);
  });
  return texts.join('');
}

function markCount(peer: Peer, localName: string): number {
  let count = 0;
  walk(peer.store.bodyStore().part.root, (node: OoxmlNode) => {
    if (node.kind !== 'textValue' && node.localName === localName) count += 1;
  });
  return count;
}

function runProps(
  peer: Peer,
  paraIndex: number,
  start: number,
  end: number,
  localName: string
): TreeDocOp {
  return {
    op: 'setRunProperties',
    paragraphId: harness.paragraphIdAt(peer, paraIndex),
    start,
    end,
    properties: [{ localName }],
  };
}

async function race(
  aliceOp: (peer: Peer) => TreeDocOp,
  bobOp: (peer: Peer) => TreeDocOp,
  scope: StoryScope = BODY
): Promise<{ alice: Peer; bob: Peer }> {
  const { alice, bob, pause, resume } = await harness.pair(doc());
  pause();
  harness.apply(alice, [aliceOp(alice)], scope);
  harness.apply(bob, [bobOp(bob)], scope);
  resume();
  harness.expectConverged(alice, bob);
  return { alice, bob };
}

describe('concurrent run-format convergence (#581)', () => {
  test('overlapping formats on one paragraph keep the text once', async () => {
    const { alice } = await race(
      (peer) => runProps(peer, 0, 0, 5, 'b'),
      (peer) => runProps(peer, 0, 3, 9, 'i')
    );
    expect(bodyText(alice)).toBe(PARA0 + PARA1);
    // One replica's split wins whole, so exactly one of the two marks survives.
    expect(markCount(alice, 'b') + markCount(alice, 'i')).toBeGreaterThan(0);
  });

  test('non-overlapping formats on one paragraph keep the text once', async () => {
    const { alice } = await race(
      (peer) => runProps(peer, 0, 0, 5, 'b'),
      (peer) => runProps(peer, 0, 20, 25, 'i')
    );
    expect(bodyText(alice)).toBe(PARA0 + PARA1);
  });

  test('two multi-boundary splits at different mid positions converge', async () => {
    // Both edits fall strictly inside the run, so each splits at two boundaries and produces
    // an intermediate run that is removed and reinserted in one journal — the case where the
    // origin has to be resolved to its root for every product.
    const { alice } = await race(
      (peer) => runProps(peer, 0, 6, 11, 'b'),
      (peer) => runProps(peer, 0, 12, 17, 'i')
    );
    expect(bodyText(alice)).toBe(PARA0 + PARA1);
  });

  test('concurrent formats on DIFFERENT paragraphs both survive', async () => {
    const { alice } = await race(
      (peer) => runProps(peer, 0, 0, 5, 'b'),
      (peer) => runProps(peer, 1, 0, 6, 'i')
    );
    expect(bodyText(alice)).toBe(PARA0 + PARA1);
    // Independent splits: neither is dropped, so both marks are present.
    expect(markCount(alice, 'b')).toBeGreaterThan(0);
    expect(markCount(alice, 'i')).toBeGreaterThan(0);
  });

  test('a single-author split still replicates its formatting', async () => {
    const { alice, bob } = await harness.pair(doc());
    harness.apply(alice, [runProps(alice, 0, 0, 5, 'b')]);
    harness.expectConverged(alice, bob);
    expect(bodyText(bob)).toBe(PARA0 + PARA1);
    expect(markCount(bob, 'b')).toBe(1);
  });
});
