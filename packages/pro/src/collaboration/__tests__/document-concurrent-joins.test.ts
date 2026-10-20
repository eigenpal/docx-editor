/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A join deletes the paragraph it takes in, so text a peer puts there meanwhile follows the
// text the join moved. Typing at the paragraph's start follows what it was typed in front
// of. A second peer joining the same paragraph forward copies text into it; those copies
// show nowhere else, so they follow the text they went in after, and nothing is lost.

import { afterEach, describe, expect, test } from 'bun:test';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('concurrent-joins-room');

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

function join(peer: Peer, first: number): TreeDocOp {
  return {
    op: 'joinParagraphs',
    firstId: harness.paragraphIdAt(peer, first),
    secondId: harness.paragraphIdAt(peer, first + 1),
  };
}

describe('typing into a paragraph a peer joins back', () => {
  for (const [offset, expected] of [
    [0, 'OneXTwo'],
    [1, 'OneTXwo'],
    [3, 'OneTwoX'],
  ] as const) {
    test(`typing at offset ${offset} keeps the text`, async () => {
      const { alice, bob, pause, resume } = await harness.pair(
        zipDocument(
          '<w:p><w:r><w:t>One</w:t></w:r></w:p><w:p><w:r><w:t>Two</w:t></w:r></w:p><w:sectPr/>'
        )
      );
      pause();
      harness.apply(alice, [join(alice, 0)]);
      harness.apply(bob, [
        { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 1), offset, text: 'X' },
      ]);
      resume();
      harness.expectConverged(alice, bob);
      const carol = await harness.join(alice, 'carol');
      for (const peer of [alice, bob, carol]) expect(paragraphTexts(peer)).toEqual([expected]);
    });
  }
});

describe('concurrent joins of one paragraph', () => {
  test('joining a paragraph forward and backward at once keeps all of its text', async () => {
    const { alice, bob, pause, resume } = await harness.pair(
      zipDocument(
        '<w:p><w:r><w:t>One</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>Two</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>Three</w:t></w:r></w:p>' +
          '<w:sectPr/>'
      )
    );
    pause();
    harness.apply(alice, [join(alice, 0)]);
    harness.apply(bob, [join(bob, 1)]);
    resume();
    harness.expectConverged(alice, bob);
    const carol = await harness.join(alice, 'carol');
    for (const peer of [alice, bob, carol]) {
      expect(paragraphTexts(peer)).toEqual(['OneTwoThree']);
    }
  });

  test('text typed into the paragraph before the forward join stays with the joined text', async () => {
    const { alice, bob, pause, resume } = await harness.pair(
      zipDocument(
        '<w:p><w:r><w:t>One</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>Two</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>Three</w:t></w:r></w:p>' +
          '<w:sectPr/>'
      )
    );
    pause();
    harness.apply(alice, [join(alice, 0)]);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 1), offset: 0, text: 'X' },
    ]);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 1), offset: 4, text: 'Y' },
    ]);
    harness.apply(bob, [join(bob, 1)]);
    resume();
    harness.expectConverged(alice, bob);
    const carol = await harness.join(alice, 'carol');
    for (const peer of [alice, bob, carol]) {
      expect(paragraphTexts(peer)).toEqual(['OneXTwoYThree']);
    }
  });
});

describe('deleting text that two concurrent joins copied', () => {
  // Both joins copy the second paragraph's text into the first, which then holds it twice and
  // shows it once. Deleting the shown copy must delete the hidden one too, or it shows instead.
  for (const deleter of ['alice', 'bob', 'carol'] as const) {
    test(`a deletion by ${deleter} stays deleted on every replica`, async () => {
      const { alice, bob, pause, resume } = await harness.pair(
        zipDocument(
          '<w:p><w:r><w:t>One</w:t></w:r></w:p>' +
            '<w:p><w:r><w:t>Two words</w:t></w:r></w:p>' +
            '<w:sectPr/>'
        )
      );
      pause();
      harness.apply(alice, [join(alice, 0)]);
      harness.apply(bob, [join(bob, 0)]);
      resume();
      harness.expectConverged(alice, bob);
      const carol = await harness.join(alice, 'carol');
      const who = { alice, bob, carol }[deleter];
      // "OneTwo words" without "Two ".
      harness.apply(who, [
        { op: 'deleteText', paragraphId: harness.paragraphIdAt(who, 0), start: 3, end: 7 },
      ]);
      harness.expectConverged(alice, bob);
      harness.expectConverged(alice, carol);
      const dave = await harness.join(alice, 'dave');
      for (const peer of [alice, bob, carol, dave]) {
        expect(paragraphTexts(peer)).toEqual(['Onewords']);
      }
    });
  }
});
