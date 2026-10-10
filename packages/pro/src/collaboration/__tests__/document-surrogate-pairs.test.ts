/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A character outside the basic plane, as an emoji, is two UTF-16 code units. Shared text
// replaces a half that an edit cuts off with U+FFFD, so an edit that kept one half of a pair
// and replaced the other corrupted the text and left the author's replica different from
// every other.

import { afterEach, describe, expect, test } from 'bun:test';
import { diffTokens, type Token } from '../document/paragraph-text-diff.ts';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('surrogate-pairs-room');

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

const tokens = (value: string): Token[] =>
  // One token per code unit, as the paragraph's tokens are.
  value.split('').map((unit) => ({
    key: `c${unit}`,
    strong: `c${unit}\u0000t`,
    insert: unit,
    attributes: { t: 't' },
  }));

describe('surrogate pairs in the edit script', () => {
  // U+1F600 and U+1F603 share their high half; U+1F200 and U+1F600 share their low half.
  for (const [before, after] of [
    ['a\u{1F600}b', 'a\u{1F603}b'],
    ['a\u{1F600}b', 'a\u{1F200}b'],
    ['\u{1F600}', '\u{1F600}\u{1F600}'],
    ['x\u{1F600}\u{1F603}y', 'x\u{1F603}y'],
    ['abc', 'a\u{1F600}bc'],
  ] as const) {
    test(`${JSON.stringify(before)} to ${JSON.stringify(after)} keeps or replaces whole pairs`, () => {
      const left = tokens(before);
      const right = tokens(after);
      const steps = diffTokens(left, right);
      // A pair's halves share one fate: both kept, both deleted, or both inserted.
      const fateOf = (side: 'before' | 'after', at: number): string =>
        steps.find((step) => (side in step ? (step as never)[side] === at : false))!.op;
      for (const [side, list] of [
        ['before', left],
        ['after', right],
      ] as const) {
        list.forEach((token, at) => {
          const code = (token.insert as string).charCodeAt(0);
          if (code >= 0xd800 && code <= 0xdbff) {
            expect(fateOf(side, at + 1)).toBe(fateOf(side, at));
          }
        });
      }
      // The script turns `before` into `after`.
      const result = steps
        .filter((step) => step.op !== 'del')
        .map((step) => right[(step as { after: number }).after]!.insert)
        .join('');
      expect(result).toBe(after);
    });
  }
});

describe('surrogate pairs across replicas', () => {
  test('replacing an emoji with one that shares its high half keeps every replica alike', async () => {
    const { alice, bob } = await harness.pair(
      zipDocument('<w:p><w:r><w:t>a\u{1F600}b</w:t></w:r></w:p><w:sectPr/>')
    );
    const paragraphId = harness.paragraphIdAt(alice, 0);
    harness.apply(alice, [
      { op: 'deleteText', paragraphId, start: 1, end: 3 },
      { op: 'insertText', paragraphId, offset: 1, text: '\u{1F603}' },
    ]);
    harness.expectConverged(alice, bob);
    const carol = await harness.join(alice, 'carol');
    for (const peer of [alice, bob, carol]) expect(paragraphTexts(peer)).toEqual(['a\u{1F603}b']);
  });

  test('concurrent emoji edits around one emoji converge without replacement characters', async () => {
    const { alice, bob, pause, resume } = await harness.pair(
      zipDocument('<w:p><w:r><w:t>a\u{1F600}b</w:t></w:r></w:p><w:sectPr/>')
    );
    pause();
    const aliceParagraph = harness.paragraphIdAt(alice, 0);
    harness.apply(alice, [
      { op: 'deleteText', paragraphId: aliceParagraph, start: 1, end: 3 },
      { op: 'insertText', paragraphId: aliceParagraph, offset: 1, text: '\u{1F200}' },
    ]);
    const bobParagraph = harness.paragraphIdAt(bob, 0);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: bobParagraph, offset: 3, text: '\u{1F603}' },
      { op: 'insertText', paragraphId: bobParagraph, offset: 1, text: '\u{1F604}' },
    ]);
    resume();
    harness.expectConverged(alice, bob);
    const carol = await harness.join(alice, 'carol');
    const [text] = paragraphTexts(alice);
    expect(text).not.toContain('�');
    for (const point of ['\u{1F200}', '\u{1F603}', '\u{1F604}']) expect(text).toContain(point);
    expect(text).not.toContain('\u{1F600}');
    for (const peer of [bob, carol]) expect(paragraphTexts(peer)).toEqual([text!]);
  });
});
