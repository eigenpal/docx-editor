/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Many rooms in one process, as a server or a page that hosts one room per tenant runs them.
// Rooms seeded from the same file share every paragraph id and logical id, so any state kept
// per process instead of per document would carry an edit, an undo, or a caret across them.
import { afterEach, describe, expect, test } from 'bun:test';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { collaborationDocx } from './support.ts';
import { createPeerHarness, nodeText, walk, type Peer } from './document-peer-support.ts';

const harnesses: ReturnType<typeof createPeerHarness>[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.cleanup();
});

/** A room with two participants, seeded from the same file as every other room. */
async function room(name: string) {
  const harness = createPeerHarness(`tenant-${name}`);
  harnesses.push(harness);
  const { alice, bob } = await harness.pair(collaborationDocx());
  const textOf = (peer: Peer, index: number): string => {
    const pkg = harness.packageOf(peer);
    const paragraphs: OoxmlNode[] = [];
    walk(pkg.parts.get(pkg.mainDocumentPart)!.root, (node) => {
      if (node.kind !== 'textValue' && node.localName === 'p') paragraphs.push(node);
    });
    return nodeText(paragraphs[index]!);
  };
  return { harness, alice, bob, textOf };
}

describe('rooms of different tenants in one process', () => {
  test('edits, undo, and presence stay in their own room', async () => {
    const first = await room('one');
    const second = await room('two');
    // The same paragraph ids in both rooms.
    expect(first.harness.paragraphIdAt(first.alice, 0)).toBe(
      second.harness.paragraphIdAt(second.alice, 0)
    );

    // Interleaved edits: each room sees only its own.
    first.harness.apply(first.alice, [
      {
        op: 'insertText',
        paragraphId: first.harness.paragraphIdAt(first.alice, 0),
        offset: 0,
        text: 'One ',
      },
    ]);
    second.harness.apply(second.bob, [
      {
        op: 'insertText',
        paragraphId: second.harness.paragraphIdAt(second.bob, 0),
        offset: 0,
        text: 'Two ',
      },
    ]);
    first.harness.apply(first.bob, [
      { op: 'splitParagraph', paragraphId: first.harness.paragraphIdAt(first.bob, 0), offset: 3 },
    ]);
    first.harness.expectConverged(first.alice, first.bob);
    second.harness.expectConverged(second.alice, second.bob);
    expect(first.textOf(first.alice, 0)).toBe('One');
    expect(first.textOf(first.alice, 1)).toBe(' Alpha paragraph');
    expect(second.textOf(second.alice, 0)).toBe('Two Alpha paragraph');

    // An undo in one room undoes that room's step only.
    expect(second.bob.room.session.undo()).toBe(true);
    second.harness.expectConverged(second.alice, second.bob);
    expect(second.textOf(second.alice, 0)).toBe('Alpha paragraph');
    expect(first.textOf(first.alice, 0)).toBe('One');
    expect(first.textOf(first.alice, 1)).toBe(' Alpha paragraph');

    // A caret published in one room is shown there and nowhere else.
    const paragraphId = first.alice.port.paragraphs()[0]!.paragraphId;
    first.alice.room.session.setLocalSelection({
      anchor: { paragraphId, offset: 2 },
      head: { paragraphId, offset: 2 },
    });
    applyAwarenessUpdate(
      first.bob.awareness,
      encodeAwarenessUpdate(first.alice.awareness, [first.alice.awareness.clientID]),
      'relay'
    );
    expect(first.bob.room.session.remoteSelections()).toHaveLength(1);
    expect(second.alice.room.session.remoteSelections()).toHaveLength(0);
    expect(second.bob.room.session.remoteSelections()).toHaveLength(0);
  });
});
