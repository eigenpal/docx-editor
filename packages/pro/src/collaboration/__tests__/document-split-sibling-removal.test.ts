/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Paragraphs that concurrent splits of one paragraph added keep their order when a peer
// removes one of them: by a deleted block or a join. Each test checks both client orders.

import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support';

const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const ORDERS = [
  { label: 'Alice first', ids: { alice: 1_000, bob: 2_000 } },
  { label: 'Bob first', ids: { alice: 2_000, bob: 1_000 } },
];

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  setSystemTime();
});

let now = 1_800_000_000_000;
/** Move the clock past the undo capture window, so the next edit is its own undo step. */
function later(): void {
  now += 2_000;
  setSystemTime(new Date(now));
}

function textOf(node: OoxmlNode): string {
  return node.kind === 'textValue' ? node.value : node.children.map(textOf).join('');
}

async function room(ids: Readonly<Record<string, number>>, first: string) {
  const harness = createPeerHarness('split-sibling-removal', undefined, ids);
  cleanup = harness.cleanup;
  const pair = await harness.pair(zipDocument(paragraph(first) + paragraph('End')));
  /** Each body paragraph as `text`, in the order a peer shows them. */
  const shown = (peer: Peer): { id: string; text: string }[] => {
    const out: { id: string; text: string }[] = [];
    const visit = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'paragraph') {
        out.push({ id: node.id, text: textOf(node) });
        return;
      }
      for (const child of node.children) visit(child);
    };
    const pkg = harness.packageOf(peer);
    visit(pkg.parts.get(pkg.mainDocumentPart)!.root);
    return out;
  };
  return {
    ...pair,
    harness,
    shown,
    /** Both peers show the same paragraphs, in the same order, and save alike. */
    converged(): { id: string; text: string }[] {
      harness.expectConverged(pair.alice, pair.bob);
      return shown(pair.alice);
    },
    split(peer: Peer, index: number, offset: number): void {
      harness.apply(peer, [
        { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(peer, index), offset },
      ]);
    },
  };
}

const ids = (list: readonly { id: string }[]) => list.map((entry) => entry.id);

describe('removing a paragraph of a concurrent split run', () => {
  /**
   * Alice splits `abcdefgh` after `a` and her piece after `bcd`; Bob splits it after `ab` and
   * his piece after `cd`. Both pieces that start at `e` follow a split piece of their own.
   */
  async function splitTwice(clientIds: Readonly<Record<string, number>>) {
    const r = await room(clientIds, 'abcdefgh');
    r.pause();
    r.split(r.alice, 0, 1);
    r.split(r.alice, 1, 3);
    r.split(r.bob, 0, 2);
    r.split(r.bob, 1, 2);
    r.resume();
    return r;
  }

  for (const { label, ids: clientIds } of ORDERS)
    for (const by of ['alice', 'bob'] as const) {
      test(`deleting a split piece keeps the others in place (${label}, ${by})`, async () => {
        const r = await splitTwice(clientIds);
        const before = r.converged();
        const removed = before.find((entry) => entry.text === 'b')!.id;
        r.harness.apply(r[by], [{ op: 'deleteBlock', blockId: removed }]);
        expect(ids(r.converged())).toEqual(ids(before).filter((id) => id !== removed));
      });

      test(`joining a split piece keeps the others in place (${label}, ${by})`, async () => {
        const r = await splitTwice(clientIds);
        const before = r.converged();
        const at = before.findIndex((entry) => entry.text === 'b');
        const removed = before[at]!.id;
        r.harness.apply(r[by], [
          { op: 'joinParagraphs', firstId: before[at - 1]!.id, secondId: removed },
        ]);
        expect(ids(r.converged())).toEqual(ids(before).filter((id) => id !== removed));
      });

      test(`a split piece a peer deletes offline leaves the others in place (${label}, ${by})`, async () => {
        const r = await splitTwice(clientIds);
        const before = r.converged();
        const removed = before.find((entry) => entry.text === 'b')!.id;
        r.pause();
        r.harness.apply(r[by], [{ op: 'deleteBlock', blockId: removed }]);
        r.resume();
        expect(ids(r.converged())).toEqual(ids(before).filter((id) => id !== removed));
      });

      test(`an undo of the delete shows every piece where it was (${label}, ${by})`, async () => {
        const r = await splitTwice(clientIds);
        const before = r.converged();
        const removed = before.find((entry) => entry.text === 'b')!.id;
        later();
        r.harness.apply(r[by], [{ op: 'deleteBlock', blockId: removed }]);
        r.converged();
        expect(r[by].room.session.undo()).toBe(true);
        expect(r.converged().map((entry) => entry.text)).toEqual(before.map((entry) => entry.text));
      });
    }
});
