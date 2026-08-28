/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What the WHOLESALE remote path costs, in work rather than in milliseconds.
//
// `remotePackageDelta` narrows only a main-part text change. Anything that touches the
// package shell — a media part, a relationship, a content type — installs as `global`,
// which is the worst case a receiving replica has. This file measures that case on the
// 200-page fixture with the realistic trigger, an image insert, and pins two facts the
// narrow-path gates cannot see:
//
//   1. Even a wholesale install reads the size of the EDIT, not the document. Unchanged
//      parts arrive as the same objects, so validation and materialization must not walk
//      them. The gates are deterministic counters, because a duration passes on a fast
//      machine while the algorithm is still linear in the document.
//   2. A burst of remote transactions does NOT coalesce: N received updates cost N
//      materializer passes. That is the shipped behavior; pinning it here means a future
//      coalescing change shows up as an improvement to this file, not as a surprise in
//      production.

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalFingerprintNodeVisits } from '../../../../core/src/store/package/ooxml-serialize.ts';
import {
  paragraphTextOf,
  type ImageDecodePort,
  type OoxmlNode,
  type TreeModelChange,
} from '@docx-editor.dev/core/store';
import { materializedNodeReads, materializedPassCounts } from '../document/materialize.ts';
import { BODY, createPeerHarness, walk, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('remote-receive-wholesale');

afterEach(() => {
  harness.cleanup();
});

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (character) => character.charCodeAt(0)
);

const decodePort: ImageDecodePort = {
  decode: async () => ({ pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 }),
};

function longFixtureBytes(): Uint8Array {
  const fixture = resolve(import.meta.dir, '../../../../../e2e/fixtures/synthetic-long-edit.docx');
  return new Uint8Array(readFileSync(fixture));
}

function bodyNodeCount(peer: Peer): number {
  let count = 0;
  walk(peer.store.bodyStore().part.root, () => {
    count += 1;
  });
  return count;
}

function middleParagraphId(peer: Peer): string {
  const ids: string[] = [];
  walk(peer.store.bodyStore().part.root, (node: OoxmlNode) => {
    if (node.kind === 'paragraph') ids.push(node.id);
  });
  const id = ids[Math.floor((ids.length - 1) * 0.5)];
  if (!id) throw new Error('no middle paragraph');
  return id;
}

async function insertImage(author: Peer, paragraphId: string, offset: number): Promise<void> {
  const inserted = await author.store.insertImage(BODY, {
    paragraphId,
    offset,
    bytes: PNG_1X1,
    mime: 'image/png',
    widthPoints: 12,
    heightPoints: 12,
    decodePort,
    expectedPackageRevision: author.store.packageRevision,
  });
  if (!inserted.ok) throw new Error(inserted.detail ?? inserted.reason);
  author.port.flushPendingJournals();
}

interface WholesaleSample {
  readonly impact: TreeModelChange['impact'] | undefined;
  readonly nodeReads: number;
  readonly passes: number;
  readonly fingerprintedNodes: number;
  readonly elapsedMs: number;
}

async function receiveWholesale(
  receiver: Peer,
  edit: () => Promise<void>
): Promise<WholesaleSample> {
  let change: TreeModelChange | null = null;
  const stop = receiver.store.subscribe((published) => {
    change = published;
  });
  const readsBefore = materializedNodeReads();
  const passesBefore = materializedPassCounts().passes;
  const fingerprintBefore = canonicalFingerprintNodeVisits();
  const started = performance.now();
  await edit();
  const elapsedMs = performance.now() - started;
  stop();
  const published = change as TreeModelChange | null;
  return {
    impact: published?.impact,
    nodeReads: materializedNodeReads() - readsBefore,
    passes: materializedPassCounts().passes - passesBefore,
    fingerprintedNodes: canonicalFingerprintNodeVisits() - fingerprintBefore,
    elapsedMs,
  };
}

describe('cost of the wholesale remote path', () => {
  test(
    'an image insert installs wholesale without walking the document',
    async () => {
      const { alice, bob } = await harness.pair(longFixtureBytes());
      const documentNodes = bodyNodeCount(bob);
      const target = harness.paragraphIdAt(alice, 0);

      // Reported for contrast: the first receive is the one that can still find a cold
      // cache. The gates below are the steady state that follows it. Each round inserts
      // AFTER the drawings the earlier rounds placed.
      const samples: WholesaleSample[] = [];
      for (let round = 0; round < 4; round += 1) {
        samples.push(await receiveWholesale(bob, () => insertImage(alice, target, round)));
      }
      const [first, ...steady] = samples;

      console.log(
        JSON.stringify({
          fixture: 'synthetic-long-edit.docx',
          documentNodes,
          firstReceive: {
            impact: first?.impact,
            nodeReads: first?.nodeReads,
            passes: first?.passes,
            elapsedMs: Number((first?.elapsedMs ?? 0).toFixed(3)),
          },
          steadyReceive: steady.map((sample) => ({
            impact: sample.impact,
            nodeReads: sample.nodeReads,
            passes: sample.passes,
            fingerprintedNodes: sample.fingerprintedNodes,
            elapsedMs: Number(sample.elapsedMs.toFixed(3)),
          })),
        })
      );

      // A media part plus its relationship cannot be narrowed, so the classification is
      // pinned here: the wholesale verdict is the case this whole file exists to measure.
      for (const sample of steady) {
        expect(sample.impact).toBe('global');
      }
      const readBudget = Math.max(256, Math.floor(documentNodes / 16));
      for (const sample of steady) {
        if (sample.nodeReads > readBudget) {
          throw new Error(
            `A wholesale remote install read ${sample.nodeReads} shared node records against a ` +
              `budget of ${readBudget} in a ${documentNodes}-node document. Unchanged parts ` +
              'arrive as the same objects, so the materializer must rebuild only the spine of ' +
              'the edit and the package projections; reading a document-sized slice here means ' +
              'the incremental pass lost its cache and the worst case became the whole file.'
          );
        }
        if (sample.fingerprintedNodes !== 0) {
          throw new Error(
            `A wholesale remote install walked ${sample.fingerprintedNodes} nodes through the ` +
              'canonical fingerprint. The install decision is made by object identity and the ' +
              'relationship compare; reaching the fingerprint oracle makes every shell change ' +
              'cost a full serialization of the document.'
          );
        }
      }
      harness.expectConverged(alice, bob);
    },
    { timeout: 120_000 }
  );

  test(
    'a burst of remote transactions costs one pass per transaction',
    async () => {
      const { alice, bob } = await harness.pair(longFixtureBytes());
      const target = middleParagraphId(alice);
      const length = paragraphTextOf(alice.store.bodyStore().part, target)?.length ?? 0;
      // Warm both caches so the burst measures the steady state.
      harness.apply(alice, [{ op: 'insertText', paragraphId: target, offset: length, text: 'W' }]);

      const burst = 10;
      const before = materializedPassCounts().passes;
      for (let round = 0; round < burst; round += 1) {
        harness.apply(alice, [
          { op: 'insertText', paragraphId: target, offset: length + 1 + round, text: 'X' },
        ]);
      }
      const passes = materializedPassCounts().passes - before;

      console.log(JSON.stringify({ burst, passes }));

      // Pinned as fact, not aspiration: received updates do NOT coalesce — each transaction
      // pays one incremental pass. A future batching change should move this number DOWN;
      // a regression that re-materializes more than once per update would move it up.
      expect(passes).toBe(burst);
      harness.expectConverged(alice, bob);
    },
    { timeout: 120_000 }
  );
});
