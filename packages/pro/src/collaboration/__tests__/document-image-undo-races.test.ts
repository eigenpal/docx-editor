/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two participants resize one image at the same time, and one of them undoes. Yjs keeps one
// write of each size attribute. Undoing the kept write must leave the image a size every
// replica can build: the one from before the undone step, or the other participant's.

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { createPeerHarness, walk, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('image-undo-races-room');

afterEach(() => {
  harness.cleanup();
});

const SAMPLE = new Uint8Array(
  readFileSync(resolve(import.meta.dir, '../../../../../examples/vite/public/sample.docx'))
);

function nodes(peer: Peer, localName: string): OoxmlNode[] {
  const found: OoxmlNode[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind !== 'textValue' && node.localName === localName) found.push(node);
  });
  return found;
}

describe('image resize undo races', () => {
  for (const undoer of ['alice', 'bob'] as const) {
    test(`two peers resize one image and ${undoer} undoes: the image keeps a size`, async () => {
      const pair = await harness.pair(SAMPLE);
      const drawing = nodes(pair.alice, 'drawing')[0]!;
      pair.pause();
      harness.apply(pair.alice, [
        { op: 'resizeDrawing', drawingNodeId: drawing.id, extentEmu: { cx: 900_000, cy: 600_000 } },
      ]);
      harness.apply(pair.bob, [
        {
          op: 'resizeDrawing',
          drawingNodeId: drawing.id,
          extentEmu: { cx: 1_200_000, cy: 800_000 },
        },
      ]);
      pair.resume();
      // One resize is kept. Undoing the kept one must not leave the drawing with no size, which
      // no replica can build.
      expect(pair[undoer].room.session.undo()).toBe(true);
      for (const peer of [pair.alice, pair.bob]) {
        expect(peer.room.session.statusSnapshot().reason?.code).toBeUndefined();
        const extent = nodes(peer, 'extent')[0]!;
        const size = Object.fromEntries(
          (extent.kind === 'textValue' ? [] : extent.attributes).map((attribute) => [
            attribute.localName,
            attribute.value,
          ])
        );
        expect(Number(size.cx)).toBeGreaterThan(0);
        expect(Number(size.cy)).toBeGreaterThan(0);
      }
      harness.expectConverged(pair.alice, pair.bob);
      const late = await harness.join(pair.alice, 'late');
      harness.expectConverged(pair.alice, late);
    });
  }

  for (const undoer of ['alice', 'bob'] as const) {
    test(`${undoer} resizes one image twice in one step while a peer resizes it: the undo goes back before the step`, async () => {
      const pair = await harness.pair(SAMPLE);
      const drawing = nodes(pair.alice, 'drawing')[0]!;
      const other = undoer === 'alice' ? 'bob' : 'alice';
      const sizeOf = (peer: Peer) =>
        Object.fromEntries(
          (() => {
            const extent = nodes(peer, 'extent')[0]!;
            return extent.kind === 'textValue' ? [] : extent.attributes;
          })().map((attribute) => [attribute.localName, attribute.value])
        ).cx;
      const before = sizeOf(pair.alice);
      pair.pause();
      // Two quick resizes are one undo step.
      for (const cx of [900_000, 1_000_000]) {
        harness.apply(pair[undoer], [
          { op: 'resizeDrawing', drawingNodeId: drawing.id, extentEmu: { cx, cy: 600_000 } },
        ]);
      }
      harness.apply(pair[other], [
        {
          op: 'resizeDrawing',
          drawingNodeId: drawing.id,
          extentEmu: { cx: 1_200_000, cy: 800_000 },
        },
      ]);
      pair.resume();
      expect(pair[undoer].room.session.undo()).toBe(true);
      harness.expectConverged(pair.alice, pair.bob);
      // The size from before the step, or the peer's when it was kept; never the first resize
      // of the step, which the step itself replaced.
      expect([before, '1200000']).toContain(sizeOf(pair.alice));
    });
  }
});
