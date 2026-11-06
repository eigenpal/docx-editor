/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Bob types a word into text that Alice's concurrent Enter copied into her own paragraph. An
// undo then puts back the last letter of his word alone, and another undo writes it again.
// The letter stays after the letter typed before it, in Bob's paragraph. It does not follow
// what the first letter of the word was typed after into Alice's paragraph.

import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

let now = 1_800_000_000_000;
/** Move past the shared undo manager's capture window, so each action is its own step. */
function later(): void {
  now += 2_000;
  setSystemTime(new Date(now));
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  setSystemTime();
});

const BODY =
  '<w:p><w:r><w:t>Alpha beta gamma delta.</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>End.</w:t></w:r></w:p><w:sectPr/>';

function paragraphTexts(peer: Peer): string[] {
  const texts: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'paragraph') texts.push(nodeText(node));
  });
  return texts;
}

const ORDERS = [
  { name: 'Alice first', ids: { alice: 1_000, bob: 2_000 } },
  { name: 'Bob first', ids: { alice: 2_000, bob: 1_000 } },
] as const;

describe('a letter an undo puts back stays after the letter typed before it', () => {
  for (const { name, ids } of ORDERS) {
    test(name, async () => {
      later();
      const harness = createPeerHarness(`undone-letter-follows-neighbor-${name}`, undefined, ids);
      cleanup = harness.cleanup;
      const { alice, bob, pause, resume } = await harness.pair(zipDocument(BODY));
      const first = harness.paragraphIdAt(alice, 0);
      pause();
      // Bob presses Enter before "gamma" and types "XYZ" after "delt", in his new paragraph.
      harness.apply(bob, [{ op: 'splitParagraph', paragraphId: first, offset: 11 }]);
      const bobs = harness.paragraphIdAt(bob, 1);
      harness.apply(bob, [{ op: 'insertText', paragraphId: bobs, offset: 10, text: 'XYZ' }]);
      // Alice presses Enter before "delta" and deletes the first paragraph.
      harness.apply(alice, [{ op: 'splitParagraph', paragraphId: first, offset: 17 }]);
      harness.apply(alice, [{ op: 'deleteBlock', blockId: first }]);
      resume();
      harness.expectConverged(alice, bob);
      const typed = paragraphTexts(alice).findIndex((text) => text.includes('XYZ'));
      expect(typed).toBeGreaterThanOrEqual(0);
      const holder = harness.paragraphIdAt(alice, typed);
      const at = paragraphTexts(alice)[typed]!.indexOf('Z');

      // Bob deletes "Z" and undoes it.
      later();
      harness.apply(bob, [{ op: 'deleteText', paragraphId: holder, start: at, end: at + 1 }]);
      later();
      expect(bob.room.session.undo()).toBe(true);
      harness.expectConverged(alice, bob);
      const shown = paragraphTexts(alice);
      expect(shown).toEqual(['XYZ', 'delta.', 'End.']);

      // Alice presses Enter after "X" and undoes it: every letter is back where it was.
      later();
      harness.apply(alice, [{ op: 'splitParagraph', paragraphId: holder, offset: at - 1 }]);
      later();
      expect(alice.room.session.undo()).toBe(true);
      harness.expectConverged(alice, bob);
      expect(paragraphTexts(alice)).toEqual(shown);
      expect(paragraphTexts(bob)).toEqual(shown);
    });
  }
});
