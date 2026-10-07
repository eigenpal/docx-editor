/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Undo of typing that a peer's join moved removes every character of it, however long.
import { afterEach, describe, expect, test } from 'bun:test';
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
});

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
});
