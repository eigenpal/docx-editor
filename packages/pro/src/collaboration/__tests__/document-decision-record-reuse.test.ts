/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A decision on a whole tracked change records what it saw, so a later tracked change in the
// same paragraph, which can take the same revision number, still shows on every letter.

import { afterEach, expect, test } from 'bun:test';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import { createPeerHarness, walk, zipDocument, type Peer } from './document-peer-support.ts';

const DATE = '2026-03-26T11:00:00Z';
const peers = createPeerHarness('decision-record-reuse-room');

afterEach(() => peers.cleanup());

/** The text inside each tracked wrapper of `localName`. */
function trackedText(peer: Peer, localName: string): string {
  let text = '';
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'textValue' || node.localName !== localName) return;
    walk(node, (inner) => {
      if (inner.kind === 'textValue') text += inner.value;
    });
  });
  return text;
}

/** The run property changes, as the text of each run that holds a `w:rPrChange`. */
function formatChanged(peer: Peer): string {
  let text = '';
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'textValue' || node.localName !== 'r') return;
    let changed = false;
    walk(node, (inner) => {
      if (inner.kind !== 'textValue' && inner.localName === 'rPrChange') changed = true;
    });
    if (!changed) return;
    walk(node, (inner) => {
      if (inner.kind === 'textValue') text += inner.value;
    });
  });
  return text;
}

const OLD = zipDocument('<w:p><w:r><w:t>old text</w:t></w:r></w:p><w:sectPr/>');
const by = (author: string) => ({ author, date: DATE });

type Later = 'delete' | 'format';

function laterChange(peer: Peer, later: Later): TreeDocOp {
  const paragraphId = peers.paragraphIdAt(peer, 0);
  return later === 'delete'
    ? { op: 'deleteText', paragraphId, start: 0, end: 3, revision: by('Bob') }
    : ({
        op: 'setRunProperties',
        paragraphId,
        start: 0,
        end: 3,
        properties: [{ localName: 'b' }],
        revision: by('Bob'),
      } as TreeDocOp);
}

function expectLater(peer: Peer, later: Later): void {
  if (later === 'delete') expect(trackedText(peer, 'del')).toBe('old');
  else expect(formatChanged(peer)).toBe('old');
}

for (const later of ['delete', 'format'] as const) {
  for (const decision of ['accept', 'reject'] as const) {
    test(`a tracked ${later} after a whole ${decision} in the same paragraph shows on every letter`, async () => {
      const { alice, bob } = await peers.pair(OLD);
      const paragraphId = peers.paragraphIdAt(alice, 0);
      // Alice proposes a change and decides all of it: an accepted insertion, or a rejected
      // deletion of text that stays.
      peers.apply(
        alice,
        decision === 'accept'
          ? [{ op: 'insertText', paragraphId, offset: 8, text: '!', revision: by('Alice') }]
          : [{ op: 'deleteText', paragraphId, start: 4, end: 8, revision: by('Alice') }]
      );
      peers.apply(alice, [
        { op: decision === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions' },
      ]);
      peers.expectConverged(alice, bob);
      // Alice, then Bob, proposes a change over old letters.
      peers.apply(alice, [laterChange(alice, later)]);
      peers.expectConverged(alice, bob);
      for (const peer of [alice, bob]) expectLater(peer, later);
      peers.apply(alice, [{ op: 'rejectAllRevisions' }]);
      peers.expectConverged(alice, bob);
      peers.apply(bob, [laterChange(bob, later)]);
      peers.expectConverged(alice, bob);
      for (const peer of [alice, bob]) expectLater(peer, later);
    });
  }
}
