/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Room-size observability (issue #554). A room only grows — deletion is a tombstone — and
// the resource caps turn terminal when crossed. The usage probe is the interim mitigation
// until compaction exists: these cases pin that it reports growth a host can act on, that
// the server-side probe agrees with the session's, and that the probe leaks nothing.

import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as Y from 'yjs';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import { readCollaborationResourceUsage } from '../resource-usage.ts';
import {
  PressureWatches,
  limitFailure,
  resourcePressureOf,
  type CollaborationResourcePressure,
} from '../resource-pressure.ts';
import { DocumentRegistry } from '../document/index.ts';
import { SHARED_BLOBS_KEY, SharedBlobStore } from '../shared-blob-store.ts';
import { createPeerHarness, type Peer } from './document-peer-support.ts';
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
    // tombstone still counts against `maxNodeRecords`, which is the fact this probe shows.
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

  test('hostile shared entries never make the probe throw or under-report', async () => {
    const { alice } = await harness.pair(collaborationDocx());
    // Mirror the room into a bare doc with no attached registry, so planting the hostile
    // shapes does not trip the separate observer crash tracked in #567. The probe reads
    // the pre-existing junk on a fresh registry, which is the server-side path.
    const mirror = new Y.Doc();
    Y.applyUpdate(mirror, Y.encodeStateAsUpdate(alice.ydoc));
    const clean = readCollaborationResourceUsage(mirror);
    // A hostile peer can write raw shapes the decoded readers skip. The probe must keep
    // returning numbers — a metrics scraper crashes otherwise — and must count what the
    // ENFORCING caps count, or it shows a healthy room right up to the terminal failure.
    mirror.getMap('docx-package-nodes-v1').set('junk-node', 'not-a-map' as never);
    mirror.getMap('docx-package-parts-v1').set('junk-part', 'not-a-map' as never);
    const usage = readCollaborationResourceUsage(mirror);
    expect(usage.nodes).toBe(clean.nodes + 1);
    expect(usage.parts).toBe(clean.parts + 1);
    expect(usage.tombstonedNodes).toBe(clean.tombstonedNodes);
    mirror.destroy();
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

  test('formatting markers left by deleted formatted text show in the reading', async () => {
    // Deleting text never removes its formatting markers, so the reading is how a host sees
    // that growth.
    const { alice } = await harness.pair(collaborationDocx());
    const before = alice.room.session.resourceUsage().formattingMarkers;
    const paragraphId = harness.paragraphIdAt(alice, 0);
    for (let round = 0; round < 5; round += 1) {
      harness.apply(alice, [{ op: 'insertText', paragraphId, offset: 0, text: 'bold ' }]);
      harness.apply(alice, [
        { op: 'setRunProperties', paragraphId, start: 0, end: 4, properties: [{ localName: 'b' }] },
      ]);
      harness.apply(alice, [{ op: 'deleteText', paragraphId, start: 0, end: 5 }]);
    }
    expect(alice.room.session.resourceUsage().formattingMarkers).toBeGreaterThan(before);
  });
});

/** A registry with its own node cap over a peer's shared state, read the way a session reads it. */
function limitedView(peer: Peer, maxNodes: number) {
  const registry = new DocumentRegistry(peer.ydoc, { maxNodes });
  const blobs = new SharedBlobStore(peer.ydoc.getMap<Uint8Array>(SHARED_BLOBS_KEY));
  return { registry, blobs };
}

function split(peer: Peer): void {
  harness.apply(peer, [
    { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(peer, 0), offset: 1 },
  ]);
}

function afterTransactionHandlers(ydoc: Y.Doc): number {
  const observers = (ydoc as unknown as { _observers: Map<string, Set<unknown>> })._observers;
  return observers.get('afterTransaction')?.size ?? 0;
}

describe('node cap (#554)', () => {
  test('every record counts, and the failure names the limit that ended the room', async () => {
    const { alice } = await harness.pair(collaborationDocx());
    const usage = alice.room.session.resourceUsage();
    const fits = limitedView(alice, usage.nodes);
    expect(limitFailure(fits.registry, fits.blobs)).toBeNull();
    fits.registry.destroy();
    const over = limitedView(alice, usage.nodes - 1);
    expect(limitFailure(over.registry, over.blobs)).toEqual({
      code: 'too-many-nodes',
      detail: `nodes=${usage.nodes}`,
    });
    over.registry.destroy();
  });
});

describe('resource pressure signal (#554)', () => {
  test('notifies a peer when received growth crosses a threshold', async () => {
    const { alice, bob } = await harness.pair(collaborationDocx());
    // A small node cap makes nodes the limit closest to its cap.
    const max = alice.room.session.resourceUsage().nodes + 4;
    const view = limitedView(bob, max);
    const watches = new PressureWatches();
    const seen: CollaborationResourcePressure[] = [];
    watches.watch(bob.ydoc, view.registry, view.blobs, (pressure) => seen.push(pressure));
    expect(seen).toEqual([]);
    for (let round = 0; round < 4 && seen.length === 0; round += 1) split(alice);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ limit: 'nodes', max });
    expect(seen[0]!.threshold).toBeGreaterThanOrEqual(0.75);
    watches.stopAll();
    view.registry.destroy();
  });

  test('a throwing listener breaks neither the edit nor the other listeners', async () => {
    const { alice } = await harness.pair(collaborationDocx());
    const view = limitedView(alice, alice.room.session.resourceUsage().nodes + 4);
    const watches = new PressureWatches();
    const seen: CollaborationResourcePressure[] = [];
    watches.watch(alice.ydoc, view.registry, view.blobs, () => {
      throw new Error('host bug');
    });
    watches.watch(alice.ydoc, view.registry, view.blobs, (pressure) => seen.push(pressure));
    const errors = spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (let round = 0; round < 4 && seen.length === 0; round += 1) split(alice);
      expect(seen).toHaveLength(1);
      expect(errors).toHaveBeenCalledTimes(1);
      expect(alice.room.session.status()).toBe('ready');
    } finally {
      errors.mockRestore();
      watches.stopAll();
      view.registry.destroy();
    }
  });

  test('typing reads no part, relationship or blob total', async () => {
    const { alice } = await harness.pair(collaborationDocx());
    const view = limitedView(alice, 200_000);
    const totals = spyOn(view.blobs, 'totalByteLength');
    const watches = new PressureWatches();
    watches.watch(alice.ydoc, view.registry, view.blobs, () => {});
    expect(totals).toHaveBeenCalledTimes(1);
    for (let round = 0; round < 3; round += 1) typeText(alice, 'key ');
    expect(totals).toHaveBeenCalledTimes(1);
    // A blob map change measures again, once.
    alice.ydoc.getMap(SHARED_BLOBS_KEY).set(`sha256:${'0'.repeat(64)}`, new Uint8Array(1));
    expect(totals).toHaveBeenCalledTimes(2);
    watches.stopAll();
    view.registry.destroy();
  });

  test('a session subscription reports a room already over a threshold', async () => {
    const { alice } = await harness.pair(collaborationDocx());
    const session = alice.room.session;
    const usage = session.resourceUsage();
    const partsFraction = usage.parts / usage.maxParts;
    const seen: CollaborationResourcePressure[] = [];
    const stop = session.subscribeResourcePressure((pressure) => seen.push(pressure), {
      thresholds: [partsFraction / 2, 0.9],
    });
    // Delivered at once: a participant joining a large room learns of it without an edit.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ limit: 'parts', threshold: partsFraction / 2 });
    typeText(alice, 'more ');
    expect(seen).toHaveLength(1);
    stop();
  });

  test('destroying the session removes its watches from the host document', async () => {
    const { alice } = await harness.pair(collaborationDocx());
    const before = afterTransactionHandlers(alice.ydoc);
    alice.room.session.subscribeResourcePressure(() => {});
    alice.room.session.subscribeResourcePressure(() => {});
    expect(afterTransactionHandlers(alice.ydoc)).toBe(before + 2);
    alice.detach();
    alice.room.destroy();
    // The session's own handler goes too; none of the watches stays behind.
    const after = afterTransactionHandlers(alice.ydoc);
    expect(after).toBeLessThan(before);
    const late: CollaborationResourcePressure[] = [];
    alice.room.session.subscribeResourcePressure((pressure) => late.push(pressure), {
      thresholds: [0.000_001],
    });
    expect(afterTransactionHandlers(alice.ydoc)).toBe(after);
    expect(late).toEqual([]);
  });

  test('refuses thresholds outside (0, 1]', async () => {
    const { alice } = await harness.pair(collaborationDocx());
    const session = alice.room.session;
    for (const thresholds of [[], [0], [1.5], [Number.NaN], new Array(17).fill(0.5)]) {
      expect(() => session.subscribeResourcePressure(() => {}, { thresholds })).toThrow(RangeError);
    }
  });

  test('names the cap closest to its limit', () => {
    const pressure = resourcePressureOf(
      [
        { limit: 'nodes', code: 'too-many-nodes', used: 10, max: 100 },
        { limit: 'blobBytes', code: 'blob-store-full', used: 95, max: 100 },
        { limit: 'parts', code: 'too-many-parts', used: 1, max: 100 },
      ],
      [0.5, 0.9]
    );
    expect(pressure).toEqual({
      limit: 'blobBytes',
      fraction: 0.95,
      threshold: 0.9,
      used: 95,
      max: 100,
    });
  });
});
