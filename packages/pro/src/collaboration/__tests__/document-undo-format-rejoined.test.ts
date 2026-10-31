/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An undo of a split joins the paragraphs again, and text a peer typed in the new paragraph
// follows into the joined one. A format change over that text writes it into the joined
// paragraph as its own. The text must stay on every replica when the format change is undone,
// and stay deleted when someone deletes it (#1393).

import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('undo-format-rejoined-room');

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

function paragraphTexts(peer: Peer): string[] {
  const texts: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'paragraph') texts.push(nodeText(node));
  });
  return texts;
}

const BODY =
  '<w:p><w:r><w:t>Third paragraph for deletions.</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Fourth.</w:t></w:r></w:p><w:sectPr/>';
const JOINED = ['Third para[p3]graph for deletions.', 'Fourth.'];
const WITHOUT = ['Third paragraph for deletions.', 'Fourth.'];

/** Every replica, and one that joins now, reads `expected`. */
async function expectAll(peers: readonly Peer[], expected: readonly string[]): Promise<void> {
  for (const peer of peers.slice(1)) harness.expectConverged(peers[0]!, peer);
  const late = await harness.join(peers[0]!, `late-${now}`);
  for (const peer of [...peers, late]) expect(paragraphTexts(peer)).toEqual([...expected]);
  harness.leave(late);
}

/**
 * Alice splits the first paragraph, Bob types `[p3]` at the start of the new one, and Alice
 * undoes the split: `[p3]` follows into the joined paragraph.
 */
async function rejoined() {
  later();
  const pair = await harness.pair(zipDocument(BODY));
  const { alice, bob } = pair;
  harness.apply(alice, [
    { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(alice, 0), offset: 10 },
  ]);
  later();
  harness.apply(bob, [
    { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 1), offset: 0, text: '[p3]' },
  ]);
  later();
  expect(alice.room.session.undo()).toBe(true);
  await expectAll([alice, bob], JOINED);
  return pair;
}

/** Bold over offsets 12 to 18 of the first paragraph: `3]grap`, half of it the typed text. */
function bold(peer: Peer): TreeDocOp {
  return {
    op: 'setRunProperties',
    paragraphId: harness.paragraphIdAt(peer, 0),
    start: 12,
    end: 18,
    properties: [{ localName: 'b' }],
  };
}

/** Delete the typed `[p3]` from the first paragraph. */
function deleteTyped(peer: Peer): TreeDocOp {
  return { op: 'deleteText', paragraphId: harness.paragraphIdAt(peer, 0), start: 10, end: 14 };
}

describe('a format change over text a peer typed before an undone split', () => {
  test('keeps the peer text through the undo and redo of the format change', async () => {
    const { alice, bob } = await rejoined();
    later();
    harness.apply(alice, [bold(alice)]);
    await expectAll([alice, bob], JOINED);
    later();
    expect(alice.room.session.undo()).toBe(true);
    await expectAll([alice, bob], JOINED);
    later();
    expect(alice.room.session.redo()).toBe(true);
    await expectAll([alice, bob], JOINED);
  });

  test('a later deletion of the peer text stays deleted, and its undo brings it back', async () => {
    const { alice, bob } = await rejoined();
    later();
    harness.apply(alice, [bold(alice)]);
    later();
    harness.apply(bob, [deleteTyped(bob)]);
    await expectAll([alice, bob], WITHOUT);
    later();
    expect(alice.room.session.undo()).toBe(true);
    await expectAll([alice, bob], WITHOUT);
    later();
    expect(bob.room.session.undo()).toBe(true);
    await expectAll([alice, bob], JOINED);
  });

  test('a deletion of the peer text made offline during the format change stays', async () => {
    const { alice, bob, pause, resume } = await rejoined();
    later();
    pause();
    harness.apply(alice, [bold(alice)]);
    harness.apply(bob, [deleteTyped(bob)]);
    resume();
    await expectAll([alice, bob], WITHOUT);
    later();
    expect(alice.room.session.undo()).toBe(true);
    await expectAll([alice, bob], WITHOUT);
  });

  test('a later deletion of the whole paragraph takes the peer text with it', async () => {
    const { alice, bob } = await rejoined();
    later();
    harness.apply(alice, [bold(alice)]);
    later();
    harness.apply(bob, [{ op: 'deleteBlock', blockId: harness.paragraphIdAt(bob, 0) }]);
    await expectAll([alice, bob], ['Fourth.']);
    later();
    expect(alice.room.session.undo()).toBe(true);
    await expectAll([alice, bob], ['Fourth.']);
    later();
    expect(bob.room.session.undo()).toBe(true);
    await expectAll([alice, bob], JOINED);
  });

  test('a deletion of the whole paragraph made offline during the format change stays', async () => {
    const { alice, bob, pause, resume } = await rejoined();
    later();
    pause();
    harness.apply(alice, [bold(alice)]);
    harness.apply(bob, [{ op: 'deleteBlock', blockId: harness.paragraphIdAt(bob, 0) }]);
    resume();
    await expectAll([alice, bob], ['Fourth.']);
    later();
    expect(alice.room.session.undo()).toBe(true);
    await expectAll([alice, bob], ['Fourth.']);
  });
});
