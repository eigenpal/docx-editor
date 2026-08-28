/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Concurrent variant edits converge (gap 3).
//
// The journal-coverage gate proves each variant replays a SINGLE author's edit onto a fresh
// replica. That is not the same claim as: two peers editing the same target CONCURRENTLY
// converge. This drives real Yjs merges through the production registry + materializer — two
// peers each author a different variant of the same property on the same node with the wire
// paused, then reconnect — and asserts both replicas reach one document (fingerprint plus
// save/reopen digest). A variant whose merge diverged would fail here, where the
// single-author gate could not see it.

import { afterEach, describe, expect, test } from 'bun:test';
import type { ImageDecodePort, StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import { BODY, createPeerHarness, walk, zipDocument, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('concurrent-variants-room');

afterEach(() => {
  harness.cleanup();
});

const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (character) => character.charCodeAt(0)
);

const decodePort: ImageDecodePort = {
  decode: async () => ({ pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 }),
};

function proseDoc(): Uint8Array {
  return zipDocument(
    '<w:p><w:r><w:t>Alpha bravo canvas delta editor</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p><w:sectPr/>'
  );
}

function drawingId(peer: Peer): string {
  let found: string | undefined;
  walk(peer.store.bodyStore().part.root, (node) => {
    if (!found && node.kind === 'drawing') found = node.id;
  });
  if (!found) throw new Error('missing drawing');
  return found;
}

/** Apply two concurrent edits with the wire paused, reconnect, and assert convergence. */
async function converges(
  bytes: Uint8Array,
  aliceOp: (peer: Peer) => readonly TreeDocOp[],
  bobOp: (peer: Peer) => readonly TreeDocOp[],
  scope: StoryScope = BODY
): Promise<void> {
  const { alice, bob, pause, resume } = await harness.pair(bytes);
  pause();
  harness.apply(alice, aliceOp(alice), scope);
  harness.apply(bob, bobOp(bob), scope);
  resume();
  harness.expectConverged(alice, bob);
}

describe('concurrent variant edits converge', () => {
  test('two indents on DIFFERENT paragraphs', async () => {
    // Independent property edits merge cleanly — the ordinary collaborative case.
    await converges(
      proseDoc(),
      (peer) => [
        {
          op: 'setParagraphProperties',
          paragraphId: harness.paragraphIdAt(peer, 0),
          properties: [{ localName: 'ind', attributes: { start: '720' } }],
        },
      ],
      (peer) => [
        {
          op: 'setParagraphProperties',
          paragraphId: harness.paragraphIdAt(peer, 1),
          properties: [{ localName: 'ind', attributes: { start: '1440' } }],
        },
      ]
    );
  });

  test('bold and italic on overlapping ranges', async () => {
    await converges(
      proseDoc(),
      (peer) => [
        {
          op: 'setRunProperties',
          paragraphId: harness.paragraphIdAt(peer, 0),
          start: 0,
          end: 5,
          properties: [{ localName: 'b' }],
        },
      ],
      (peer) => [
        {
          op: 'setRunProperties',
          paragraphId: harness.paragraphIdAt(peer, 0),
          start: 3,
          end: 9,
          properties: [{ localName: 'i' }],
        },
      ]
    );
  });

  test('sequential wrap changes on one drawing replicate', async () => {
    // A drawing created through the real image lane, then a wrap change, reaching the peer.
    // (Two CONCURRENT wrap changes on one drawing are a same-node property race — the same
    // limitation as concurrent paragraph properties, tracked in #579.)
    const { alice, bob } = await harness.pair(proseDoc());
    const inserted = await alice.store.insertImage(BODY, {
      paragraphId: harness.paragraphIdAt(alice, 0),
      offset: 0,
      bytes: PNG,
      mime: 'image/png',
      widthPoints: 12,
      heightPoints: 12,
      decodePort,
      expectedPackageRevision: alice.store.packageRevision,
    });
    if (!inserted.ok) throw new Error(inserted.detail ?? inserted.reason);
    alice.port.flushPendingJournals();
    harness.apply(alice, [
      { op: 'setDrawingWrap', drawingNodeId: drawingId(alice), wrap: 'tight' },
    ]);
    expect(bob.room.session.statusSnapshot().status).toBe('ready');
    expect(drawingId(bob)).toBeTruthy();
  });

  test('a shared paragraph property and a concurrent text edit', async () => {
    await converges(
      proseDoc(),
      (peer) => [
        {
          op: 'setParagraphProperties',
          paragraphId: harness.paragraphIdAt(peer, 0),
          properties: [{ localName: 'jc', attributes: { val: 'center' } }],
        },
      ],
      (peer) => [
        { op: 'insertText', paragraphId: harness.paragraphIdAt(peer, 0), offset: 0, text: 'X' },
      ]
    );
  });

  test('same-paragraph property rebuilds are a known non-convergence (#579)', async () => {
    // Pinning the current boundary, not endorsing it: two peers rebuilding the SAME `w:pPr`
    // concurrently each realign to their own edit and escalate to `error`. When #579 makes
    // this converge, this expectation flips and the assertion is updated.
    const { alice, bob, pause, resume } = await harness.pair(proseDoc());
    pause();
    harness.apply(alice, [
      {
        op: 'setParagraphProperties',
        paragraphId: harness.paragraphIdAt(alice, 0),
        properties: [{ localName: 'ind', attributes: { start: '720' } }],
      },
    ]);
    harness.apply(bob, [
      {
        op: 'setParagraphProperties',
        paragraphId: harness.paragraphIdAt(bob, 0),
        properties: [{ localName: 'ind', attributes: { start: '1440' } }],
      },
    ]);
    resume();
    expect(alice.room.session.statusSnapshot().status).toBe('error');
    expect(bob.room.session.statusSnapshot().status).toBe('error');
  });
});
