/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Text typed in a paragraph after Enter moved its text away stays where it was typed, also
// when the character it was typed after is deleted later. That deletion exposes the moved
// characters behind it, and text that did not say it knew of the move followed them into
// the next paragraph.

import { afterEach, describe, expect, test } from 'bun:test';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('typing-after-move-room');

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

describe('typing after a move stays where it was typed', () => {
  const cases: readonly (readonly [string, (paragraphId: string) => TreeDocOp[], string])[] = [
    [
      'a character',
      (paragraphId) => [
        { op: 'insertText', paragraphId, offset: 0, text: 'a' },
        { op: 'insertText', paragraphId, offset: 1, text: 'x' },
      ],
      'x',
    ],
    [
      'a tab',
      (paragraphId) => [
        { op: 'insertTab', paragraphId, offset: 0 },
        { op: 'insertText', paragraphId, offset: 1, text: 'x' },
      ],
      'x',
    ],
  ];
  for (const [name, typing, expected] of cases) {
    test(`deleting ${name} typed first keeps what was typed after it`, async () => {
      const { alice, bob } = await harness.pair(
        zipDocument('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p><w:sectPr/>')
      );
      const paragraphId = harness.paragraphIdAt(alice, 0);
      // Enter at the start moves the whole text into a new paragraph after this one.
      harness.apply(alice, [{ op: 'splitParagraph', paragraphId, offset: 0 }]);
      for (const op of typing(paragraphId)) harness.apply(alice, [op]);
      harness.apply(bob, [{ op: 'deleteText', paragraphId, start: 0, end: 1 }]);
      harness.expectConverged(alice, bob);
      const carol = await harness.join(alice, 'carol');
      for (const peer of [alice, bob, carol]) {
        expect(paragraphTexts(peer)).toEqual([expected, 'Hello world']);
      }
    });
  }

  test('typing where a split was joined back stays when a later split moves the text after it', async () => {
    // The join copies the tail back behind its deleted originals, and the typing lands after
    // those originals. A later Enter moves the copies on; the typing stays where it was typed.
    const { alice, bob } = await harness.pair(
      zipDocument('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p><w:sectPr/>')
    );
    const paragraphId = harness.paragraphIdAt(alice, 0);
    harness.apply(alice, [{ op: 'splitParagraph', paragraphId, offset: 5 }]);
    harness.apply(alice, [
      { op: 'joinParagraphs', firstId: paragraphId, secondId: harness.paragraphIdAt(alice, 1) },
    ]);
    harness.apply(alice, [{ op: 'insertText', paragraphId, offset: 5, text: 'X' }]);
    harness.apply(bob, [{ op: 'splitParagraph', paragraphId, offset: 8 }]);
    harness.expectConverged(alice, bob);
    for (const peer of [alice, bob]) expect(paragraphTexts(peer)).toEqual(['HelloX w', 'orld']);
  });

  test('a tab typed at the end of a split paragraph stays there', async () => {
    // Yjs places an insert at a paragraph's end behind the text Enter moved away. A tab, like
    // typed text, names the character it was placed after, or it follows that text.
    const { alice, bob } = await harness.pair(
      zipDocument('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p><w:sectPr/>')
    );
    const paragraphId = harness.paragraphIdAt(alice, 0);
    harness.apply(alice, [{ op: 'splitParagraph', paragraphId, offset: 5 }]);
    harness.apply(alice, [{ op: 'insertTab', paragraphId, offset: 5 }]);
    harness.expectConverged(alice, bob);
    const tabsByParagraph = (peer: Peer): number[] => {
      const counts: number[] = [];
      walk(peer.store.bodyStore().part.root, (node) => {
        if (node.kind === 'paragraph') {
          let tabs = 0;
          walk(node, (inner) => {
            if (inner.kind !== 'textValue' && 'localName' in inner && inner.localName === 'tab') {
              tabs += 1;
            }
          });
          counts.push(tabs);
        }
      });
      return counts;
    };
    const carol = await harness.join(alice, 'carol');
    for (const peer of [alice, bob, carol]) expect(tabsByParagraph(peer)).toEqual([1, 0]);
  });
});
