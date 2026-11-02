/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A seeded sweep: two peers split one paragraph and its pieces at the same time, in one or
// two rounds, sometimes typing too. Then one peer removes one paragraph, by a deleted block or
// a join. Every other paragraph keeps its place, as in a plain store, on both peers.

import { afterEach, expect, test } from 'bun:test';
import type { OoxmlNode, TreeDocOp } from '@docx-editor.dev/core/store';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support';

const SEEDS = 100;

const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});
function close(): void {
  cleanup?.();
  cleanup = null;
}

/** xorshift32: the same edits for one seed on every run. */
function randomFor(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function textOf(node: OoxmlNode): string {
  return node.kind === 'textValue' ? node.value : node.children.map(textOf).join('');
}

interface Shown {
  readonly id: string;
  readonly text: string;
}

/** The room of one seed, after its concurrent rounds. The edits depend only on the seed. */
async function roomFor(seed: number) {
  const random = randomFor(seed);
  const ids = random() < 0.5 ? { alice: 1_000, bob: 2_000 } : { alice: 2_000, bob: 1_000 };
  const harness = createPeerHarness(`split-sibling-sweep-${seed}`, undefined, ids);
  cleanup = harness.cleanup;
  const pair = await harness.pair(zipDocument(paragraph('abcdefgh') + paragraph('End')));
  const shown = (peer: Peer): Shown[] => {
    const out: Shown[] = [];
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
  const edit = (peer: Peer): void => {
    const list = shown(peer);
    // Every paragraph but the last, `End`.
    const target = list[Math.floor(random() * (list.length - 1))]!;
    const split = random() < 0.75;
    const offset = Math.floor(random() * (target.text.length + 1));
    const op: TreeDocOp = split
      ? { op: 'splitParagraph', paragraphId: target.id, offset }
      : { op: 'insertText', paragraphId: target.id, offset, text: 'xy' };
    harness.apply(peer, [op]);
  };
  const rounds = 1 + Math.floor(random() * 2);
  for (let round = 0; round < rounds; round += 1) {
    pair.pause();
    const byAlice = 1 + Math.floor(random() * 3);
    const byBob = 1 + Math.floor(random() * 3);
    for (let at = 0; at < byAlice; at += 1) edit(pair.alice);
    for (let at = 0; at < byBob; at += 1) edit(pair.bob);
    pair.resume();
    harness.expectConverged(pair.alice, pair.bob);
  }
  return { ...pair, harness, shown };
}

test('removing one paragraph after concurrent splits keeps the others in place', async () => {
  const failures: string[] = [];
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    const count = await roomFor(seed).then((room) => room.shown(room.alice).length - 1);
    close();
    for (let target = 0; target < count; target += 1)
      for (const kind of ['delete', 'join'] as const)
        for (const by of ['alice', 'bob'] as const) {
          if (kind === 'join' && target === 0) continue;
          const room = await roomFor(seed);
          const before = room.shown(room.alice);
          const removed = before[target]!.id;
          room.harness.apply(
            room[by],
            kind === 'delete'
              ? [{ op: 'deleteBlock', blockId: removed }]
              : [{ op: 'joinParagraphs', firstId: before[target - 1]!.id, secondId: removed }]
          );
          room.harness.expectConverged(room.alice, room.bob);
          const after = room.shown(room.alice).map((entry) => entry.id);
          const expected = before.map((entry) => entry.id).filter((id) => id !== removed);
          if (JSON.stringify(after) !== JSON.stringify(expected))
            failures.push(`seed ${seed}: ${kind} of paragraph ${target} by ${by}`);
          close();
        }
  }
  expect(failures).toEqual([]);
}, 120_000);
