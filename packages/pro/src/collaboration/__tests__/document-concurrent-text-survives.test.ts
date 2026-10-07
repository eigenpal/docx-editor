/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Text one author types survives a paragraph split another author makes in the same run at
// the same time. The typing used to vanish on every replica, silently.
import { afterEach, describe, expect, test } from 'bun:test';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('concurrent-text-survives-room');

afterEach(() => {
  harness.cleanup();
});

function paragraphTexts(peer: Peer): string[] {
  const texts: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'paragraph') texts.push(nodeText(node));
  });
  return texts;
}

/** Alice and Bob edit at once; returns every replica's paragraph texts, late joiner included. */
async function race(
  body: string,
  alice: (peer: Peer) => TreeDocOp[],
  bob: (peer: Peer) => TreeDocOp[]
): Promise<string[]> {
  const pair = await harness.pair(zipDocument(`${body}<w:sectPr/>`));
  pair.pause();
  harness.apply(pair.alice, alice(pair.alice));
  harness.apply(pair.bob, bob(pair.bob));
  pair.resume();
  harness.expectConverged(pair.alice, pair.bob);
  expect(pair.alice.room.session.status()).toBe('ready');
  expect(pair.bob.room.session.status()).toBe('ready');
  const carol = await harness.join(pair.alice, 'carol');
  expect(paragraphTexts(carol)).toEqual(paragraphTexts(pair.alice));
  return paragraphTexts(pair.alice);
}

const ONE_RUN = '<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>';
const THREE_RUNS =
  '<w:p><w:r><w:t>One </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Two </w:t></w:r>' +
  '<w:r><w:t>Three</w:t></w:r></w:p>';
const at = (peer: Peer) => harness.paragraphIdAt(peer, 0);

describe('concurrent typing survives a structural edit of the same run', () => {
  test('Enter inside a run keeps text a peer typed after the split point', async () => {
    // Enter moves the tail into a new paragraph, and the peer's typing in the moved tail
    // moves with it, between the same characters.
    const texts = await race(
      ONE_RUN,
      (p) => [{ op: 'splitParagraph', paragraphId: at(p), offset: 5 }],
      (p) => [{ op: 'insertText', paragraphId: at(p), offset: 8, text: 'XYZ' }]
    );
    expect(texts).toEqual(['Hello', ' woXYZrld']);
  });

  test('Enter inside a run keeps text a peer typed before the split point', async () => {
    const texts = await race(
      ONE_RUN,
      (p) => [{ op: 'splitParagraph', paragraphId: at(p), offset: 5 }],
      (p) => [{ op: 'insertText', paragraphId: at(p), offset: 2, text: 'XYZ' }]
    );
    expect(texts).toEqual(['HeXYZllo', ' world']);
  });

  test('a deletion with no concurrent typing leaves no trace', async () => {
    const texts = await race(
      THREE_RUNS,
      (p) => [{ op: 'deleteText', paragraphId: at(p), start: 2, end: 10 }],
      () => []
    );
    expect(texts).toEqual(['Onree']);
  });
});

describe('typing in text a peer deletes at the same time', () => {
  test('characters typed inside a run a peer deletes whole survive in that run', async () => {
    // Alice deletes exactly the bold "Two "; Bob types "X" inside it. Only the characters
    // Alice saw are deleted, so Bob's "X" stays, bold, between the neighbours.
    const texts = await race(
      THREE_RUNS,
      (p) => [{ op: 'deleteText', paragraphId: at(p), start: 4, end: 8 }],
      (p) => [{ op: 'insertText', paragraphId: at(p), offset: 6, text: 'X' }]
    );
    expect(texts).toEqual(['One XThree']);
  });

  test('characters typed inside a deleted range that spans runs survive', async () => {
    // Alice deletes "ne Two Th", which ends two runs and removes the bold one whole.
    const texts = await race(
      THREE_RUNS,
      (p) => [{ op: 'deleteText', paragraphId: at(p), start: 1, end: 10 }],
      (p) => [{ op: 'insertText', paragraphId: at(p), offset: 5, text: 'X' }]
    );
    expect(texts).toEqual(['OXree']);
  });
});

describe('a replacement inside split text', () => {
  test('a replacement that ends where a deleted split boundary was converges', async () => {
    // Formatting splits "HelloWorld"; deleting "W" removes the character the second slice
    // starts at. Replacing "llo" with "y" in one edit must repair that boundary the same way
    // on every replica as the two edits apart would.
    const { alice, bob } = await harness.pair(
      zipDocument('<w:p><w:r><w:t>HelloWorld</w:t></w:r></w:p><w:sectPr/>')
    );
    harness.apply(alice, [
      {
        op: 'setRunProperties',
        paragraphId: at(alice),
        start: 5,
        end: 10,
        properties: [{ localName: 'b' }],
      },
    ]);
    harness.apply(alice, [{ op: 'deleteText', paragraphId: at(alice), start: 5, end: 6 }]);
    harness.apply(alice, [
      { op: 'deleteText', paragraphId: at(alice), start: 2, end: 5 },
      { op: 'insertText', paragraphId: at(alice), offset: 2, text: 'y' },
    ]);
    harness.expectConverged(alice, bob);
    const late = await harness.join(alice, 'late');
    harness.expectConverged(alice, late);
    expect(paragraphTexts(alice)).toEqual(['Heyorld']);
  });
});

describe('undo of replaced text after a peer typed at the same place', () => {
  test('restores the text where the replacement was, after the peer words', async () => {
    // Alice replaces "Hello" with "X"; Bob then types at the paragraph start, before "X".
    // Undo brings "Hello" back where "X" was, so Bob's words stay first.
    const { alice, bob } = await harness.pair(zipDocument(ONE_RUN + '<w:sectPr/>'));
    harness.apply(alice, [
      { op: 'deleteText', paragraphId: at(alice), start: 0, end: 5 },
      { op: 'insertText', paragraphId: at(alice), offset: 0, text: 'X' },
    ]);
    alice.room.session.flushPendingJournals();
    harness.apply(bob, [{ op: 'insertText', paragraphId: at(bob), offset: 0, text: 'Big ' }]);
    expect(paragraphTexts(alice)).toEqual(['Big X world']);
    expect(alice.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(paragraphTexts(alice)).toEqual(['Big Hello world']);
    expect(paragraphTexts(bob)).toEqual(['Big Hello world']);
  });
});

describe('text two peers move at once shows once', () => {
  test('two peers press Enter at one place: the tail shows once', async () => {
    const texts = await race(
      ONE_RUN,
      (p) => [{ op: 'splitParagraph', paragraphId: at(p), offset: 5 }],
      (p) => [{ op: 'splitParagraph', paragraphId: at(p), offset: 5 }]
    );
    expect(texts.join('')).toBe('Hello world');
    expect(texts[0]).toBe('Hello');
  });

  test('two peers split one paragraph at different places: no character shows twice', async () => {
    const texts = await race(
      ONE_RUN,
      (p) => [{ op: 'splitParagraph', paragraphId: at(p), offset: 5 }],
      (p) => [{ op: 'splitParagraph', paragraphId: at(p), offset: 8 }]
    );
    expect(texts.join('')).toBe('Hello world');
  });

  test('typing at the end of a paragraph a peer joins into the one before it survives', async () => {
    const texts = await race(
      '<w:p><w:r><w:t>First</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p>',
      (p) => [
        {
          op: 'joinParagraphs',
          firstId: harness.paragraphIdAt(p, 0),
          secondId: harness.paragraphIdAt(p, 1),
        },
      ],
      (p) => [{ op: 'insertText', paragraphId: harness.paragraphIdAt(p, 1), offset: 6, text: '!' }]
    );
    expect(texts).toEqual(['FirstSecond!']);
  });

  test('undo and redo of a split show the tail once', async () => {
    const { alice, bob } = await harness.pair(zipDocument(ONE_RUN + '<w:sectPr/>'));
    harness.apply(alice, [{ op: 'splitParagraph', paragraphId: at(alice), offset: 5 }]);
    expect(paragraphTexts(bob)).toEqual(['Hello', ' world']);
    expect(alice.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(paragraphTexts(bob)).toEqual(['Hello world']);
    expect(alice.room.session.redo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(paragraphTexts(bob)).toEqual(['Hello', ' world']);
  });
});
