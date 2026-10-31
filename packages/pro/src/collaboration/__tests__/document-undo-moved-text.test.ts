/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Undo of typing that a peer's join moved removes every character of it, however long.
import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import * as Y from 'yjs';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harnesses: ReturnType<typeof createPeerHarness>[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.cleanup();
  setSystemTime();
});

let now = 1_800_000_000_000;
/** Move past the shared undo manager's capture window, so each action is its own step. */
function later(): void {
  now += 2_000;
  setSystemTime(new Date(now));
}

/** Give `to` what `from` holds that it lacks. */
function deliver(from: Peer, to: Peer): void {
  Y.applyUpdate(to.ydoc, Y.encodeStateAsUpdate(from.ydoc, Y.encodeStateVector(to.ydoc)), 'test');
}

describe('undo of typing a peer moved', () => {
  test('removes all of a long insertion that a join moved', async () => {
    const harness = createPeerHarness('undo-moved-text');
    harnesses.push(harness);
    const { alice, bob } = await harness.pair(
      zipDocument('<w:p><w:r><w:t>A</w:t></w:r></w:p><w:p><w:r><w:t>B</w:t></w:r></w:p>')
    );
    const body = (peer: Peer): string[] => {
      const pkg = harness.packageOf(peer);
      const paragraphs: string[] = [];
      walk(pkg.parts.get(pkg.mainDocumentPart)!.root, (node: OoxmlNode) => {
        if (node.kind !== 'textValue' && node.localName === 'p') paragraphs.push(nodeText(node));
      });
      return paragraphs;
    };
    harness.apply(alice, [
      {
        op: 'insertText',
        paragraphId: harness.paragraphIdAt(alice, 1),
        offset: 0,
        text: 'X'.repeat(70_000),
      },
    ]);
    harness.apply(bob, [
      {
        op: 'joinParagraphs',
        firstId: harness.paragraphIdAt(bob, 0),
        secondId: harness.paragraphIdAt(bob, 1),
      },
    ]);
    expect(body(alice)).toEqual([`A${'X'.repeat(70_000)}B`]);
    expect(alice.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(body(alice)).toEqual(['AB']);
    expect(body(bob)).toEqual(['AB']);
    expect(alice.room.session.status()).toBe('ready');
  });

  test('typing right after a redo is a step of its own', async () => {
    const harness = createPeerHarness('undo-moved-text-retype');
    harnesses.push(harness);
    const { alice, bob } = await harness.pair(
      zipDocument('<w:p><w:r><w:t>A</w:t></w:r></w:p><w:p><w:r><w:t>B</w:t></w:r></w:p>')
    );
    const body = (peer: Peer): string[] => {
      const pkg = harness.packageOf(peer);
      const paragraphs: string[] = [];
      walk(pkg.parts.get(pkg.mainDocumentPart)!.root, (node: OoxmlNode) => {
        if (node.kind !== 'textValue' && node.localName === 'p') paragraphs.push(nodeText(node));
      });
      return paragraphs;
    };
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 1), offset: 0, text: 'X' },
    ]);
    harness.apply(bob, [
      {
        op: 'joinParagraphs',
        firstId: harness.paragraphIdAt(bob, 0),
        secondId: harness.paragraphIdAt(bob, 1),
      },
    ]);
    expect(alice.room.session.undo()).toBe(true);
    expect(alice.room.session.redo()).toBe(true);
    // Within the capture window of the redo.
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 0), offset: 2, text: 'Y' },
    ]);
    expect(body(alice)).toEqual(['AXYB']);
    expect(alice.room.session.undo()).toBe(true);
    expect(body(alice)).toEqual(['AXB']);
    expect(alice.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(body(alice)).toEqual(['AB']);
    expect(body(bob)).toEqual(['AB']);
  });

  test('typing undone after its paragraph was deleted stays out when a peer split it', async () => {
    // Alice types, moves the typing on with Enter, and undoes both, while Bob deletes the
    // paragraph. The typing is already deleted when its undo runs. Carol, who saw only the
    // typing, splits the paragraph, and her copy of the typing arrives after the undo.
    const harness = createPeerHarness('undo-moved-text-deleted-paragraph');
    harnesses.push(harness);
    const { alice, bob, pause, resume } = await harness.pair(
      zipDocument(
        '<w:p><w:r><w:t>Zero</w:t></w:r></w:p><w:p><w:r><w:t>One</w:t></w:r></w:p><w:sectPr/>'
      )
    );
    const carol = await harness.joinDetached(alice, 'carol');
    const body = (peer: Peer): string[] => {
      const pkg = harness.packageOf(peer);
      const paragraphs: string[] = [];
      walk(pkg.parts.get(pkg.mainDocumentPart)!.root, (node: OoxmlNode) => {
        if (node.kind !== 'textValue' && node.localName === 'p') paragraphs.push(nodeText(node));
      });
      return paragraphs;
    };
    const paragraphId = harness.paragraphIdAt(alice, 0);
    pause();
    later();
    harness.apply(alice, [{ op: 'insertText', paragraphId, offset: 2, text: 'QQ' }]);
    deliver(alice, carol);
    later();
    harness.apply(bob, [{ op: 'deleteBlock', blockId: paragraphId }]);
    harness.apply(alice, [{ op: 'splitParagraph', paragraphId, offset: 2 }]);
    later();
    resume();
    expect(alice.room.session.undo()).toBe(true);
    expect(alice.room.session.undo()).toBe(true);
    harness.apply(carol, [{ op: 'splitParagraph', paragraphId, offset: 0 }]);
    expect(body(carol).join('|')).toContain('QQ');
    deliver(carol, alice);
    deliver(alice, carol);
    harness.expectConverged(alice, bob);
    harness.expectConverged(alice, carol);
    for (const peer of [alice, bob, carol]) {
      expect(body(peer).join('|')).not.toContain('QQ');
      expect(peer.room.session.status()).toBe('ready');
    }
    const late = await harness.join(alice, 'dave');
    harness.expectConverged(alice, late);
  });
});
