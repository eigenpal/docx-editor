/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Room-size observability (issue #554). A room only grows — deletion is a tombstone — and
// the resource caps turn terminal when crossed. The usage probe is the interim mitigation
// until compaction exists: these cases pin that it reports growth a host can act on, that
// the server-side probe agrees with the session's, and that the probe leaks nothing.

import { afterEach, describe, expect, test } from 'bun:test';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import { readCollaborationResourceUsage } from '../resource-usage.ts';
import { createPeerHarness } from './document-peer-support.ts';
import { collaborationDocx } from './support.ts';

const harness = createPeerHarness('resource-usage-room');

afterEach(() => {
  harness.cleanup();
});

function typeText(peer: Parameters<typeof harness.apply>[0], text: string): void {
  const ops: readonly TreeDocOp[] = [
    { op: 'insertText', paragraphId: harness.paragraphIdAt(peer, 0), offset: 0, text },
  ];
  harness.apply(peer, ops);
}

describe('collaboration resource usage', () => {
  test('the session reports growth against the caps', async () => {
    const { alice } = await harness.pair(collaborationDocx());
    const session = alice.room.session;
    const before = session.resourceUsage();
    expect(before.nodes).toBeGreaterThan(0);
    expect(before.nodes).toBeLessThanOrEqual(before.maxNodes);
    expect(before.tombstonedNodes).toBe(0);
    expect(before.parts).toBeGreaterThan(0);
    // The fixture carries binary part bytes, so the blob reading is non-zero from the seed.
    expect(before.blobBytes).toBeGreaterThan(0);
    expect(before.blobBytes).toBeLessThanOrEqual(before.maxBlobBytes);

    // A split mints nodes; the join that follows tombstones. Growth is monotonic: the
    // tombstone still counts against `maxNodes`, which is the fact this probe exists to show.
    harness.apply(alice, [
      { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(alice, 0), offset: 2 },
    ]);
    const afterSplit = session.resourceUsage();
    expect(afterSplit.nodes).toBeGreaterThan(before.nodes);

    harness.apply(alice, [
      {
        op: 'joinParagraphs',
        firstId: harness.paragraphIdAt(alice, 0),
        secondId: harness.paragraphIdAt(alice, 1),
      },
    ]);
    const afterJoin = session.resourceUsage();
    expect(afterJoin.tombstonedNodes).toBeGreaterThan(0);
    expect(afterJoin.nodes).toBeGreaterThanOrEqual(afterSplit.nodes);
  });

  test('the server-side probe agrees with the session and leaks nothing', async () => {
    const { alice, bob } = await harness.pair(collaborationDocx());
    typeText(alice, 'grow ');
    const fromSession = bob.room.session.resourceUsage();
    const nodesMap = bob.ydoc.getMap('docx-package-nodes-v1') as unknown as {
      _eH: { l: readonly unknown[] };
      _dEH: { l: readonly unknown[] };
    };
    const observersBefore = nodesMap._eH.l.length + nodesMap._dEH.l.length;
    const fromServer = readCollaborationResourceUsage(bob.ydoc);
    expect(fromServer).toEqual(fromSession);
    // A metrics scraper calls this for the life of the room, so it must give back every
    // observer the probe registered.
    expect(nodesMap._eH.l.length + nodesMap._dEH.l.length).toBe(observersBefore);
  });
});
