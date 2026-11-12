/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A paragraph's shared text can embed one node twice: concurrent joins, moves, and undos
// beside moved blocks leave a second copy. The node shows once, at the first copy, and an
// edit after it addresses the text as the editor shows it.

import { afterEach, describe, expect, test } from 'bun:test';
import type * as Y from 'yjs';
import type { DocumentRegistry } from '../document/index.ts';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('embed-copies-room');

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

function tabCount(peer: Peer): number {
  let tabs = 0;
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind !== 'textValue' && node.localName === 'tab') tabs += 1;
  });
  return tabs;
}

/** Embed the paragraph's first embedded node a second time, `offset` characters after it. */
function embedAgain(peer: Peer, paragraphId: string, offset: number): void {
  const { registry } = peer.room.session as unknown as { registry: DocumentRegistry };
  const text = registry.inline.textOf(paragraphId) as Y.Text;
  let at = 0;
  for (const op of text.toDelta() as { insert: unknown; attributes?: object }[]) {
    if (typeof op.insert === 'string') {
      at += op.insert.length;
      continue;
    }
    const embed = op.insert as object;
    const attributes = { ...op.attributes };
    peer.ydoc.transact(() => text.insertEmbed(at + 1 + offset, embed, attributes));
    return;
  }
  throw new Error('no embedded node');
}

describe('a node that follows a split while its paragraph shows another copy', () => {
  // A tab typed after a split point follows into the new paragraph. A second copy of it in the
  // first paragraph's own text shows there, so the editor shows the tab once, in the first
  // paragraph, and the new paragraph's text shows as one text value. An edit after the place
  // the tab follows to addresses that text value as the editor shows it.
  test('an edit in the paragraph it follows into applies on every peer', async () => {
    const { alice, bob, pause, resume } = await harness.pair(
      zipDocument('<w:p><w:r><w:t xml:space="preserve">Hello world</w:t></w:r></w:p><w:sectPr/>')
    );
    const first = harness.paragraphIdAt(alice, 0);
    pause();
    harness.apply(alice, [{ op: 'splitParagraph', paragraphId: first, offset: 5 }]);
    harness.apply(bob, [{ op: 'insertTab', paragraphId: first, offset: 8 }]);
    resume();
    harness.expectConverged(alice, bob);
    expect(paragraphTexts(alice)).toEqual(['Hello', ' world']);
    embedAgain(alice, first, -7);
    harness.expectConverged(alice, bob);
    for (const peer of [alice, bob]) expect(tabCount(peer)).toBe(1);
    const second = harness.paragraphIdAt(alice, 1);
    // A refused edit recovers by taking shared state back, so only its status change shows it.
    const refused: string[] = [];
    for (const [name, peer] of [
      ['alice', alice],
      ['bob', bob],
    ] as const) {
      peer.room.session.subscribeStatus((status, reason) => {
        if (status === 'error') refused.push(`${name}: ${reason}`);
      });
    }
    // The edit is its own undo step, apart from the split.
    (alice.room.session as unknown as { undoManager: Y.UndoManager }).undoManager.stopCapturing();
    harness.apply(alice, [{ op: 'insertText', paragraphId: second, offset: 5, text: 'X' }]);
    harness.apply(bob, [{ op: 'deleteText', paragraphId: second, start: 0, end: 1 }]);
    harness.expectConverged(alice, bob);
    expect(refused).toEqual([]);
    const carol = await harness.join(alice, 'carol');
    harness.expectConverged(alice, carol);
    for (const peer of [alice, bob, carol]) {
      expect(paragraphTexts(peer)).toEqual(['Hello', 'worlXd']);
      expect(tabCount(peer)).toBe(1);
      expect(peer.room.session.status()).toBe('ready');
    }
    // Undo and redo of the edit, while a peer types in the same text at the same time.
    alice.room.session.flushPendingJournals();
    pause();
    expect(alice.room.session.undo()).toBe(true);
    harness.apply(bob, [{ op: 'insertText', paragraphId: second, offset: 2, text: 'Y' }]);
    resume();
    harness.expectConverged(alice, bob);
    expect(paragraphTexts(alice)).toEqual(['Hello', 'woYrld']);
    expect(alice.room.session.redo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(paragraphTexts(bob)).toEqual(['Hello', 'woYrlXd']);
    expect(tabCount(bob)).toBe(1);
    expect(refused).toEqual([]);
  });
});

describe('a node a paragraph text embeds twice', () => {
  test('shows once, and edits after the second copy apply on every peer', async () => {
    const { alice, bob } = await harness.pair(
      zipDocument('<w:p><w:r><w:t>Hello</w:t><w:tab/><w:t>world wide</w:t></w:r></w:p><w:sectPr/>')
    );
    const paragraphId = harness.paragraphIdAt(alice, 0);
    embedAgain(alice, paragraphId, 2);
    for (const peer of [alice, bob]) expect(tabCount(peer)).toBe(1);
    // Inside the text after the second copy, which shows as one text value.
    harness.apply(bob, [{ op: 'deleteText', paragraphId, start: 10, end: 12 }]);
    harness.apply(alice, [{ op: 'deleteText', paragraphId, start: 9, end: 10 }]);
    harness.expectConverged(alice, bob);
    const carol = await harness.join(alice, 'carol');
    harness.expectConverged(alice, carol);
    for (const peer of [alice, bob, carol]) {
      expect(paragraphTexts(peer)).toEqual(['Helloworwide']);
      expect(tabCount(peer)).toBe(1);
      expect(peer.room.session.status()).toBe('ready');
    }
  });
});
