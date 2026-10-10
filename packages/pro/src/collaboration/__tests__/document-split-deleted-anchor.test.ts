/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// One author formats, types, and deletes inside one run, then types where the deleted text was.
//
// A formatted slice keeps its boundaries as Yjs relative positions on the source text. When the
// characters a boundary names are deleted and new text is typed at that spot, every peer must
// still read the same slice the author's editor shows.

import { afterEach, describe, expect, test } from 'bun:test';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import { createPeerHarness, nodeText, zipDocument, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('split-deleted-anchor-room');
afterEach(() => harness.cleanup());

function edit(peer: Peer, op: Record<string, unknown>): void {
  harness.apply(peer, [{ ...op, paragraphId: harness.paragraphIdAt(peer, 0) } as TreeDocOp]);
}

describe('typing where a formatted slice lost its boundary characters', () => {
  test('every peer reads the text the author sees', async () => {
    const { alice, bob } = await harness.pair(
      zipDocument('<w:p><w:r><w:t>DOCX-EDITOR.DEV</w:t></w:r></w:p><w:sectPr/>')
    );
    edit(alice, { op: 'setRunProperties', start: 1, end: 3, properties: [{ localName: 'u' }] });
    edit(alice, { op: 'insertText', offset: 1, text: 'l' });
    edit(alice, { op: 'deleteText', start: 3, end: 5 });
    edit(alice, { op: 'deleteText', start: 2, end: 3 });
    edit(alice, { op: 'insertText', offset: 1, text: 'lore' });
    expect(alice.room.session.status()).toBe('ready');
    expect(bob.room.session.status()).toBe('ready');
    expect(nodeText(harness.packageOf(bob).parts.get('/word/document.xml')!.root)).toBe(
      nodeText(harness.packageOf(alice).parts.get('/word/document.xml')!.root)
    );
    harness.expectConverged(alice, bob);
    const late = await harness.join(alice, 'late');
    harness.expectConverged(alice, late);
  });
});
