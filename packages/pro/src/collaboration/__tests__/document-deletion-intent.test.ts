/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A move deletes text and writes a copy of it; a deletion only deletes. Text one participant
// deleted while another moved it, as Enter does, came back in the moved copy. Deleted text now
// stays deleted on every replica, and the participant who deleted it can undo the deletion.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('deletion-intent-room');

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

const DOCUMENT = zipDocument(
  '<w:p><w:r><w:t>Hello brave world</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Second</w:t></w:r></w:p>' +
    '<w:sectPr/>'
);

describe('deleted text stays deleted', () => {
  test('a word deleted while a peer moves it into a new paragraph stays deleted', async () => {
    const { alice, bob, pause, resume } = await harness.pair(DOCUMENT);
    pause();
    const paragraphId = harness.paragraphIdAt(alice, 0);
    // Bob presses Enter before "brave", Alice deletes "brave ".
    harness.apply(bob, [{ op: 'splitParagraph', paragraphId, offset: 6 }]);
    harness.apply(alice, [{ op: 'deleteText', paragraphId, start: 6, end: 12 }]);
    resume();
    harness.expectConverged(alice, bob);
    const carol = await harness.join(alice, 'carol');
    for (const peer of [alice, bob, carol]) {
      expect(paragraphTexts(peer)).toEqual(['Hello ', 'world', 'Second']);
    }
  });

  test('the participant who deleted it can undo the deletion', async () => {
    const { alice, bob, pause, resume } = await harness.pair(DOCUMENT);
    pause();
    const paragraphId = harness.paragraphIdAt(alice, 0);
    harness.apply(bob, [{ op: 'splitParagraph', paragraphId, offset: 6 }]);
    harness.apply(alice, [{ op: 'deleteText', paragraphId, start: 6, end: 12 }]);
    resume();
    expect(alice.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    const texts = paragraphTexts(alice).join('|');
    expect(texts).toContain('brave');
    // Once only.
    expect(texts.split('brave').length).toBe(2);
    expect(paragraphTexts(bob)).toEqual(paragraphTexts(alice));
  });

  test('a paragraph deleted while a peer splits it stays deleted until the deletion is undone', async () => {
    const { alice, bob, pause, resume } = await harness.pair(DOCUMENT);
    pause();
    const paragraphId = harness.paragraphIdAt(alice, 0);
    harness.apply(bob, [{ op: 'splitParagraph', paragraphId, offset: 6 }]);
    harness.apply(alice, [{ op: 'deleteBlock', blockId: paragraphId }]);
    resume();
    harness.expectConverged(alice, bob);
    for (const peer of [alice, bob]) expect(paragraphTexts(peer).join('|')).not.toContain('brave');
    expect(alice.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    const texts = paragraphTexts(alice).join('|');
    expect(texts.split('brave').length).toBe(2);
    expect(texts).toContain('Hello');
  });
});
