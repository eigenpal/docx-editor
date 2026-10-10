/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A hyperlink across a tracked-insert run must replicate exactly (issue #557).
//
// `insertHyperlink` over a range that crosses into a `w:ins` run MOVES the split tracked
// wrapper inside the new `w:hyperlink` with its children replaced. The journal lowering used
// to skip a moved node's subtree diff, so every receiving replica kept the moved node's OLD
// run beside the split pieces the journal did describe — duplicated text on every peer but
// the author, converging as authoritative state.

import { afterEach, describe, expect, test } from 'bun:test';
import type { OoxmlNode, StoryScope } from '@docx-editor.dev/core/store';
import { BODY, createPeerHarness, walk, zipDocument, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('tracked-hyperlink-room');

afterEach(() => {
  harness.cleanup();
});

const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const PLAIN_LEAD = 'Synthetic paragraph 1600. ';
const TRACKED = 'page quality render section table update verify alpha ';
const PLAIN_TAIL = 'format geometry header index layout';

function trackedRunBytes(): Uint8Array {
  return zipDocument(
    '<w:p>' +
      `<w:r><w:t xml:space="preserve">${PLAIN_LEAD}</w:t></w:r>` +
      '<w:ins w:author="A" w:date="2020-01-01T00:00:00Z" w:id="7">' +
      `<w:r><w:t xml:space="preserve">${TRACKED}</w:t></w:r>` +
      '</w:ins>' +
      `<w:r><w:t>${PLAIN_TAIL}</w:t></w:r>` +
      '</w:p><w:sectPr/>',
    {
      documentRels:
        `<Relationships xmlns="${REL}">` +
        '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/pre" TargetMode="External"/>' +
        '</Relationships>',
    }
  );
}

function bodyText(peer: Peer): string {
  const texts: string[] = [];
  walk(peer.store.bodyStore().part.root, (node: OoxmlNode) => {
    if (node.kind === 'textValue') texts.push(node.value);
  });
  return texts.join('');
}

function linkRange(author: Peer, paragraphId: string, start: number): void {
  const scope: StoryScope = BODY;
  const result = author.store.transact(scope, (context) => {
    context.apply({
      op: 'insertHyperlink',
      paragraphId,
      start,
      end: start + 3,
      relationshipId: 'rId9',
    });
  });
  if (!result.ok) throw new Error(result.detail ?? result.reason);
  author.port.flushPendingJournals();
}

describe('hyperlink over tracked-change runs', () => {
  test('a link that crosses into a w:ins run replicates without duplicating text', async () => {
    const { alice, bob } = await harness.pair(trackedRunBytes());
    const target = harness.paragraphIdAt(alice, 0);
    const expected = PLAIN_LEAD + TRACKED + PLAIN_TAIL;
    // Round 24 is the one that corrupted: it starts in the plain lead run and ends inside
    // the tracked run, so the op splits the `w:ins` and moves it inside the new hyperlink.
    // The plain rounds guard the baseline the crossing round builds on.
    for (const start of [0, 12, 24, 36]) {
      linkRange(alice, target, start);
      expect(bodyText(bob)).toBe(expected);
      harness.expectConverged(alice, bob);
    }
  });

  test('a link entirely inside a w:ins run replicates without duplicating text', async () => {
    const { alice, bob } = await harness.pair(trackedRunBytes());
    const target = harness.paragraphIdAt(alice, 0);
    // Fully inside the tracked run: both edges split the same `w:ins`.
    linkRange(alice, target, PLAIN_LEAD.length + 5);
    expect(bodyText(bob)).toBe(PLAIN_LEAD + TRACKED + PLAIN_TAIL);
    harness.expectConverged(alice, bob);
  });
});
