/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two peers join one paragraph at the same time: one joins it into the paragraph before it,
// the other joins the next paragraph into it. The second join writes its copies into a
// paragraph the first removed, and they show where that paragraph's text follows. A letter
// typed earlier shows there once, not also where it was typed (#1607).

import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import * as Y from 'yjs';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('following-copy-hides-original-room');

let now = 1_800_000_000_000;
/** Move past the shared undo manager's capture window, so each action is its own step. */
function later(): void {
  now += 2_000;
  setSystemTime(new Date(now));
}

afterEach(() => {
  harness.cleanup();
  setSystemTime();
});

const BODY =
  '<w:p><w:r><w:t>Alpha beta gamma.</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Delta.</w:t></w:r></w:p><w:sectPr/>';

function paragraphTexts(peer: Peer): string[] {
  const texts: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'paragraph') texts.push(nodeText(node));
  });
  return texts;
}

/** Give `to` every update of `from` that it lacks. */
function deliver(from: Peer, to: Peer): void {
  Y.applyUpdate(to.ydoc, Y.encodeStateAsUpdate(from.ydoc, Y.encodeStateVector(to.ydoc)), 'relay');
}

function syncAll(peers: readonly Peer[]): void {
  for (const from of peers) for (const to of peers) if (from !== to) deliver(from, to);
}

/**
 * Bob presses Enter before "beta" while Alice types "m" after "be"; the "m" follows into
 * Bob's new paragraph. Alice then splits that paragraph after "b". Last, offline, Bob joins
 * the new paragraph back into the first, and Carol joins the split tail into the new one.
 */
async function concurrentJoins() {
  later();
  const { alice, bob, pause, resume } = await harness.pair(zipDocument(BODY));
  const carol = await harness.joinDetached(alice, 'carol');
  const peers = [alice, bob, carol];
  pause();
  harness.apply(bob, [
    { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(bob, 0), offset: 6 },
  ]);
  harness.apply(alice, [
    { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 0), offset: 8, text: 'm' },
  ]);
  resume();
  syncAll(peers);
  expect(paragraphTexts(alice)).toEqual(['Alpha ', 'bemta gamma.', 'Delta.']);
  later();
  harness.apply(alice, [
    { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(alice, 1), offset: 1 },
  ]);
  syncAll(peers);
  expect(paragraphTexts(carol)).toEqual(['Alpha ', 'b', 'emta gamma.', 'Delta.']);
  later();
  pause();
  harness.apply(bob, [
    {
      op: 'joinParagraphs',
      firstId: harness.paragraphIdAt(bob, 0),
      secondId: harness.paragraphIdAt(bob, 1),
    },
  ]);
  harness.apply(carol, [
    {
      op: 'joinParagraphs',
      firstId: harness.paragraphIdAt(carol, 1),
      secondId: harness.paragraphIdAt(carol, 2),
    },
  ]);
  resume();
  syncAll(peers);
  return { alice, bob, carol, peers };
}

describe('a join into a paragraph a concurrent join removes', () => {
  test('shows a letter typed earlier once, on every replica and after a reopen', async () => {
    const { alice, bob, carol, peers } = await concurrentJoins();
    harness.expectConverged(alice, bob);
    harness.expectConverged(alice, carol);
    for (const peer of peers) {
      expect(paragraphTexts(peer)).toEqual(['Alpha bemta gamma.', 'Delta.']);
    }
    const late = await harness.join(alice, 'late');
    expect(paragraphTexts(late)).toEqual(['Alpha bemta gamma.', 'Delta.']);
  });

  test('undo and redo of either join keep the letter once', async () => {
    const { alice, bob, carol, peers } = await concurrentJoins();
    for (const [peer, undone] of [
      [bob, ['Alpha ', 'bemta gamma.', 'Delta.']],
      [carol, ['Alpha b', 'emta gamma.', 'Delta.']],
    ] as const) {
      later();
      expect(peer.room.session.undo()).toBe(true);
      syncAll(peers);
      harness.expectConverged(alice, bob);
      harness.expectConverged(alice, carol);
      expect(paragraphTexts(alice)).toEqual([...undone]);
      later();
      expect(peer.room.session.redo()).toBe(true);
      syncAll(peers);
      harness.expectConverged(alice, bob);
      harness.expectConverged(alice, carol);
      expect(paragraphTexts(alice)).toEqual(['Alpha bemta gamma.', 'Delta.']);
    }
  });

  test('a deletion of the letter made offline during the joins stays', async () => {
    const { alice, bob, carol, peers } = await concurrentJoins();
    later();
    const shown = paragraphTexts(alice)[0]!;
    harness.apply(alice, [
      {
        op: 'deleteText',
        paragraphId: harness.paragraphIdAt(alice, 0),
        start: shown.indexOf('m'),
        end: shown.indexOf('m') + 1,
      },
    ]);
    syncAll(peers);
    harness.expectConverged(alice, bob);
    harness.expectConverged(alice, carol);
    for (const peer of peers) {
      expect(paragraphTexts(peer)).toEqual(['Alpha beta gamma.', 'Delta.']);
    }
  });
});

/**
 * Dave presses Enter after "Alpha" while Bob presses Enter after "Alpha be" and Carol types
 * "m" after "Alpha bet". Carol receives only Bob's Enter, so her "m" shows in Bob's new
 * paragraph. Last, offline, Bob joins his new paragraph back into the first, and Carol joins
 * the next paragraph into Bob's new one.
 */
async function joinsAfterTwoSplits() {
  later();
  const { alice, bob, pause, resume } = await harness.pair(zipDocument(BODY));
  pause();
  const carol = await harness.joinDetached(alice, 'carol');
  const dave = await harness.joinDetached(alice, 'dave');
  const peers = [alice, bob, carol, dave];
  harness.apply(dave, [
    { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(dave, 0), offset: 5 },
  ]);
  harness.apply(bob, [
    { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(bob, 0), offset: 8 },
  ]);
  harness.apply(carol, [
    { op: 'insertText', paragraphId: harness.paragraphIdAt(carol, 0), offset: 9, text: 'm' },
  ]);
  deliver(bob, carol);
  expect(paragraphTexts(carol)).toEqual(['Alpha be', 'tma gamma.', 'Delta.']);
  later();
  harness.apply(bob, [
    {
      op: 'joinParagraphs',
      firstId: harness.paragraphIdAt(bob, 0),
      secondId: harness.paragraphIdAt(bob, 1),
    },
  ]);
  harness.apply(carol, [
    {
      op: 'joinParagraphs',
      firstId: harness.paragraphIdAt(carol, 1),
      secondId: harness.paragraphIdAt(carol, 2),
    },
  ]);
  resume();
  syncAll(peers);
  return { alice, bob, carol, dave, peers };
}

describe('a join that brings back text a concurrent split also moved', () => {
  test('text typed after the joined text shows once, after the character it was typed after', async () => {
    const { alice, bob, carol, dave, peers } = await joinsAfterTwoSplits();
    for (const peer of [bob, carol, dave]) harness.expectConverged(alice, peer);
    for (const peer of peers) {
      expect(paragraphTexts(peer)).toEqual(['Alphatma gamma.Delta.', ' be']);
    }
    const late = await harness.join(alice, 'late');
    expect(paragraphTexts(late)).toEqual(['Alphatma gamma.Delta.', ' be']);
  });
});

describe('text typed after a restored letter', () => {
  test('follows the letter a peer moved, when an undo wrote the letter back', async () => {
    // Bob presses Enter before "beta". Offline, Carol types "N" after "bet" and "X" after
    // it, deletes the "N", and undoes that. Her restored "N" follows Bob's Enter, and so
    // does the "X" typed after it.
    later();
    const { alice, bob, pause, resume } = await harness.pair(zipDocument(BODY));
    pause();
    const carol = await harness.joinDetached(alice, 'carol');
    const peers = [alice, bob, carol];
    harness.apply(bob, [
      { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(bob, 0), offset: 6 },
    ]);
    const at = harness.paragraphIdAt(carol, 0);
    harness.apply(carol, [{ op: 'insertText', paragraphId: at, offset: 9, text: 'N' }]);
    later();
    harness.apply(carol, [{ op: 'insertText', paragraphId: at, offset: 10, text: 'X' }]);
    later();
    harness.apply(carol, [{ op: 'deleteText', paragraphId: at, start: 9, end: 10 }]);
    later();
    expect(carol.room.session.undo()).toBe(true);
    resume();
    syncAll(peers);
    for (const peer of [bob, carol]) harness.expectConverged(alice, peer);
    for (const peer of peers) {
      expect(paragraphTexts(peer)).toEqual(['Alpha ', 'betNXa gamma.', 'Delta.']);
    }
  });
});
